#!/usr/bin/env node

// Resource Test Suite for Apple Mail MCP Server
// Tests the unified mail:// resource hierarchy

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, 'dist', 'mail.js');
const TIMEOUT = 15000;

class MCPTestClient {
    constructor() {
        this.proc = null;
        this.id = 0;
        this.pending = new Map();
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
                    // Not JSON
                }
            });

            this.proc.stderr.on('data', (data) => {
                if (process.env.DEBUG) process.stderr.write(data);
            });

            this.proc.on('error', reject);

            this.call('initialize', { clientInfo: { name: 'resource-test' } })
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

function test(name, fn) {
    tests.push({ name, fn });
}

async function runTests() {
    const client = new MCPTestClient();

    console.log('Resource Test Suite for Apple Mail MCP Server\n');
    console.log('Starting server...');

    try {
        const initResult = await client.start();
        console.log(`Server: ${initResult.serverInfo.name} v${initResult.serverInfo.version}`);
        console.log(`Capabilities: ${Object.keys(initResult.capabilities).join(', ')}\n`);

        for (const t of tests) {
            try {
                await t.fn(client);
                console.log(`✓ ${t.name}`);
                passed++;
            } catch (e) {
                console.log(`✗ ${t.name}`);
                console.log(`  Error: ${e.message}`);
                failed++;
            }
        }
    } catch (e) {
        console.log(`Fatal: ${e.message}`);
        failed++;
    } finally {
        client.stop();
    }

    console.log(`\n========================================`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);

    process.exit(failed > 0 ? 1 : 0);
}

// Assertion helpers
function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertType(value, type, name) {
    assert(typeof value === type, `Expected ${name} to be ${type}, got ${typeof value}`);
}

// ============================================================================
// TESTS
// ============================================================================

test('resources/list returns core resources', async (client) => {
    const result = await client.call('resources/list');
    const uris = result.resources.map(r => r.uri);

    assert(uris.includes('mail://properties'), 'Expected mail://properties');
    assert(uris.includes('mail://rules'), 'Expected mail://rules');
    assert(uris.includes('mail://signatures'), 'Expected mail://signatures');
    assert(uris.includes('mail://accounts'), 'Expected mail://accounts');
});

test('resources/list returns accounts', async (client) => {
    const result = await client.call('resources/list');
    const accountResources = result.resources.filter(r => r.uri.startsWith('mail://accounts/'));

    // Should have at least one account (the test environment must have Mail configured)
    assert(accountResources.length > 0, 'Expected at least one account resource');
});

test('resources/templates/list returns templates', async (client) => {
    const result = await client.call('resources/templates/list');

    assert(Array.isArray(result.resourceTemplates), 'Expected templates array');
    assert(result.resourceTemplates.length >= 5, `Expected at least 5 templates, got ${result.resourceTemplates.length}`);

    // Check for key templates
    const templates = result.resourceTemplates.map(t => t.uriTemplate);
    assert(templates.some(t => t.includes('/messages')), 'Expected messages template');
});

test('mail://properties returns app info', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://properties' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name === 'Mail', `Expected name 'Mail', got '${content.name}'`);
    assert(content.version, 'Expected version');
    assertType(content.frontmost, 'boolean', 'frontmost');
});

test('mail://rules returns rules list', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://rules' });
    const content = JSON.parse(result.contents[0].text);

    assertType(content.count, 'number', 'count');
    assert(Array.isArray(content.rules), 'Expected rules array');

    if (content.rules.length > 0) {
        assert(content.rules[0].uri, 'Expected rule URI');
        assert(content.rules[0].name !== undefined, 'Expected rule name');
    }
});

test('mail://signatures returns signatures list', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://signatures' });
    const content = JSON.parse(result.contents[0].text);

    assertType(content.count, 'number', 'count');
    assert(Array.isArray(content.signatures), 'Expected signatures array');
});

test('mail://accounts returns accounts list', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content.accounts), 'Expected accounts array');
    assert(content.accounts.length > 0, 'Expected at least one account');

    const acc = content.accounts[0];
    assert(acc.name, 'Expected account name');
    assert(acc.uri, 'Expected account URI');
    assert(acc.mailboxesUri, 'Expected mailboxesUri');
});

