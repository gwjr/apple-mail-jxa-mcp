#!/usr/bin/env node

// Resource Test Suite for Apple Mail MCP Server
// Tests the mail:// resource hierarchy

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

    assert(uris.includes('mail://inbox'), 'Expected mail://inbox');
    assert(uris.includes('mail://sent'), 'Expected mail://sent');
    assert(uris.includes('mail://drafts'), 'Expected mail://drafts');
    assert(uris.includes('mail://accounts'), 'Expected mail://accounts');
    assert(uris.includes('mail://rules'), 'Expected mail://rules');
    assert(uris.includes('mail://signatures'), 'Expected mail://signatures');
    assert(uris.includes('mail://settings'), 'Expected mail://settings');
});

test('resources/list returns account resources', async (client) => {
    const result = await client.call('resources/list');
    const accountResources = result.resources.filter(r => r.uri.match(/^mail:\/\/accounts\[\d+\]$/));

    // Should have at least one account
    assert(accountResources.length > 0, 'Expected at least one account resource');
});

test('resources/templates/list returns templates', async (client) => {
    const result = await client.call('resources/templates/list');

    assert(Array.isArray(result.resourceTemplates), 'Expected templates array');
    assert(result.resourceTemplates.length >= 5, `Expected at least 5 templates, got ${result.resourceTemplates.length}`);
});

test('mail://settings returns app settings', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://settings' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name === 'Mail', `Expected name 'Mail', got '${content.name}'`);
    assert(content.version, 'Expected version');
    assertType(content.frontmost, 'boolean', 'frontmost');
});

test('mail://rules returns rules array', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://rules' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected rules to be array');
});

test('mail://signatures returns signatures array', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://signatures' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected signatures to be array');
});

test('mail://accounts returns accounts array', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected accounts array');
    assert(content.length > 0, 'Expected at least one account');

    const acc = content[0];
    assert(acc.name, 'Expected account name');
    assert(acc.id, 'Expected account id');
});

test('mail://accounts[0] returns account details', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected name');
    assert(content.id, 'Expected id');
    assert(Array.isArray(content.emailAddresses), 'Expected emailAddresses array');
});

test('mail://accounts[0]/mailboxes returns mailbox list', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected mailboxes array');

    if (content.length > 0) {
        const mb = content[0];
        assert(mb.name, 'Expected mailbox name');
        assertType(mb.unreadCount, 'number', 'unreadCount');
    }
});

test('mail://inbox returns inbox details', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://inbox' });
    const content = JSON.parse(result.contents[0].text);

    assert(content.name, 'Expected inbox name');
    assertType(content.unreadCount, 'number', 'unreadCount');
});

test('mail://inbox/messages returns messages array', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://inbox/messages?limit=5' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected messages array');
});

test('individual message reading works', async (client) => {
    // Get a message from inbox
    const msgsResult = await client.call('resources/read', { uri: 'mail://inbox/messages?limit=1' });
    const messages = JSON.parse(msgsResult.contents[0].text);

    if (messages.length === 0) {
        throw new Error('No messages found to test');
    }

    // Read first message by index
    const result = await client.call('resources/read', { uri: 'mail://inbox/messages[0]' });
    const msg = JSON.parse(result.contents[0].text);

    assertType(msg.id, 'number', 'id');
    assert(msg.subject !== undefined, 'Expected subject');
    assert(msg.sender, 'Expected sender');
});

test('unknown resource returns error', async (client) => {
    try {
        await client.call('resources/read', { uri: 'mail://nonexistent' });
        throw new Error('Should have thrown');
    } catch (e) {
        assert(e.message.includes('Unknown segment') || e.message.includes('not found') || e.message.includes('Resource'),
            `Expected error about unknown resource, got: ${e.message}`);
    }
});

test('pagination works', async (client) => {
    // Test with limit
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?limit=3' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    assert(content.length <= 3, `Expected at most 3 items, got ${content.length}`);
});

test('filtering works', async (client) => {
    // Filter mailboxes with unread > 0
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?unreadCount.gt=0' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    // All returned mailboxes should have unreadCount > 0
    for (const mb of content) {
        assert(mb.unreadCount > 0, `Expected unreadCount > 0, got ${mb.unreadCount}`);
    }
});

test('sorting works', async (client) => {
    const result = await client.call('resources/read', { uri: 'mail://accounts[0]/mailboxes?sort=unreadCount.desc&limit=5' });
    const content = JSON.parse(result.contents[0].text);

    assert(Array.isArray(content), 'Expected array');
    // Verify descending order
    for (let i = 1; i < content.length; i++) {
        assert(content[i-1].unreadCount >= content[i].unreadCount,
            `Expected descending order at index ${i}`);
    }
});

// Run tests
runTests().catch(console.error);
