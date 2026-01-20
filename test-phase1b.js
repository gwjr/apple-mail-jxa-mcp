#!/usr/bin/env node

// Phase 1B Test: Core infrastructure verification
// Tests basic MCP protocol with resource handlers

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
                if (process.env.DEBUG) process.stderr.write(data);
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
        // Check for new URI scheme
        if (resourceUris.includes('mail://inbox')) {
            console.log('  ✓ mail://inbox in list');
            passed++;
        } else {
            console.log('  ✗ mail://inbox not in list');
            failed++;
        }
        if (resourceUris.includes('mail://accounts')) {
            console.log('  ✓ mail://accounts in list');
            passed++;
        } else {
            console.log('  ✗ mail://accounts not in list');
            failed++;
        }
        console.log(`  Resources found: ${resourceUris.slice(0, 10).join(', ')}${resourceUris.length > 10 ? '...' : ''}`);

        // Test 3: Read mail://settings (app properties)
        console.log('\nTest 3: Read mail://settings');
        const settingsResult = await client.call('resources/read', { uri: 'mail://settings' });
        if (settingsResult.contents && settingsResult.contents[0]) {
            console.log('  ✓ Got contents');
            passed++;
            const content = JSON.parse(settingsResult.contents[0].text);
            console.log(`  Content keys: ${Object.keys(content).slice(0, 5).join(', ')}...`);
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
            console.log(`  Rules count: ${Array.isArray(content) ? content.length : 'N/A'}`);
        } else {
            console.log('  ✗ No rules content');
            failed++;
        }

        // Test 5: Read mail://rules[0] (individual rule)
        console.log('\nTest 5: Read mail://rules[0]');
        const rule0Result = await client.call('resources/read', { uri: 'mail://rules[0]' });
        if (rule0Result.contents && rule0Result.contents[0]) {
            console.log('  ✓ Got rule 0 content');
            passed++;
            const content = JSON.parse(rule0Result.contents[0].text);
            console.log(`  Rule name: ${content.name || 'unnamed'}`);
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
            console.log(`  Accounts count: ${Array.isArray(content) ? content.length : 'N/A'}`);
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
            if (e.message.includes('Unknown segment') || e.message.includes('not found') || e.message.includes('Resource')) {
                console.log('  ✓ Got expected error');
                passed++;
            } else {
                console.log('  ✗ Unexpected error:', e.message);
                failed++;
            }
        }

        // Test 9: Read first account by index
        console.log('\nTest 9: Read mail://accounts[0]');
        const acc0Result = await client.call('resources/read', { uri: 'mail://accounts[0]' });
        if (acc0Result.contents && acc0Result.contents[0]) {
            const content = JSON.parse(acc0Result.contents[0].text);
            if (content.name) {
                console.log(`  ✓ Got account: ${content.name}`);
                passed++;
            } else {
                console.log('  ✗ Account has no name');
                failed++;
            }
        } else {
            console.log('  ✗ No content returned');
            failed++;
        }

        // Test 10: Read inbox
        console.log('\nTest 10: Read mail://inbox');
        const inboxResult = await client.call('resources/read', { uri: 'mail://inbox' });
        if (inboxResult.contents && inboxResult.contents[0]) {
            const content = JSON.parse(inboxResult.contents[0].text);
            console.log(`  ✓ Inbox: ${content.name || 'unnamed'} (${content.unreadCount ?? '?'} unread)`);
            passed++;
        } else {
            console.log('  ✗ No inbox content');
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