test('mail://accounts/{name} returns account details', async (client) => {
    // First get account list
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const accountUri = accounts[0].uri;

    const result = await client.call('resources/read', { uri: accountUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected name');
    assert(content.uri, 'Expected uri');
    assert(content.mailboxesUri, 'Expected mailboxesUri');
    assert(Array.isArray(content.emailAddresses), 'Expected emailAddresses array');
});

test('mail://accounts/{name}/mailboxes returns mailbox list', async (client) => {
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const mailboxesUri = accounts[0].mailboxesUri;

    const result = await client.call('resources/read', { uri: mailboxesUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.accountUri, 'Expected accountUri');
    assert(Array.isArray(content.mailboxes), 'Expected mailboxes array');

    if (content.mailboxes.length > 0) {
        const mb = content.mailboxes[0];
        assert(mb.name, 'Expected mailbox name');
        assert(mb.uri, 'Expected mailbox uri');
        assert(mb.messagesUri, 'Expected messagesUri');
        assert(mb.mailboxesUri, 'Expected mailboxesUri');
        assertType(mb.unreadCount, 'number', 'unreadCount');
        assertType(mb.hasChildren, 'boolean', 'hasChildren');
    }
});

test('mailbox messages listing works', async (client) => {
    // Navigate to find a mailbox with messages
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const mailboxesUri = accounts[0].mailboxesUri;

    const mbResult = await client.call('resources/read', { uri: mailboxesUri });
    const mailboxes = JSON.parse(mbResult.contents[0].text).mailboxes;

    // Find INBOX or first mailbox
    const inbox = mailboxes.find(m => m.name.toLowerCase() === 'inbox') || mailboxes[0];
    if (!inbox) {
        throw new Error('No mailbox found to test');
    }

    const result = await client.call('resources/read', { uri: inbox.messagesUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.mailboxUri, 'Expected mailboxUri');
    assertType(content.limit, 'number', 'limit');
    assertType(content.offset, 'number', 'offset');
    assert(Array.isArray(content.messages), 'Expected messages array');

    if (content.messages.length > 0) {
        const msg = content.messages[0];
        assertType(msg.id, 'number', 'message id');
        assert(msg.uri, 'Expected message uri');
        assert(msg.messageUrl, 'Expected messageUrl (Apple URL)');
    }
});

test('individual message reading works', async (client) => {
    // Navigate to find a message
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const mailboxesUri = accounts[0].mailboxesUri;

    const mbResult = await client.call('resources/read', { uri: mailboxesUri });
    const mailboxes = JSON.parse(mbResult.contents[0].text).mailboxes;

    const inbox = mailboxes.find(m => m.name.toLowerCase() === 'inbox') || mailboxes[0];
    if (!inbox) {
        throw new Error('No mailbox found');
    }

    const msgsResult = await client.call('resources/read', { uri: inbox.messagesUri });
    const messages = JSON.parse(msgsResult.contents[0].text).messages;

    if (messages.length === 0) {
        throw new Error('No messages found to test');
    }

    const msgUri = messages[0].uri;
    const result = await client.call('resources/read', { uri: msgUri });
    const msg = JSON.parse(result.contents[0].text);

    assertType(msg.id, 'number', 'id');
    assert(msg.uri, 'Expected uri');
    assert(msg.messageUrl, 'Expected messageUrl');
    // Full message should have content
    assert('content' in msg || 'toRecipients' in msg, 'Expected full message details');
});

test('message attachments resource works', async (client) => {
    // Navigate to find a message
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const mailboxesUri = accounts[0].mailboxesUri;

    const mbResult = await client.call('resources/read', { uri: mailboxesUri });
    const mailboxes = JSON.parse(mbResult.contents[0].text).mailboxes;

    const inbox = mailboxes.find(m => m.name.toLowerCase() === 'inbox') || mailboxes[0];
    if (!inbox) {
        throw new Error('No mailbox found');
    }

    const msgsResult = await client.call('resources/read', { uri: inbox.messagesUri });
    const messages = JSON.parse(msgsResult.contents[0].text).messages;

    if (messages.length === 0) {
        throw new Error('No messages found');
    }

    const msgUri = messages[0].uri;
    const attachmentsUri = msgUri + '/attachments';

    const result = await client.call('resources/read', { uri: attachmentsUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.messageUri, 'Expected messageUri');
    assert(Array.isArray(content.attachments), 'Expected attachments array');
});

test('unknown resource returns error', async (client) => {
    try {
        await client.call('resources/read', { uri: 'mail://nonexistent' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('not found') || e.message.includes('Resource'),
            `Expected not found error, got: ${e.message}`);
    }
});

test('pagination works', async (client) => {
    // Find a mailbox
    const listResult = await client.call('resources/read', { uri: 'mail://accounts' });
    const accounts = JSON.parse(listResult.contents[0].text).accounts;
    const mailboxesUri = accounts[0].mailboxesUri;

    const mbResult = await client.call('resources/read', { uri: mailboxesUri });
    const mailboxes = JSON.parse(mbResult.contents[0].text).mailboxes;
    const inbox = mailboxes.find(m => m.name.toLowerCase() === 'inbox') || mailboxes[0];

    if (!inbox) {
        throw new Error('No mailbox found');
    }

    // Test with limit and offset
    const paginatedUri = inbox.messagesUri + '?limit=5&offset=0';
    const result = await client.call('resources/read', { uri: paginatedUri });
    const content = JSON.parse(result.contents[0].text);

    assert(content.limit === 5, `Expected limit 5, got ${content.limit}`);
    assert(content.offset === 0, `Expected offset 0, got ${content.offset}`);
});

// Run tests
runTests().catch(console.error);
