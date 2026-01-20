"use strict";
/// <reference path="jxa.d.ts" />
// ============================================================================
// MCP Server Implementation
// ============================================================================
class MCPServer {
    serverInfo;
    tools;
    stdin;
    stdout;
    stderr;
    buffer;
    shouldQuit;
    dataAvailable;
    observer;
    constructor(name, version) {
        this.serverInfo = { name, version };
        this.tools = new Map();
        this.buffer = "";
        this.shouldQuit = false;
        this.dataAvailable = false;
        // Import Foundation framework
        ObjC.import("Foundation");
        // Get standard file handles
        this.stdin = $.NSFileHandle.fileHandleWithStandardInput;
        this.stdout = $.NSFileHandle.fileHandleWithStandardOutput;
        this.stderr = $.NSFileHandle.fileHandleWithStandardError;
    }
    addTool(name, description, inputSchema, handler) {
        this.tools.set(name, {
            tool: { name, description, inputSchema },
            handler,
        });
    }
    log(message) {
        const data = $.NSString.stringWithString(message + "\n").dataUsingEncoding($.NSUTF8StringEncoding);
        this.stderr.writeData(data);
    }
    send(response) {
        const json = JSON.stringify(response) + "\n";
        const data = $.NSString.stringWithString(json).dataUsingEncoding($.NSUTF8StringEncoding);
        this.stdout.writeData(data);
    }
    handleInitialize(id, _params) {
        this.send({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: "2024-11-05",
                serverInfo: this.serverInfo,
                capabilities: {
                    tools: {},
                },
            },
        });
    }
    handleToolsList(id) {
        const tools = [];
        this.tools.forEach(({ tool }) => tools.push(tool));
        this.send({
            jsonrpc: "2.0",
            id,
            result: { tools },
        });
    }
    handleToolsCall(id, params) {
        const name = params.name;
        const args = params.arguments ?? {};
        const entry = this.tools.get(name);
        if (!entry) {
            this.send({
                jsonrpc: "2.0",
                id,
                error: {
                    code: -32602,
                    message: `Unknown tool: ${name}`,
                },
            });
            return;
        }
        try {
            const result = entry.handler(args);
            this.send({
                jsonrpc: "2.0",
                id,
                result,
            });
        }
        catch (e) {
            const error = e;
            this.send({
                jsonrpc: "2.0",
                id,
                result: {
                    content: [{ type: "text", text: `Error: ${error.message}` }],
                    isError: true,
                },
            });
        }
    }
    handleRequest(request) {
        switch (request.method) {
            case "initialize":
                this.handleInitialize(request.id, request.params ?? {});
                break;
            case "initialized":
                // Notification, no response needed
                break;
            case "tools/list":
                this.handleToolsList(request.id);
                break;
            case "tools/call":
                this.handleToolsCall(request.id, request.params ?? {});
                break;
            default:
                if (request.id !== undefined) {
                    this.send({
                        jsonrpc: "2.0",
                        id: request.id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${request.method}`,
                        },
                    });
                }
        }
    }
    processBuffer() {
        // Split on newlines
        const lines = this.buffer.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const request = JSON.parse(trimmed);
                this.handleRequest(request);
            }
            catch (e) {
                const error = e;
                this.log(`Parse error: ${error.message}`);
            }
        }
    }
    run() {
        this.log(`${this.serverInfo.name} v${this.serverInfo.version} starting...`);
        // Register Objective-C subclass for notification handling
        // Use unique name to avoid conflicts if run multiple times
        const observerClassName = `StdinObserver_${Date.now()}`;
        ObjC.registerSubclass({
            name: observerClassName,
            methods: {
                "handleData:": {
                    types: ["void", ["id"]],
                    implementation: (_notification) => {
                        this.dataAvailable = true;
                    },
                },
            },
        });
        // Access the registered class via the $ bridge
        this.observer = $[observerClassName].alloc.init;
        // Register for stdin data notifications
        // Note: selector is just a string matching the method name
        $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(this.observer, "handleData:", "NSFileHandleDataAvailableNotification", this.stdin);
        // Start listening (this is a property getter in JXA, not a method call)
        void this.stdin.waitForDataInBackgroundAndNotify;
        // Main run loop
        while (!this.shouldQuit) {
            // Wait for events (1 second timeout)
            $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1.0));
            // Check for available data
            if (this.dataAvailable) {
                this.dataAvailable = false;
                const data = this.stdin.availableData;
                if (data.length === 0) {
                    // EOF - stdin closed
                    this.shouldQuit = true;
                    break;
                }
                const nsString = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
                if (nsString) {
                    this.buffer += ObjC.unwrap(nsString);
                    this.processBuffer();
                }
                // Re-register for next notification
                void this.stdin.waitForDataInBackgroundAndNotify;
            }
        }
        // Cleanup
        $.NSNotificationCenter.defaultCenter.removeObserver(this.observer);
        this.log("Server shutting down");
    }
}
/// <reference path="jxa.d.ts" />
/// <reference path="mcp-server.ts" />
// ============================================================================
// Hello World MCP Server
// ============================================================================
const server = new MCPServer("hello-world-jxa", "1.0.0");
// Simple hello tool
server.addTool("hello", "Says hello to someone", {
    type: "object",
    properties: {
        name: {
            type: "string",
            description: "The name to greet",
        },
    },
    required: ["name"],
}, (args) => {
    const name = args.name;
    return {
        content: [
            {
                type: "text",
                text: `Hello, ${name}! Greetings from JXA via TypeScript.`,
            },
        ],
    };
});
// Tool that demonstrates JXA capabilities
server.addTool("system_info", "Gets basic system information using JXA", {
    type: "object",
    properties: {},
}, () => {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const hostname = app.doShellScript("hostname");
    const user = app.doShellScript("whoami");
    const date = app.doShellScript("date");
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    hostname,
                    user,
                    date,
                    runtime: "JXA (JavaScript for Automation)",
                    transpiled_from: "TypeScript",
                }, null, 2),
            },
        ],
    };
});
// Tool that uses modern ES features to prove they work
server.addTool("es_features_demo", "Demonstrates modern ES features running in JXA", {
    type: "object",
    properties: {
        input: {
            type: "string",
            description: "Input string to process",
        },
    },
}, (args) => {
    const input = args.input ?? "default";
    // Nullish coalescing (using args to avoid "always nullish" warning)
    const maybeNull = args.nothing;
    const value = maybeNull ?? "fallback";
    // Optional chaining
    const nested = { a: { b: { c: 42 } } };
    const deep = nested?.a?.b?.c;
    // Array methods from ES2023
    const arr = [3, 1, 4, 1, 5, 9, 2, 6];
    const sorted = arr.toSorted();
    const reversed = arr.toReversed();
    const last = arr.findLast((x) => x < 5);
    // Object spread
    const merged = { ...{ a: 1 }, ...{ b: 2 } };
    // Template literals
    const message = `Input was: "${input}"`;
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    message,
                    nullish_coalescing: value,
                    optional_chaining: deep,
                    toSorted: sorted,
                    toReversed: reversed,
                    findLast: last,
                    spread: merged,
                }, null, 2),
            },
        ],
    };
});
// Start the server
server.run();
