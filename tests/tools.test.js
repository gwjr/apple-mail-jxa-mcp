#!/usr/bin/env node

// Tool tests via MCP protocol
// Tests move, delete, and mailbox deletion guard using junk/trash mailboxes

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'mail.js');
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
                    // Not JSON, ignore
                }
            });

            this.proc.stderr.on('data', (data) => {
                if (process.env.DEBUG) process.stderr.write(data);
            });

            this.proc.on('error', reject);

            this.call('initialize', { clientInfo: { name: 'tools-test' } })
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

    async readResource(uri) {
        const result = await this.call('resources/read', { uri });
        return JSON.parse(result.contents[0].text);
    }

    async callTool(name, args = {}) {
        const result = await this.call('tools/call', { name, arguments: args });
        const text = result.content[0].text;
        if (text.startsWith('Error:')) {
            throw new Error(text);
        }
        return JSON.parse(text);
    }

    stop() {
        if (this.proc) {
            this.proc.stdin.end();
            this.proc.kill();
        }
    }
}

// Test framework
let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`✓  PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗  FAIL: ${name}`);
        console.log(`   ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

// ============================================================================
// Main test runner
// ============================================================================

async function runTests() {
    const client = new MCPTestClient();

    console.log('Starting MCP server for tools tests...');
    await client.start();
    console.log('Server started.\n');

    // --------------------------------------------------------------------
    // Setup: Find junk and trash, get a test message
    // --------------------------------------------------------------------

    let junkUri, trashUri;
    let testMessageId; // RFC messageId (stable across moves)

    console.log('Setup: Finding junk and trash mailboxes...');

    const junk = await client.readResource('mail://junk');
    const trash = await client.readResource('mail://trash');
    console.log(`  Junk: ${junk.name}`);
    console.log(`  Trash: ${trash.name}`);

    // Get message counts
    const junkMessages = await client.readResource('mail://junk/messages?limit=1');
    const trashMessages = await client.readResource('mail://trash/messages?limit=1');
    const hasJunkMsg = junkMessages.length > 0;
    const hasTrashMsg = trashMessages.length > 0;
    console.log(`  Junk has messages: ${hasJunkMsg}`);
    console.log(`  Trash has messages: ${hasTrashMsg}`);

    if (!hasJunkMsg && !hasTrashMsg) {
        console.log('\nERROR: No messages in junk or trash to test with.');
        console.log('Please move a message to Junk or Trash and run again.');
        client.stop();
        process.exit(1);
    }

    // Get test message details
    const sourceMailbox = hasJunkMsg ? 'junk' : 'trash';
    const sourceMessages = hasJunkMsg ? junkMessages : trashMessages;
    const testMessage = sourceMessages[0];
    testMessageId = testMessage.messageId;
    console.log(`  Test message from ${sourceMailbox}: "${testMessage.subject.substring(0, 40)}..."`);
    console.log(`  RFC messageId: ${testMessageId}`);
    console.log('');

    // --------------------------------------------------------------------
    // Test: Mailbox deletion is blocked
    // --------------------------------------------------------------------

    await test('Mailbox deletion is blocked (standard mailbox)', async () => {
        try {
            await client.callTool('delete', { item: 'mail://junk' });
            throw new Error('Expected deletion to fail');
        } catch (e) {
            assert(e.message.includes('Cannot delete mailboxes'),
                `Expected "Cannot delete mailboxes" error, got: ${e.message}`);
        }
    });

    await test('Mailbox deletion blocked (index addressing)', async () => {
        try {
            await client.callTool('delete', { item: 'mail://accounts[0]/mailboxes[0]' });
            throw new Error('Expected deletion to fail');
        } catch (e) {
            assert(e.message.includes('Cannot delete mailboxes'),
                `Expected "Cannot delete mailboxes" error, got: ${e.message}`);
        }
    });

    await test('Mailbox deletion blocked (name addressing)', async () => {
        try {
            await client.callTool('delete', { item: 'mail://accounts[0]/mailboxes/INBOX' });
            throw new Error('Expected deletion to fail');
        } catch (e) {
            assert(e.message.includes('Cannot delete mailboxes'),
                `Expected "Cannot delete mailboxes" error, got: ${e.message}`);
        }
    });

    // --------------------------------------------------------------------
    // Test: Message delete and move
    // --------------------------------------------------------------------

    if (hasJunkMsg) {
        // Flow: junk -> delete (moves to trash) -> move back to junk

        let messageUri = `mail://junk/messages/${testMessage.id}`;

        await test('Delete message from junk (moves to trash)', async () => {
            const result = await client.callTool('delete', { item: messageUri });
            assert(result.movedToTrash === true, 'Should indicate moved to trash');
        });

        await test('Message found in trash after delete', async () => {
            // Find by messageId in trash
            const trashMsgs = await client.readResource('mail://trash/messages?limit=100');
            const found = trashMsgs.find(m => m.messageId === testMessageId);
            assert(found, 'Message not found in trash after delete');
            // Update URI for next test
            messageUri = `mail://trash/messages/${found.id}`;
            console.log(`     New URI: ${messageUri}`);
        });

        await test('Move message back to junk', async () => {
            const result = await client.callTool('move', {
                item: messageUri,
                destination: 'mail://junk'
            });
            assert(result.uri, 'Should return new URI');
            console.log(`     New URI: ${result.uri}`);
        });

        await test('Message found back in junk after move', async () => {
            const junkMsgs = await client.readResource('mail://junk/messages?limit=100');
            const found = junkMsgs.find(m => m.messageId === testMessageId);
            assert(found, 'Message not found back in junk');
        });

    } else {
        // Flow: trash -> move to junk -> delete (back to trash)

        let messageUri = `mail://trash/messages/${testMessage.id}`;

        await test('Move message from trash to junk', async () => {
            const result = await client.callTool('move', {
                item: messageUri,
                destination: 'mail://junk'
            });
            assert(result.uri, 'Should return new URI');
            messageUri = result.uri;
            console.log(`     New URI: ${messageUri}`);
        });

        await test('Message found in junk after move', async () => {
            const junkMsgs = await client.readResource('mail://junk/messages?limit=100');
            const found = junkMsgs.find(m => m.messageId === testMessageId);
            assert(found, 'Message not found in junk after move');
            messageUri = `mail://junk/messages/${found.id}`;
        });

        await test('Delete message from junk (moves to trash)', async () => {
            const result = await client.callTool('delete', { item: messageUri });
            assert(result.movedToTrash === true, 'Should indicate moved to trash');
        });

        await test('Message found back in trash after delete', async () => {
            const trashMsgs = await client.readResource('mail://trash/messages?limit=100');
            const found = trashMsgs.find(m => m.messageId === testMessageId);
            assert(found, 'Message not found back in trash');
        });
    }

    // --------------------------------------------------------------------
    // Summary
    // --------------------------------------------------------------------

    client.stop();

    console.log('');
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});
