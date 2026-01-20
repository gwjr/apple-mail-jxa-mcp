// MCP Framework for JXA
// Provides JSON-RPC 2.0 over stdio with NSRunLoop-based I/O

ObjC.import('Foundation');

function createMCPServer(options) {
    const serverName = options.name || 'jxa-mcp-server';
    const serverVersion = options.version || '1.0.0';
    const protocolVersion = options.protocolVersion || '2024-11-05';
    const debug = options.debug !== false;

    const stdin = $.NSFileHandle.fileHandleWithStandardInput;
    const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
    const stderr = $.NSFileHandle.fileHandleWithStandardError;

    const tools = [];
    const toolHandlers = {};
    let resourceLister = null;
    let resourceReader = null;
    let resourceTemplates = [];

    function log(msg) {
        if (!debug) return;
        const data = $.NSString.alloc.initWithUTF8String('[' + serverName + '] ' + msg + '\n')
            .dataUsingEncoding($.NSUTF8StringEncoding);
        stderr.writeData(data);
    }

    function writeLine(obj) {
        const str = JSON.stringify(obj) + '\n';
        const data = $.NSString.alloc.initWithUTF8String(str)
            .dataUsingEncoding($.NSUTF8StringEncoding);
        stdout.writeData(data);
    }

    function sendResult(id, result) {
        writeLine({ jsonrpc: '2.0', id: id, result: result });
    }

    function sendError(id, code, message) {
        writeLine({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
    }

    function sendToolResult(id, text, isError) {
        sendResult(id, {
            content: [{ type: 'text', text: String(text) }],
            isError: isError || false
        });
    }

    function handleRequest(request) {
        const { id, method, params } = request;

        switch (method) {
            case 'initialize':
                log('Initialize from: ' + (params?.clientInfo?.name || 'unknown'));
                const capabilities = { tools: {} };
                if (resourceLister) capabilities.resources = {};
                sendResult(id, {
                    protocolVersion: protocolVersion,
                    capabilities: capabilities,
                    serverInfo: { name: serverName, version: serverVersion }
                });
                break;

            case 'notifications/initialized':
                log('Client initialized');
                break;

            case 'tools/list':
                log('Tools list (' + tools.length + ')');
                sendResult(id, { tools: tools });
                break;

            case 'tools/call':
                const toolName = params?.name;
                const args = params?.arguments || {};
                log('Call: ' + toolName);

                const handler = toolHandlers[toolName];
                if (!handler) {
                    sendError(id, -32601, 'Unknown tool: ' + toolName);
                    break;
                }

                try {
                    const result = handler(args);
                    if (result && result._error) {
                        sendToolResult(id, result._error, true);
                    } else {
                        sendToolResult(id, result ?? 'OK');
                    }
                } catch (e) {
                    sendToolResult(id, 'Error: ' + e.message, true);
                }
                break;

            case 'resources/list':
                log('Resources list');
                if (!resourceLister) {
                    sendResult(id, { resources: [] });
                } else {
                    try {
                        sendResult(id, { resources: resourceLister() });
                    } catch (e) {
                        sendError(id, -32000, 'Resource list error: ' + e.message);
                    }
                }
                break;

            case 'resources/read':
                const uri = params?.uri;
                log('Resource read: ' + uri);
                if (!resourceReader) {
                    sendError(id, -32601, 'Resources not supported');
                } else {
                    try {
                        const content = resourceReader(uri);
                        if (content === null || content === undefined) {
                            sendError(id, -32002, 'Resource not found: ' + uri);
                        } else {
                            sendResult(id, {
                                contents: [{
                                    uri: uri,
                                    mimeType: content.mimeType || 'application/json',
                                    text: typeof content.text === 'string' ? content.text : JSON.stringify(content.text, null, 2)
                                }]
                            });
                        }
                    } catch (e) {
                        sendError(id, -32000, 'Resource read error: ' + e.message);
                    }
                }
                break;

            case 'resources/templates/list':
                log('Resource templates list');
                sendResult(id, { resourceTemplates: resourceTemplates });
                break;

            default:
                if (id !== undefined && !method?.startsWith('notifications/')) {
                    sendError(id, -32601, 'Method not found: ' + method);
                }
        }
    }

    return {
        addTool: function(def) {
            const tool = {
                name: def.name,
                description: def.description || '',
                inputSchema: def.inputSchema || { type: 'object', properties: {}, required: [] }
            };
            // Add MCP tool annotations if provided
            if (def.annotations) tool.annotations = def.annotations;
            tools.push(tool);
            toolHandlers[def.name] = def.handler;
            return this;
        },

        setResources: function(lister, reader) {
            resourceLister = lister;
            resourceReader = reader;
            return this;
        },

        setResourceTemplates: function(templates) {
            resourceTemplates = templates;
            return this;
        },

        error: function(msg) { return { _error: msg }; },

        run: function() {
            log('Starting');

            let buffer = '';
            let dataAvailable = false;
            let shouldQuit = false;

            const handlerName = 'H' + Date.now();
            ObjC.registerSubclass({
                name: handlerName,
                methods: {
                    'h:': {
                        types: ['void', ['id']],
                        implementation: function() { dataAvailable = true; }
                    }
                }
            });

            const handler = $[handlerName].alloc.init;
            $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
                handler, 'h:', 'NSFileHandleDataAvailableNotification', stdin
            );

            stdin.waitForDataInBackgroundAndNotify;

            while (!shouldQuit) {
                $.NSRunLoop.currentRunLoop.runUntilDate(
                    $.NSDate.dateWithTimeIntervalSinceNow(1.0)
                );

                if (dataAvailable) {
                    dataAvailable = false;
                    const data = stdin.availableData;

                    if (data.length === 0) {
                        shouldQuit = true;
                        break;
                    }

                    buffer += $.NSString.alloc.initWithDataEncoding(
                        data, $.NSUTF8StringEncoding
                    ).js;

                    let lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            handleRequest(JSON.parse(line));
                        } catch (e) {
                            sendError(null, -32700, 'Parse error');
                        }
                    }

                    if (!shouldQuit) stdin.waitForDataInBackgroundAndNotify;
                }
            }

            $.NSNotificationCenter.defaultCenter.removeObserverNameObject(
                handler, 'NSFileHandleDataAvailableNotification', stdin
            );
            log('Done');
        }
    };
}
