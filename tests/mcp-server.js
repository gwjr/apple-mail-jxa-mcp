#!/usr/bin/env node

// Test suite for mail.js MCP server
// Runs protocol-level tests against the JXA MCP server

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'mail.js');
const TIMEOUT = 10000;

class MCPTestClient {
    constructor() {
        this.proc = null;
        this.id = 0;
        this.pending = new Map();
        this.buffer = '';
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.proc = spawn('osascript', ['-l', 'JavaScript', SERVER_PATH], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const rl = readline.createInterface({ input: this.proc.stdout });
            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line);
                    const resolver = this.pending.get(msg.id);
                    if (resolver) {
                        this.pending.delete(msg.id);
                        resolver(msg);
                    }
                } catch (e) {
                    // Not JSON, ignore (probably debug output)
                }
            });

            this.proc.stderr.on('data', (data) => {
                if (process.env.DEBUG) process.stderr.write(data);
            });

            this.proc.on('error', reject);

            // Initialize
            this.call('initialize', { clientInfo: { name: 'test-suite' } })
                .then(resolve)
                .catch(reject);
        });
    }

    call(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id;
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timeout waiting for ${method}`));
            }, TIMEOUT);

            this.pending.set(id, (msg) => {
                clearTimeout(timeout);
                if (msg.error) {
                    reject(new Error(`${method}: ${msg.error.message}`));
                } else {
                    resolve(msg.result);
                }
            });

            const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
            this.proc.stdin.write(request);
        });
    }

    stop() {
        if (this.proc) {
            this.proc.stdin.end();
            this.proc.kill();
        }
    }
}

// Test framework
const tests = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn, options = {}) {
    tests.push({ name, fn, ...options });
}

function skip(name, fn) {
    tests.push({ name, fn, skip: true });
}

async function runTests() {
    const filter = process.argv[2]; // Optional test name filter
    const client = new MCPTestClient();

    console.log('Starting MCP server...');
    await client.start();
    console.log('Server started.\n');

    for (const t of tests) {
        // Filter by name if argument provided
        if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) {
            continue;
        }

        if (t.skip) {
            console.log(`⏭  SKIP: ${t.name}`);
            skipped++;
            continue;
        }

        try {
            await t.fn(client);
            console.log(`✓  PASS: ${t.name}`);
            passed++;
        } catch (e) {
            console.log(`✗  FAIL: ${t.name}`);
            console.log(`   ${e.message}`);
            failed++;
        }
    }

    client.stop();

    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed > 0 ? 1 : 0);
}

// Assertion helpers
function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
}

function assertIncludes(array, item, message) {
    if (!array.includes(item)) {
        throw new Error(message || `Expected array to include ${item}`);
    }
}

// ============================================================================
// PROTOCOL TESTS
// ============================================================================

// Initialize response validation
test('initialize returns server info and capabilities', async (client) => {
    // Re-initialize to check response (client already initialized in start())
    const result = await client.call('initialize', { clientInfo: { name: 'test-verify' } });

    assert(result.serverInfo?.name === 'apple-mail-jxa', `Expected server name 'apple-mail-jxa', got '${result.serverInfo?.name}'`);
    assert(result.capabilities?.resources !== undefined, 'Expected resources capability');
});

// ============================================================================
// RESOURCE TESTS
// ============================================================================

// Resources listing
test('resources/list returns expected resources', async (client) => {
    const result = await client.call('resources/list');
    const uris = result.resources.map(r => r.uri);

    // Check core resources exist
    assertIncludes(uris, 'mail://inbox');
    assertIncludes(uris, 'mail://sent');
    assertIncludes(uris, 'mail://drafts');
    assertIncludes(uris, 'mail://accounts');
    assertIncludes(uris, 'mail://rules');
    assertIncludes(uris, 'mail://signatures');
    assertIncludes(uris, 'mail://settings');

    // Should have accounts
    assert(uris.some(u => u.match(/^mail:\/\/accounts\[\d+\]$/)), 'Expected at least one account resource');
});

// Resource templates
test('resources/templates/list returns templates', async (client) => {
    const result = await client.call('resources/templates/list');

    assert(Array.isArray(result.resourceTemplates), 'Expected resourceTemplates array');
    assert(result.resourceTemplates.length >= 2, 'Expected at least 2 resource templates');
});

// App settings resource
test('resources/read mail://settings', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://settings' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name === 'Mail', 'Expected name to be Mail');
    assert(content.version, 'Expected version to be present');
    assert(typeof content.frontmost === 'boolean', 'Expected frontmost to be boolean');
});

// Rules resource
test('resources/read mail://rules', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://rules' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected rules to be array');
});

// Individual rule
test('resources/read mail://rules[0] returns rule details', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://rules[0]' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected rule name');
    assert(typeof content.enabled === 'boolean', 'Expected enabled to be boolean');
});

// Signatures resource
test('resources/read mail://signatures', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://signatures' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected signatures to be array');
});

// Inbox resource
test('resources/read mail://inbox', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://inbox' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected name');
    assert(typeof content.unreadCount === 'number', 'Expected unreadCount');
});

// Accounts collection
test('resources/read mail://accounts returns accounts array', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected accounts array');
    assert(content.length > 0, 'Expected at least one account');

    const acc = content[0];
    assert(acc.name, 'Expected account name');
    assert(acc.id, 'Expected account id');
});

// Account hierarchy
test('resources/read mail://accounts[0] shows account details', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected account name');
    assert(content.id, 'Expected account id');
    assert(Array.isArray(content.emailAddresses), 'Expected emailAddresses array');
});

// Mailbox listing
test('resources/read mail://accounts[0]/mailboxes returns mailboxes', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected mailboxes array');

    if (content.length > 0) {
        const mb = content[0];
        assert(mb.name, 'Expected mailbox name');
        assert(typeof mb.unreadCount === 'number', 'Expected unreadCount');
    }
});

// Message listing via inbox
test('resources/read mail://inbox/messages with limit', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://inbox/messages?limit=5' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected messages array');

    if (content.length > 0) {
        const msg = content[0];
        assert(msg.id !== undefined, 'Expected message id');
        assert(msg.subject !== undefined, 'Expected message subject');
        assert(typeof msg.readStatus === 'boolean', 'Expected message readStatus');
    }
});

// Individual message
test('resources/read mail://inbox/messages[0] returns message details', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://inbox/messages[0]' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.id !== undefined, 'Expected id');
    assert(content.subject !== undefined, 'Expected subject');
    assert(content.sender, 'Expected sender');
});

// Pagination
test('resources/read with pagination (limit)', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?limit=3' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    assert(content.length <= 3, `Expected at most 3 items, got ${content.length}`);
});

// Filtering
test('resources/read with filter', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?unreadCount.gt=0' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    for (const mb of content) {
        assert(mb.unreadCount > 0, `Expected unreadCount > 0, got ${mb.unreadCount}`);
    }
});

// Sorting
test('resources/read with sort', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?sort=unreadCount.desc&limit=5' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    for (let i = 1; i < content.length; i++) {
        assert(content[i-1].unreadCount >= content[i].unreadCount, 'Expected descending order');
    }
});

// Error handling
test('resources/read unknown resource returns error', async (client) => {
    try {
        await client.call('resources/read', { uri: 'mail://nonexistent' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('Unknown segment') || e.message.includes('not found') || e.message.includes('Resource'), 'Expected not found error');
    }
});

// ============================================================================
// TOOL TESTS (SKIPPED - Phase 1 is resources-only)
// ============================================================================

// Tools listing
skip('tools/list returns expected tools', async (client) => {
    const result = await client.call('tools/list');
    const names = result.tools.map(t => t.name);

    // Check core tools exist
    assertIncludes(names, 'list_messages');
    assertIncludes(names, 'get_message');
    assertIncludes(names, 'compose_email');
    assertIncludes(names, 'get_selection');
    assertIncludes(names, 'list_attachments');
    assertIncludes(names, 'create_rule');
    assertIncludes(names, 'create_signature');

    assert(names.length >= 18, `Expected at least 18 tools, got ${names.length}`);
});

// Tool annotations
skip('tools/list includes annotations', async (client) => {
    const result = await client.call('tools/list');

    // Check some tools have expected annotations
    const listMessages = result.tools.find(t => t.name === 'list_messages');
    assert(listMessages.annotations?.readOnlyHint === true, 'Expected list_messages to have readOnlyHint');

    const deleteMessage = result.tools.find(t => t.name === 'delete_message');
    assert(deleteMessage.annotations?.destructiveHint === true, 'Expected delete_message to have destructiveHint');

    const markRead = result.tools.find(t => t.name === 'mark_read');
    assert(markRead.annotations?.idempotentHint === true, 'Expected mark_read to have idempotentHint');

    const toggleFlag = result.tools.find(t => t.name === 'toggle_flag');
    assert(toggleFlag.annotations?.idempotentHint === false, 'Expected toggle_flag to have idempotentHint=false');
});

// Get selection tool
skip('tools/call get_selection', async (client) => {
    const result = await client.call('tools/call', { name: 'get_selection' });
    const content = JSON.parse(result.content[0].text);

    assert(typeof content.count === 'number', 'Expected count');
    assert(Array.isArray(content.messages), 'Expected messages array');
});

// Get windows tool
skip('tools/call get_windows', async (client) => {
    const result = await client.call('tools/call', { name: 'get_windows' });
    const windows = JSON.parse(result.content[0].text);

    assert(Array.isArray(windows), 'Expected windows array');
});

// List messages tool
skip('tools/call list_messages', async (client) => {
    const result = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Inbox', limit: 3 }
    });
    const messages = JSON.parse(result.content[0].text);
    assert(Array.isArray(messages), 'Expected messages array');
});

// Get message tool
skip('tools/call get_message', async (client) => {
    // First get a message URL
    const listResult = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Inbox', limit: 1 }
    });
    const messages = JSON.parse(listResult.content[0].text);
    if (messages.length === 0) throw new Error('No message to test');

    const result = await client.call('tools/call', {
        name: 'get_message',
        arguments: { url: messages[0].url }
    });
    const details = JSON.parse(result.content[0].text);

    assert(details.subject, 'Expected subject');
    assert(details.url, 'Expected url');
});

// List attachments tool
skip('tools/call list_attachments', async (client) => {
    const listResult = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Inbox', limit: 1 }
    });
    const messages = JSON.parse(listResult.content[0].text);
    if (messages.length === 0) throw new Error('No message to test');

    const result = await client.call('tools/call', {
        name: 'list_attachments',
        arguments: { url: messages[0].url }
    });
    const text = result.content[0].text;

    if (!text.startsWith('Error:')) {
        const attachments = JSON.parse(text);
        assert(Array.isArray(attachments), 'Expected attachments array');
    }
});

// Mark read/unread tools
skip('tools/call mark_read and mark_unread', async (client) => {
    const listResult = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Inbox', limit: 1 }
    });
    const messages = JSON.parse(listResult.content[0].text);
    if (messages.length === 0) throw new Error('No message to test');

    const msg = messages[0];
    const originalRead = msg.read;

    // Toggle to opposite state
    if (originalRead) {
        await client.call('tools/call', { name: 'mark_unread', arguments: { url: msg.url } });
    } else {
        await client.call('tools/call', { name: 'mark_read', arguments: { url: msg.url } });
    }

    // Restore original state
    if (originalRead) {
        await client.call('tools/call', { name: 'mark_read', arguments: { url: msg.url } });
    } else {
        await client.call('tools/call', { name: 'mark_unread', arguments: { url: msg.url } });
    }
});

// Toggle flag tool
skip('tools/call toggle_flag', async (client) => {
    const listResult = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Inbox', limit: 1 }
    });
    const messages = JSON.parse(listResult.content[0].text);
    if (messages.length === 0) throw new Error('No message to test');

    const msg = messages[0];

    // Toggle twice to restore
    await client.call('tools/call', { name: 'toggle_flag', arguments: { url: msg.url } });
    await client.call('tools/call', { name: 'toggle_flag', arguments: { url: msg.url } });
});

// Move and delete tools
skip('tools/call move_message and delete_message', async (client) => {
    // Find a message in Trash
    const result = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: 'Trash', limit: 1 }
    });
    const messages = JSON.parse(result.content[0].text);
    if (messages.length === 0) {
        throw new Error('No message in Trash to test');
    }
    const msg = messages[0];

    // Move from Trash to Drafts
    const moveResult = await client.call('tools/call', {
        name: 'move_message',
        arguments: { url: msg.url, toMailbox: 'Drafts' }
    });
    assert(moveResult.content[0].text.includes('Moved'), 'Expected move confirmation');

    // Delete to put it back in Trash
    const deleteResult = await client.call('tools/call', {
        name: 'delete_message',
        arguments: { url: msg.url }
    });
    assertEqual(deleteResult.content[0].text, 'Deleted', 'Expected delete confirmation');
});

// Unknown tool error
skip('tools/call unknown tool returns error', async (client) => {
    try {
        await client.call('tools/call', { name: 'nonexistent_tool' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('Unknown tool'), 'Expected unknown tool error');
    }
});

// Rule CRUD
skip('CRUD: rule lifecycle (create, read, update, delete)', async (client) => {
    const TEST_RULE_NAME = '__MCP_TEST_RULE__';

    // Clean up any leftover test rule
    try {
        await client.call('tools/call', { name: 'delete_rule', arguments: { name: TEST_RULE_NAME } });
    } catch (e) { /* ignore */ }

    // CREATE
    const createResult = await client.call('tools/call', {
        name: 'create_rule',
        arguments: { name: TEST_RULE_NAME, enabled: false }
    });
    const created = JSON.parse(createResult.content[0].text);
    assert(created.created, 'Expected rule to be created');

    // READ
    const rulesResult = await client.call('resources/read', { uri: 'mail://rules' });
    const rules = JSON.parse(rulesResult.contents[0].text);
    assert(rules.some(r => r.name === TEST_RULE_NAME), 'Expected test rule in rules list');

    // UPDATE
    const updateResult = await client.call('tools/call', {
        name: 'update_rule',
        arguments: { name: TEST_RULE_NAME, newName: TEST_RULE_NAME + '_updated', enabled: true }
    });
    const updated = JSON.parse(updateResult.content[0].text);
    assert(updated.updated, 'Expected rule to be updated');

    // DELETE
    const deleteResult = await client.call('tools/call', {
        name: 'delete_rule',
        arguments: { name: TEST_RULE_NAME + '_updated' }
    });
    const deleted = JSON.parse(deleteResult.content[0].text);
    assert(deleted.deleted, 'Expected rule to be deleted');
});

// Signature CRUD
skip('CRUD: signature lifecycle (create, read, update, delete)', async (client) => {
    const TEST_SIGNATURE_NAME = '__MCP_TEST_SIGNATURE__';

    // Clean up any leftover test signature
    try {
        await client.call('tools/call', { name: 'delete_signature', arguments: { name: TEST_SIGNATURE_NAME } });
    } catch (e) { /* ignore */ }

    // CREATE
    const createResult = await client.call('tools/call', {
        name: 'create_signature',
        arguments: { name: TEST_SIGNATURE_NAME, content: 'Test signature content.' }
    });
    const created = JSON.parse(createResult.content[0].text);
    assert(created.created, 'Expected signature to be created');

    // READ
    const sigsResult = await client.call('resources/read', { uri: 'mail://signatures' });
    const sigs = JSON.parse(sigsResult.contents[0].text);
    assert(sigs.some(s => s.name === TEST_SIGNATURE_NAME), 'Expected test signature in list');

    // UPDATE
    const updateResult = await client.call('tools/call', {
        name: 'update_signature',
        arguments: { name: TEST_SIGNATURE_NAME, newName: TEST_SIGNATURE_NAME + '_updated', content: 'Updated.' }
    });
    const updated = JSON.parse(updateResult.content[0].text);
    assert(updated.updated, 'Expected signature to be updated');

    // DELETE
    const deleteResult = await client.call('tools/call', {
        name: 'delete_signature',
        arguments: { name: TEST_SIGNATURE_NAME + '_updated' }
    });
    const deleted = JSON.parse(deleteResult.content[0].text);
    assert(deleted.deleted, 'Expected signature to be deleted');
});

// Run
runTests().catch(console.error);
