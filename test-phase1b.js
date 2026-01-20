#!/usr/bin/env node

// Phase 1B Test: Core infrastructure verification
// Tests basic MCP protocol with minimal resource handlers

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SERVER_PATH = path.join(__dirname, 'dist', 'mail.js');
const TIMEOUT = 10000;

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
                process.stderr.write(data);
            });

            this.proc.on('error', reject);

            // Initialize
            this.call('initialize', { clientInfo: { name: 'phase1b-test' } })
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

async function runTests() {
    const client = new MCPTestClient();
    let passed = 0;
    let failed = 0;

    console.log('Phase 1B Infrastructure Test\n');
    console.log('Starting MCP server...');

    try {
        const initResult = await client.start();
        console.log('Server started successfully.\n');

        // Test 1: Initialize response
        console.log('Test 1: Initialize response');
        if (initResult.serverInfo?.name === 'apple-mail-jxa') {
            console.log('  ✓ Server name correct');
            passed++;
        } else {
            console.log('  ✗ Server name incorrect:', initResult.serverInfo?.name);
            failed++;
        }
        if (initResult.capabilities?.resources !== undefined) {
            console.log('  ✓ Resources capability present');
            passed++;
        } else {
            console.log('  ✗ Resources capability missing');
            failed++;
        }

        // Test 2: Resources list
        console.log('\nTest 2: Resources list');
        const listResult = await client.call('resources/list');
        if (Array.isArray(listResult.resources)) {
            console.log('  ✓ Resources is an array');
            passed++;
        } else {
            console.log('  ✗ Resources is not an array');
            failed++;
        }
        const resourceUris = listResult.resources.map(r => r.uri);
        if (resourceUris.includes('mail://properties')) {
            console.log('  ✓ mail://properties in list');
            passed++;
        } else {
            console.log('  ✗ mail://properties not in list');
            failed++;
        }
        console.log(`  Resources found: ${resourceUris.join(', ')}`);

        // Test 3: Read mail://properties
        console.log('\nTest 3: Read mail://properties');
        const propsResult = await client.call('resources/read', { uri: 'mail://properties' });
        if (propsResult.contents && propsResult.contents[0]) {
            console.log('  ✓ Got contents');
            passed++;
            const content = JSON.parse(propsResult.contents[0].text);
            console.log(`  Content: ${JSON.stringify(content)}`);
        } else {
            console.log('  ✗ No contents');
            failed++;
        }

        // Test 4: Read mail://rules
        console.log('\nTest 4: Read mail://rules');
        const rulesResult = await client.call('resources/read', { uri: 'mail://rules' });
        if (rulesResult.contents && rulesResult.contents[0]) {
            console.log('  ✓ Got rules content');
            passed++;
            const content = JSON.parse(rulesResult.contents[0].text);
            console.log(`  Content: ${JSON.stringify(content)}`);
        } else {
            console.log('  ✗ No rules content');
            failed++;
        }

        // Test 5: Read mail://rules/0 (individual rule)
        console.log('\nTest 5: Read mail://rules/0');
        const rule0Result = await client.call('resources/read', { uri: 'mail://rules/0' });
        if (rule0Result.contents && rule0Result.contents[0]) {
            console.log('  ✓ Got rule 0 content');
            passed++;
            const content = JSON.parse(rule0Result.contents[0].text);
            console.log(`  Content: ${JSON.stringify(content)}`);
        } else {
            console.log('  ✗ No rule 0 content');
            failed++;
        }

        // Test 6: Read mail://accounts
        console.log('\nTest 6: Read mail://accounts');
        const accountsResult = await client.call('resources/read', { uri: 'mail://accounts' });
        if (accountsResult.contents && accountsResult.contents[0]) {
            console.log('  ✓ Got accounts content');
            passed++;
            const content = JSON.parse(accountsResult.contents[0].text);
            console.log(`  Content: ${JSON.stringify(content)}`);
        } else {
            console.log('  ✗ No accounts content');
            failed++;
        }

        // Test 7: Resource templates
        console.log('\nTest 7: Resource templates');
        const templatesResult = await client.call('resources/templates/list');
        if (Array.isArray(templatesResult.resourceTemplates)) {
            console.log('  ✓ Got templates array');
            passed++;
            console.log(`  Templates: ${templatesResult.resourceTemplates.length}`);
        } else {
            console.log('  ✗ No templates array');
            failed++;
        }

        // Test 8: Unknown resource returns error
        console.log('\nTest 8: Unknown resource returns error');
        try {
            await client.call('resources/read', { uri: 'mail://nonexistent' });
            console.log('  ✗ Should have thrown error');
            failed++;
        } catch (e) {
            if (e.message.includes('not found') || e.message.includes('Resource')) {
                console.log('  ✓ Got expected error');
                passed++;
            } else {
                console.log('  ✗ Unexpected error:', e.message);
                failed++;
            }
        }

        // Test 9: URI Router - test various URIs
        console.log('\nTest 9: URI parsing (via signature with name)');
        const sigResult = await client.call('resources/read', { uri: 'mail://signatures/Test' });
        if (sigResult.contents && sigResult.contents[0]) {
            const content = JSON.parse(sigResult.contents[0].text);
            if (content.name === 'Test') {
                console.log('  ✓ URI with name correctly parsed');
                passed++;
            } else {
                console.log('  ✗ Name not correctly parsed:', content);
                failed++;
            }
        } else {
            console.log('  ✗ No content returned');
            failed++;
        }

    } catch (e) {
        console.log('Fatal error:', e.message);
        failed++;
    } finally {
        client.stop();
    }

    console.log(`\n========================================`);
    console.log(`Phase 1B Results: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
