#!/usr/bin/env node

// Test suite for mail.js MCP server
// Runs protocol-level tests against the JXA MCP server

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, 'mail.js');
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
                // Debug output goes to stderr
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
    const client = new MCPTestClient();

    console.log('Starting MCP server...');
    await client.start();
    console.log('Server started.\n');

    for (const t of tests) {
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

// ============ TESTS ============

// Tools listing
test('tools/list returns expected tools', async (client) => {
    const result = await client.call('tools/list');
    const names = result.tools.map(t => t.name);

    // Check core tools exist
    assertIncludes(names, 'list_messages');
    assertIncludes(names, 'get_message');
    assertIncludes(names, 'send_email');
    assertIncludes(names, 'get_selection');
    assertIncludes(names, 'list_attachments');
    assertIncludes(names, 'create_rule');
    assertIncludes(names, 'create_signature');

    assert(names.length >= 19, `Expected at least 19 tools, got ${names.length}`);
});

// Resources listing
test('resources/list returns expected resources', async (client) => {
    const result = await client.call('resources/list');
    const uris = result.resources.map(r => r.uri);

    // Check core resources exist
    assertIncludes(uris, 'mail://properties');
    assertIncludes(uris, 'mail://rules');
    assertIncludes(uris, 'mail://signatures');
    assertIncludes(uris, 'unified://inbox');

    // Should have accounts
    assert(uris.some(u => u.startsWith('mailaccount://')), 'Expected at least one mailaccount resource');
});

// App properties resource
test('resources/read mail://properties', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://properties' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name === 'Mail', 'Expected name to be Mail');
    assert(content.version, 'Expected version to be present');
    assert(typeof content.frontmost === 'boolean', 'Expected frontmost to be boolean');
});

// Rules resource
test('resources/read mail://rules', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://rules' });
    const content = JSON.parse(result.contents[0].text);

    assert(typeof content.count === 'number', 'Expected count to be number');
    assert(Array.isArray(content.rules), 'Expected rules to be array');
});

// Signatures resource
test('resources/read mail://signatures', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://signatures' });
    const content = JSON.parse(result.contents[0].text);

    assert(typeof content.count === 'number', 'Expected count to be number');
    assert(Array.isArray(content.signatures), 'Expected signatures to be array');
});

