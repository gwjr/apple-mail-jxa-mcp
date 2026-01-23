#!/usr/bin/env node

// Test case: Resource reading fails while tools work
// This test demonstrates the bug where MCP resources fail to read
// even though the underlying framework and tools function correctly.

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'mail.js');
const TIMEOUT = 15000;

class MCPClient {
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
                resolve(msg);
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
let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ FAIL: ${name}`);
        console.log(`  Error: ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
    console.log('Resource Read Bug Test');
    console.log('======================\n');

    const client = new MCPClient();

    console.log('Starting MCP server...');
    await client.start();
    console.log('Server started.\n');

    // Test 1: Verify the set tool works (baseline - this should pass)
    await test('Set tool works (baseline)', async () => {
        const result = await client.call('tools/call', {
            name: 'set',
            arguments: {
                uri: 'mail://settings/colorQuotedText',
                value: true
            }
        });

        // Check for success (not an error)
        assert(!result.error, `Tool call failed: ${result.error?.message}`);

        const content = result.result.content[0].text;
        assert(!content.startsWith('Error:'), `Tool returned error: ${content}`);

        const parsed = JSON.parse(content);
        assert(parsed.updated === true, 'Expected updated: true');
    });

    // Test 2: Resource read should work but currently fails
    // BUG: This test fails with "Resource not found" even though
    // the tools (which use the same resolveURI) work correctly
    await test('Resource read mail://settings should work', async () => {
        const result = await client.call('resources/read', {
            uri: 'mail://settings'
        });

        // This is where the bug manifests - should not be an error
        assert(!result.error, `Resource read failed: ${result.error?.message}`);

        // If we get here, verify the content
        const content = JSON.parse(result.result.contents[0].text);
        assert(content.name === 'Mail', 'Expected name to be Mail');
    });

    // Test 3: Read accounts collection
    await test('Resource read mail://accounts should work', async () => {
        const result = await client.call('resources/read', {
            uri: 'mail://accounts'
        });

        assert(!result.error, `Resource read failed: ${result.error?.message}`);

        const content = JSON.parse(result.result.contents[0].text);
        assert(Array.isArray(content), 'Expected accounts array');
    });

    // Test 4: Read inbox
    await test('Resource read mail://inbox should work', async () => {
        const result = await client.call('resources/read', {
            uri: 'mail://inbox'
        });

        assert(!result.error, `Resource read failed: ${result.error?.message}`);

        const content = JSON.parse(result.result.contents[0].text);
        assert(content.name, 'Expected inbox to have name');
    });

    // Test 5: Read rules
    await test('Resource read mail://rules should work', async () => {
        const result = await client.call('resources/read', {
            uri: 'mail://rules'
        });

        assert(!result.error, `Resource read failed: ${result.error?.message}`);

        const content = JSON.parse(result.result.contents[0].text);
        assert(Array.isArray(content), 'Expected rules array');
    });

    client.stop();

    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.log('\n--- BUG EXPLANATION ---');
        console.log('The set tool works (Test 1 passes) but resource reads fail.');
        console.log('Both use resolveURI() internally, so the issue is likely');
        console.log('in the resolve() method that actually fetches data from Mail.app.');
        console.log('The readResource function catches exceptions and returns null,');
        console.log('which gets converted to "Resource not found" errors.');
    }

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});