// Unified inbox resource
test('resources/read unified://inbox', async (client) => {
    const result = await client.call('resources/read', { uri: 'unified://inbox' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name === 'inbox', 'Expected name to be inbox');
    assert(typeof content.unreadCount === 'number', 'Expected unreadCount');
    assert(typeof content.messageCount === 'number', 'Expected messageCount');
});

// Account hierarchy
test('resources/read mailaccount:// shows top-level mailboxes', async (client) => {
    const list = await client.call('resources/list');
    const accountUri = list.resources.find(r => r.uri.startsWith('mailaccount://'))?.uri;
    if (!accountUri) throw new Error('No account found');

    const result = await client.call('resources/read', { uri: accountUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.account, 'Expected account name');
    assert(Array.isArray(content.mailboxes), 'Expected mailboxes array');

    // Verify mailboxes have expected structure
    if (content.mailboxes.length > 0) {
        const mb = content.mailboxes[0];
        assert(mb.uri, 'Expected mailbox uri');
        assert(mb.name, 'Expected mailbox name');
        assert(typeof mb.hasChildren === 'boolean', 'Expected hasChildren boolean');
    }
});

// Get selection tool
test('tools/call get_selection', async (client) => {
    const result = await client.call('tools/call', { name: 'get_selection' });
    const content = JSON.parse(result.content[0].text);

    assert(typeof content.count === 'number', 'Expected count');
    assert(Array.isArray(content.messages), 'Expected messages array');
});

// Get windows tool
test('tools/call get_windows', async (client) => {
    const result = await client.call('tools/call', { name: 'get_windows' });
    const windows = JSON.parse(result.content[0].text);

    assert(Array.isArray(windows), 'Expected windows array');
});

// Check mail tool
test('tools/call check_mail', async (client) => {
    const result = await client.call('tools/call', { name: 'check_mail' });
    assertEqual(result.content[0].text, 'Checking...');
});

// List messages - discovers a mailbox from account hierarchy
test('tools/call list_messages on discovered mailbox', async (client) => {
    // Find an account and its first mailbox
    const list = await client.call('resources/list');
    const accountUri = list.resources.find(r => r.uri.startsWith('mailaccount://'))?.uri;
    if (!accountUri) throw new Error('No account found to test');

    const accountResult = await client.call('resources/read', { uri: accountUri });
    const account = JSON.parse(accountResult.contents[0].text);
    if (!account.mailboxes || account.mailboxes.length === 0) {
        throw new Error('No mailboxes found to test');
    }

    // Try to find Inbox, or use first mailbox
    const inboxMb = account.mailboxes.find(m => m.name.toLowerCase() === 'inbox');
    const testMailbox = inboxMb || account.mailboxes[0];

    const result = await client.call('tools/call', {
        name: 'list_messages',
        arguments: { mailbox: testMailbox.name, limit: 3 }
    });

    // Should return a JSON array (might be empty)
    const messages = JSON.parse(result.content[0].text);
    assert(Array.isArray(messages), 'Expected messages array');
});

// Error handling
test('tools/call unknown tool returns error', async (client) => {
    try {
        await client.call('tools/call', { name: 'nonexistent_tool' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('Unknown tool'), 'Expected unknown tool error');
    }
});

test('resources/read unknown resource returns error', async (client) => {
    try {
        await client.call('resources/read', { uri: 'mail://nonexistent' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('not found') || e.message.includes('Resource'), 'Expected not found error');
    }
});

// Integration tests - actually modify Mail state (but clean up)
const TEST_RULE_NAME = '__MCP_TEST_RULE__';
const TEST_SIGNATURE_NAME = '__MCP_TEST_SIGNATURE__';

test('CRUD: rule lifecycle (create, read, update, delete)', async (client) => {
    // Clean up any leftover test rule from previous failed runs
    try {
        await client.call('tools/call', { name: 'delete_rule', arguments: { name: TEST_RULE_NAME } });
    } catch (e) { /* ignore */ }
    try {
        await client.call('tools/call', { name: 'delete_rule', arguments: { name: TEST_RULE_NAME + '_updated' } });
    } catch (e) { /* ignore */ }

    // CREATE (without conditions - conditions have enum issues in JXA)
    const createResult = await client.call('tools/call', {
        name: 'create_rule',
        arguments: {
            name: TEST_RULE_NAME,
            enabled: false
        }
    });
    const createText = createResult.content[0].text;
    if (createText.startsWith('Error:')) throw new Error(createText);
    const created = JSON.parse(createText);
    assert(created.created, 'Expected rule to be created');

    // READ - verify it exists in rules list
    const rulesResult = await client.call('resources/read', { uri: 'mail://rules' });
    const rules = JSON.parse(rulesResult.contents[0].text);
    assert(rules.rules.some(r => r.name === TEST_RULE_NAME), 'Expected test rule in rules list');

    // UPDATE
    const updateResult = await client.call('tools/call', {
        name: 'update_rule',
        arguments: { name: TEST_RULE_NAME, newName: TEST_RULE_NAME + '_updated', enabled: true }
    });
    const updateText = updateResult.content[0].text;
    if (updateText.startsWith('Error:')) throw new Error('update_rule: ' + updateText);
    const updated = JSON.parse(updateText);
    assert(updated.updated, 'Expected rule to be updated');

    // Verify update
    const rulesResult2 = await client.call('resources/read', { uri: 'mail://rules' });
    const rules2 = JSON.parse(rulesResult2.contents[0].text);
    const updatedRule = rules2.rules.find(r => r.name === TEST_RULE_NAME + '_updated');
    assert(updatedRule, 'Expected renamed rule in rules list');
    assert(updatedRule.enabled === true, 'Expected rule to be enabled');

    // DELETE
    const deleteResult = await client.call('tools/call', {
        name: 'delete_rule',
        arguments: { name: TEST_RULE_NAME + '_updated' }
    });
    const deleteText = deleteResult.content[0].text;
    if (deleteText.startsWith('Error:')) throw new Error('delete_rule: ' + deleteText);
    const deleted = JSON.parse(deleteText);
    assert(deleted.deleted, 'Expected rule to be deleted');

    // Verify deletion
    const rulesResult3 = await client.call('resources/read', { uri: 'mail://rules' });
    const rules3 = JSON.parse(rulesResult3.contents[0].text);
    assert(!rules3.rules.some(r => r.name === TEST_RULE_NAME + '_updated'), 'Expected test rule to be gone');
});

test('CRUD: signature lifecycle (create, read, update, delete)', async (client) => {
    // Clean up any leftover test signature
    try {
        await client.call('tools/call', { name: 'delete_signature', arguments: { name: TEST_SIGNATURE_NAME } });
    } catch (e) { /* ignore */ }
    try {
        await client.call('tools/call', { name: 'delete_signature', arguments: { name: TEST_SIGNATURE_NAME + '_updated' } });
    } catch (e) { /* ignore */ }

    // CREATE
    const createResult = await client.call('tools/call', {
        name: 'create_signature',
        arguments: {
            name: TEST_SIGNATURE_NAME,
            content: 'Test signature content from MCP test suite.'
        }
    });
    const createText = createResult.content[0].text;
    if (createText.startsWith('Error:')) throw new Error(createText);
    const created = JSON.parse(createText);
    assert(created.created, 'Expected signature to be created');

    // READ - verify it exists
    const sigsResult = await client.call('resources/read', { uri: 'mail://signatures' });
    const sigs = JSON.parse(sigsResult.contents[0].text);
    assert(sigs.signatures.some(s => s.name === TEST_SIGNATURE_NAME), 'Expected test signature in list');

    // Read individual signature
    const sigResult = await client.call('resources/read', {
        uri: `mail://signatures/${encodeURIComponent(TEST_SIGNATURE_NAME)}`
    });
    const sigText = sigResult.contents[0].text;
    const sigContent = JSON.parse(sigText);
    assert(sigContent.content && sigContent.content.includes('Test signature content'), 'Expected signature content');

    // UPDATE
    const updateResult = await client.call('tools/call', {
        name: 'update_signature',
        arguments: {
            name: TEST_SIGNATURE_NAME,
            newName: TEST_SIGNATURE_NAME + '_updated',
            content: 'Updated content.'
        }
    });
    const updateText = updateResult.content[0].text;
    if (updateText.startsWith('Error:')) throw new Error(updateText);
    const updated = JSON.parse(updateText);
    assert(updated.updated, 'Expected signature to be updated');

    // DELETE
    const deleteResult = await client.call('tools/call', {
        name: 'delete_signature',
        arguments: { name: TEST_SIGNATURE_NAME + '_updated' }
    });
    const deleteText = deleteResult.content[0].text;
    if (deleteText.startsWith('Error:')) throw new Error('delete_signature: ' + deleteText);
    const deleted = JSON.parse(deleteText);
    assert(deleted.deleted, 'Expected signature to be deleted');

    // Verify deletion
    const sigsResult2 = await client.call('resources/read', { uri: 'mail://signatures' });
    const sigs2 = JSON.parse(sigsResult2.contents[0].text);
    assert(!sigs2.signatures.some(s => s.name === TEST_SIGNATURE_NAME + '_updated'), 'Expected test signature to be gone');
});

// Run
runTests().catch(console.error);
