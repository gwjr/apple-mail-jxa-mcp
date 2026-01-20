"use strict";
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
// ============================================================================
// URI Router for mail:// scheme
// Parses URIs into discriminated union types for exhaustive handling
// ============================================================================
// Encode/decode URI components safely
function encodeURISegment(segment) {
    return encodeURIComponent(segment);
}
function decodeURISegment(segment) {
    return decodeURIComponent(segment);
}
// ============================================================================
// URI Parser
// ============================================================================
function parseMailURI(uri) {
    // Must start with mail://
    if (!uri.startsWith('mail://')) {
        return { type: 'unknown', uri };
    }
    const withoutScheme = uri.slice(7); // Remove "mail://"
    // Separate path and query string
    const [pathPart, queryPart] = withoutScheme.split('?');
    const segments = pathPart.split('/').filter(s => s.length > 0);
    // Parse query parameters
    const query = {};
    if (queryPart) {
        for (const pair of queryPart.split('&')) {
            const [key, value] = pair.split('=');
            if (key) {
                query[decodeURIComponent(key)] = decodeURIComponent(value || '');
            }
        }
    }
    // Empty path: mail://
    if (segments.length === 0) {
        return { type: 'unknown', uri };
    }
    // Top-level resources
    const first = segments[0];
    // mail://properties
    if (first === 'properties' && segments.length === 1) {
        return { type: 'properties', uri };
    }
    // mail://rules or mail://rules/{index}
    if (first === 'rules') {
        if (segments.length === 1) {
            return { type: 'rules', uri };
        }
        if (segments.length === 2) {
            const index = parseInt(segments[1], 10);
            if (!isNaN(index) && index >= 0) {
                return { type: 'rules', uri, index };
            }
        }
        return { type: 'unknown', uri };
    }
    // mail://signatures or mail://signatures/{name}
    if (first === 'signatures') {
        if (segments.length === 1) {
            return { type: 'signatures', uri };
        }
        if (segments.length === 2) {
            return { type: 'signatures', uri, name: decodeURISegment(segments[1]) };
        }
        return { type: 'unknown', uri };
    }
    // mail://accounts...
    if (first === 'accounts') {
        // mail://accounts
        if (segments.length === 1) {
            return { type: 'accounts', uri };
        }
        const accountName = decodeURISegment(segments[1]);
        // mail://accounts/{account}
        if (segments.length === 2) {
            return { type: 'account', uri, account: accountName };
        }
        // Parse the rest: alternating /mailboxes/{name} and terminal /messages
        return parseMailboxPath(uri, accountName, segments.slice(2), query);
    }
    return { type: 'unknown', uri };
}
// Parse mailbox path: /mailboxes/{name}/mailboxes/{name}/.../messages/{id}/attachments
function parseMailboxPath(uri, account, segments, query) {
    const path = [];
    let i = 0;
    while (i < segments.length) {
        const segment = segments[i];
        if (segment === 'mailboxes') {
            // Check if this is terminal (list child mailboxes)
            if (i + 1 >= segments.length) {
                // mail://accounts/{a}/mailboxes (no path yet) - list top-level mailboxes
                if (path.length === 0) {
                    return { type: 'account-mailboxes', uri, account };
                }
                // mail://accounts/{a}/mailboxes/{m}/mailboxes - list child mailboxes
                return { type: 'mailbox-mailboxes', uri, account, path };
            }
            // /mailboxes/{name} - add to path
            i++;
            path.push(decodeURISegment(segments[i]));
            i++;
            continue;
        }
        if (segment === 'messages') {
            // Must have at least one mailbox in path
            if (path.length === 0) {
                return { type: 'unknown', uri };
            }
            // mail://accounts/{a}/mailboxes/{m}/messages - list messages
            if (i + 1 >= segments.length) {
                const messageQuery = {
                    limit: parseInt(query['limit'], 10) || 20,
                    offset: parseInt(query['offset'], 10) || 0,
                    unread: query['unread'] === 'true' ? true : undefined
                };
                return {
                    type: 'mailbox-messages',
                    uri,
                    account,
                    path,
                    query: messageQuery
                };
            }
            // mail://accounts/{a}/mailboxes/{m}/messages/{id}
            const messageId = parseInt(segments[i + 1], 10);
            if (isNaN(messageId)) {
                return { type: 'unknown', uri };
            }
            // mail://accounts/{a}/mailboxes/{m}/messages/{id}/attachments
            if (i + 2 < segments.length && segments[i + 2] === 'attachments') {
                return {
                    type: 'message-attachments',
                    uri,
                    account,
                    path,
                    id: messageId
                };
            }
            // Just the message
            if (i + 2 >= segments.length) {
                return {
                    type: 'message',
                    uri,
                    account,
                    path,
                    id: messageId
                };
            }
            return { type: 'unknown', uri };
        }
        // Unknown segment
        return { type: 'unknown', uri };
    }
    // Ended with a mailbox path but no terminal segment
    if (path.length > 0) {
        return { type: 'mailbox', uri, account, path };
    }
    return { type: 'unknown', uri };
}
// ============================================================================
// URI Builders
// ============================================================================
const URIBuilder = {
    properties() {
        return 'mail://properties';
    },
    rules(index) {
        if (index !== undefined) {
            return `mail://rules/${index}`;
        }
        return 'mail://rules';
    },
    signatures(name) {
        if (name !== undefined) {
            return `mail://signatures/${encodeURISegment(name)}`;
        }
        return 'mail://signatures';
    },
    accounts() {
        return 'mail://accounts';
    },
    account(name) {
        return `mail://accounts/${encodeURISegment(name)}`;
    },
    accountMailboxes(account) {
        return `mail://accounts/${encodeURISegment(account)}/mailboxes`;
    },
    mailbox(account, path) {
        const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
        return `mail://accounts/${encodeURISegment(account)}/${pathStr}`;
    },
    mailboxMailboxes(account, path) {
        const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
        return `mail://accounts/${encodeURISegment(account)}/${pathStr}/mailboxes`;
    },
    mailboxMessages(account, path, query) {
        const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
        let uri = `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages`;
        const params = [];
        if (query?.limit !== undefined)
            params.push(`limit=${query.limit}`);
        if (query?.offset !== undefined)
            params.push(`offset=${query.offset}`);
        if (query?.unread !== undefined)
            params.push(`unread=${query.unread}`);
        if (params.length > 0) {
            uri += '?' + params.join('&');
        }
        return uri;
    },
    message(account, path, id) {
        const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
        return `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages/${id}`;
    },
    messageAttachments(account, path, id) {
        const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
        return `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages/${id}/attachments`;
    },
    // Build Apple's message:// URL from RFC 2822 Message-ID
    messageURL(messageId) {
        // Encode special characters for URL
        const encoded = messageId
            .replace(/%/g, '%25')
            .replace(/ /g, '%20')
            .replace(/#/g, '%23');
        return `message://<${encoded}>`;
    }
};
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="uri-router.ts" />
// ============================================================================
// MCP Server Implementation with Resources Support
// JSON-RPC 2.0 over stdio with NSRunLoop-based I/O
// ============================================================================
// Standard JSON-RPC error codes
const JsonRpcErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    RESOURCE_NOT_FOUND: -32002,
    SERVER_ERROR: -32000
};
class MCPServer {
    serverInfo;
    tools;
    resourceLister;
    resourceReader;
    resourceTemplates;
    stdin;
    stdout;
    stderr;
    buffer;
    shouldQuit;
    dataAvailable;
    observer;
    debug;
    constructor(name, version, debug = true) {
        this.serverInfo = { name, version };
        this.tools = new Map();
        this.resourceLister = null;
        this.resourceReader = null;
        this.resourceTemplates = [];
        this.buffer = "";
        this.shouldQuit = false;
        this.dataAvailable = false;
        this.debug = debug;
        // Import Foundation framework
        ObjC.import("Foundation");
        // Get standard file handles
        this.stdin = $.NSFileHandle.fileHandleWithStandardInput;
        this.stdout = $.NSFileHandle.fileHandleWithStandardOutput;
        this.stderr = $.NSFileHandle.fileHandleWithStandardError;
    }
    // ============================================================================
    // Tool Registration
    // ============================================================================
    addTool(definition) {
        const tool = {
            name: definition.name,
            description: definition.description,
            inputSchema: definition.inputSchema ?? { type: "object", properties: {}, required: [] }
        };
        if (definition.annotations) {
            tool.annotations = definition.annotations;
        }
        this.tools.set(definition.name, { tool, handler: definition.handler });
        return this;
    }
    // ============================================================================
    // Resource Registration
    // ============================================================================
    setResources(lister, reader) {
        this.resourceLister = lister;
        this.resourceReader = reader;
        return this;
    }
    setResourceTemplates(templates) {
        this.resourceTemplates = templates;
        return this;
    }
    // ============================================================================
    // I/O Helpers
    // ============================================================================
    log(message) {
        if (!this.debug)
            return;
        const fullMessage = `[${this.serverInfo.name}] ${message}\n`;
        const data = $.NSString.alloc.initWithUTF8String(fullMessage)
            .dataUsingEncoding($.NSUTF8StringEncoding);
        this.stderr.writeData(data);
    }
    send(response) {
        const json = JSON.stringify(response) + "\n";
        const data = $.NSString.alloc.initWithUTF8String(json)
            .dataUsingEncoding($.NSUTF8StringEncoding);
        this.stdout.writeData(data);
    }
    sendResult(id, result) {
        this.send({ jsonrpc: "2.0", id, result });
    }
    sendError(id, code, message) {
        this.send({ jsonrpc: "2.0", id, error: { code, message } });
    }
    sendToolResult(id, text, isError = false) {
        this.sendResult(id, {
            content: [{ type: "text", text: String(text) }],
            isError
        });
    }
    // ============================================================================
    // Request Handlers
    // ============================================================================
    handleInitialize(id, params) {
        const clientName = params.clientInfo?.name ?? 'unknown';
        this.log(`Initialize from: ${clientName}`);
        const capabilities = {};
        if (this.tools.size > 0) {
            capabilities.tools = {};
        }
        if (this.resourceLister) {
            capabilities.resources = {};
        }
        this.sendResult(id, {
            protocolVersion: "2024-11-05",
            serverInfo: this.serverInfo,
            capabilities
        });
    }
    handleToolsList(id) {
        const tools = [];
        this.tools.forEach(({ tool }) => tools.push(tool));
        this.log(`Tools list (${tools.length})`);
        this.sendResult(id, { tools });
    }
    handleToolsCall(id, params) {
        const name = params.name;
        const args = params.arguments ?? {};
        this.log(`Call: ${name}`);
        const entry = this.tools.get(name);
        if (!entry) {
            this.sendError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
            return;
        }
        try {
            const result = entry.handler(args);
            this.sendResult(id, result);
        }
        catch (e) {
            const error = e;
            this.sendToolResult(id, `Error: ${error.message}`, true);
        }
    }
    handleResourcesList(id) {
        this.log("Resources list");
        if (!this.resourceLister) {
            this.sendResult(id, { resources: [] });
            return;
        }
        try {
            const resources = this.resourceLister();
            this.sendResult(id, { resources });
        }
        catch (e) {
            const error = e;
            this.sendError(id, JsonRpcErrorCodes.SERVER_ERROR, `Resource list error: ${error.message}`);
        }
    }
    handleResourcesRead(id, params) {
        const uri = params.uri;
        this.log(`Resource read: ${uri}`);
        if (!this.resourceReader) {
            this.sendError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, "Resources not supported");
            return;
        }
        try {
            this.log(`[DBG] calling resourceReader...`);
            const content = this.resourceReader(uri);
            this.log(`[DBG] resourceReader returned`);
            if (content === null || content === undefined) {
                this.sendError(id, JsonRpcErrorCodes.RESOURCE_NOT_FOUND, `Resource not found: ${uri}`);
                return;
            }
            this.log(`[DBG] stringifying content...`);
            const textContent = typeof content.text === 'string'
                ? content.text
                : JSON.stringify(content.text, null, 2);
            this.log(`[DBG] stringified, length: ${textContent.length}`);
            this.log(`[DBG] building result...`);
            const result = {
                contents: [{
                        uri,
                        mimeType: content.mimeType || 'application/json',
                        text: textContent
                    }]
            };
            this.log(`[DBG] calling sendResult...`);
            this.sendResult(id, result);
            this.log(`[DBG] sendResult done`);
        }
        catch (e) {
            const error = e;
            this.sendError(id, JsonRpcErrorCodes.SERVER_ERROR, `Resource read error: ${error.message}`);
        }
    }
    handleResourceTemplatesList(id) {
        this.log("Resource templates list");
        this.sendResult(id, { resourceTemplates: this.resourceTemplates });
    }
    // ============================================================================
    // Request Dispatch
    // ============================================================================
    handleRequest(request) {
        switch (request.method) {
            case "initialize":
                this.handleInitialize(request.id, request.params ?? {});
                break;
            case "initialized":
            case "notifications/initialized":
                this.log("Client initialized");
                break;
            case "tools/list":
                this.handleToolsList(request.id);
                break;
            case "tools/call":
                this.handleToolsCall(request.id, request.params ?? {});
                break;
            case "resources/list":
                this.handleResourcesList(request.id);
                break;
            case "resources/read":
                this.handleResourcesRead(request.id, request.params ?? {});
                break;
            case "resources/templates/list":
                this.handleResourceTemplatesList(request.id);
                break;
            default:
                // Only send error for requests (with id), not notifications
                if (request.id !== undefined && !request.method?.startsWith('notifications/')) {
                    this.sendError(request.id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
                }
        }
    }
    // ============================================================================
    // Buffer Processing
    // ============================================================================
    processBuffer() {
        const lines = this.buffer.split("\n");
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
                this.sendError(null, JsonRpcErrorCodes.PARSE_ERROR, "Parse error");
            }
        }
    }
    // ============================================================================
    // Main Run Loop
    // ============================================================================
    run() {
        this.log(`${this.serverInfo.name} v${this.serverInfo.version} starting...`);
        // Register Objective-C subclass for notification handling
        const observerClassName = `StdinObserver_${Date.now()}`;
        ObjC.registerSubclass({
            name: observerClassName,
            methods: {
                "handleData:": {
                    types: ["void", ["id"]],
                    implementation: (_notification) => {
                        this.dataAvailable = true;
                    }
                }
            }
        });
        // Access the registered class via the $ bridge
        this.observer = $[observerClassName].alloc.init;
        // Register for stdin data notifications
        $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(this.observer, "handleData:", "NSFileHandleDataAvailableNotification", this.stdin);
        // Start listening
        void this.stdin.waitForDataInBackgroundAndNotify;
        // Main run loop
        while (!this.shouldQuit) {
            $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1.0));
            if (this.dataAvailable) {
                this.dataAvailable = false;
                const data = this.stdin.availableData;
                if (data.length === 0) {
                    this.shouldQuit = true;
                    break;
                }
                const nsString = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
                if (nsString) {
                    this.buffer += nsString.js;
                    this.processBuffer();
                }
                void this.stdin.waitForDataInBackgroundAndNotify;
            }
        }
        // Cleanup
        $.NSNotificationCenter.defaultCenter.removeObserverNameObject(this.observer, "NSFileHandleDataAvailableNotification", this.stdin);
        this.log("Server shutting down");
    }
}
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
// ============================================================================
// Declarative JXA Schema Framework
// ============================================================================
// ============================================================================
// Helpers
// ============================================================================
function str(val) {
    return val == null ? '' : '' + val;
}
function tryResolve(fn, context) {
    try {
        return { ok: true, value: fn() };
    }
    catch (e) {
        return { ok: false, error: `${context}: ${e}` };
    }
}
// Registry of root specifier factories by scheme
const schemeRoots = {};
function registerScheme(scheme, root) {
    schemeRoots[scheme] = root;
}
const navigationHooks = [];
function registerNavigationHook(hook) {
    navigationHooks.push(hook);
}
const completionHooks = [];
function registerCompletionHook(hook) {
    completionHooks.push(hook);
}
// Guard against recursive completion calls during error handling
let _inErrorSuggestion = false;
// Helper to format completion suggestions for error messages
function suggestCompletions(partial, max = 5) {
    if (_inErrorSuggestion)
        return '';
    _inErrorSuggestion = true;
    try {
        const completions = getCompletions(partial);
        if (completions.length === 0)
            return '';
        const suggestions = completions.slice(0, max).map(c => c.label || c.value);
        return ` Did you mean: ${suggestions.join(', ')}?`;
    }
    finally {
        _inErrorSuggestion = false;
    }
}
// Deserialize a URI into a specifier
function specifierFromURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        const suggestions = suggestCompletions(uri);
        return { ok: false, error: `Invalid URI (no scheme): ${uri}.${suggestions}` };
    }
    const scheme = uri.slice(0, schemeEnd);
    let rest = uri.slice(schemeEnd + 3);
    // Separate query string
    let query;
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        query = rest.slice(queryIdx + 1);
        rest = rest.slice(0, queryIdx);
    }
    const rootFactory = schemeRoots[scheme];
    if (!rootFactory) {
        const knownSchemes = Object.keys(schemeRoots);
        const suggestion = knownSchemes.length > 0 ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
        return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
    }
    let current = rootFactory();
    let resolved = `${scheme}://`;
    for (const segment of rest.split('/').filter(s => s)) {
        const indexMatch = segment.match(/^(.+?)\[(\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        try {
            // Property access or element access?
            if (current[name] !== undefined) {
                current = current[name];
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else if (current.byName) {
                current = current.byName(decodeURIComponent(name));
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else if (current.byId) {
                current = current.byId(decodeURIComponent(name));
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
            }
            else {
                // Try navigation hooks for special paths
                const nextUri = resolved + (resolved.endsWith('://') ? '' : '/') + name;
                let hooked = undefined;
                for (const hook of navigationHooks) {
                    hooked = hook(current, name, nextUri);
                    if (hooked !== undefined)
                        break;
                }
                if (hooked !== undefined) {
                    current = hooked;
                    resolved = nextUri;
                }
                else {
                    const partial = resolved + (resolved.endsWith('://') ? '' : '/') + name;
                    const suggestions = suggestCompletions(partial);
                    return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${suggestions}` };
                }
            }
            // Apply index if present
            if (index !== undefined) {
                if (!current.byIndex) {
                    return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
                }
                current = current.byIndex(index);
                resolved += `[${index}]`;
            }
        }
        catch (e) {
            const suggestions = suggestCompletions(resolved);
            return { ok: false, error: `Failed at '${segment}': ${e}.${suggestions}` };
        }
    }
    // Apply whose filter, sort, pagination, and expand if present
    if (query) {
        try {
            const { filter, sort, pagination, expand } = parseQuery(query);
            if (Object.keys(filter).length > 0 && current.whose) {
                current = current.whose(filter);
            }
            if (sort && current.sortBy) {
                current = current.sortBy(sort);
            }
            if (pagination && current.paginate) {
                current = current.paginate(pagination);
            }
            if (expand && expand.length > 0 && current.expand) {
                current = current.expand(expand);
            }
            resolved += '?' + query;
        }
        catch (e) {
            return { ok: false, error: `Failed to apply query: ${e} (resolved: ${resolved})` };
        }
    }
    return { ok: true, value: current };
}
// ============================================================================
// Helper Functions for Schema Definition
// ============================================================================
function accessor(jxaName) {
    return {
        _accessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function lazyAccessor(jxaName) {
    return {
        _lazyAccessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function collection(jxaName, elementBase, addressing) {
    return {
        _collection: true,
        _elementBase: elementBase,
        _jxaName: jxaName,
        _addressing: addressing
    };
}
function computed(compute) {
    return {
        _computed: true,
        _type: undefined,
        _compute: compute
    };
}
// ============================================================================
// Runtime Implementation Factory
// ============================================================================
function createDerived(schema, typeName) {
    class DerivedClass {
        _jxa;
        _uri;
        constructor(_jxa, _uri) {
            this._jxa = _jxa;
            this._uri = _uri;
            this._initializeProperties();
        }
        static fromJXA(_jxa, _uri) {
            return new DerivedClass(_jxa, _uri);
        }
        _initializeProperties() {
            for (const [key, descriptor] of Object.entries(schema)) {
                if (this._isAccessor(descriptor)) {
                    this._defineAccessorProperty(key, descriptor);
                }
                else if (this._isLazyAccessor(descriptor)) {
                    this._defineLazyAccessorProperty(key, descriptor);
                }
                else if (this._isCollection(descriptor)) {
                    this._defineCollectionProperty(key, descriptor);
                }
                else if (this._isComputed(descriptor)) {
                    this._defineComputedProperty(key, descriptor);
                }
            }
        }
        _isAccessor(desc) {
            return desc && desc._accessor === true;
        }
        _isLazyAccessor(desc) {
            return desc && desc._lazyAccessor === true;
        }
        _isCollection(desc) {
            return desc && desc._collection === true;
        }
        _isComputed(desc) {
            return desc && desc._computed === true;
        }
        _defineAccessorProperty(key, descriptor) {
            Object.defineProperty(this, key, {
                get() {
                    const value = this._jxa[descriptor._jxaName]();
                    return this._convertValue(value);
                },
                enumerable: true
            });
        }
        _defineLazyAccessorProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    const uri = self._uri
                        ? `${self._uri}/${key}`
                        : `${typeName.toLowerCase()}://.../${key}`;
                    return scalarSpecifier(uri, () => {
                        const value = self._jxa[descriptor._jxaName]();
                        return self._convertValue(value);
                    });
                },
                enumerable: true
            });
        }
        _defineCollectionProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    const jxaCollection = self._jxa[descriptor._jxaName];
                    const base = self._uri || `${typeName.toLowerCase()}://`;
                    const uri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
                    return createCollectionSpecifier(uri, jxaCollection, descriptor._elementBase, descriptor._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
        _defineComputedProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    return descriptor._compute(self._jxa);
                },
                enumerable: true
            });
        }
        _convertValue(value) {
            if (value == null)
                return '';
            if (Array.isArray(value))
                return value.map(v => this._convertValue(v));
            return value;
        }
    }
    return DerivedClass;
}
// ============================================================================
// Specifier Factories
// ============================================================================
// Helper for scalar specifiers
function scalarSpecifier(uri, getValue) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(getValue, uri);
        },
        fix() {
            return { ok: true, value: spec }; // Scalars can't be improved
        }
    };
    return spec;
}
// Element specifier factory
function createElementSpecifier(uri, jxa, schema, typeName, addressing) {
    const ElementClass = createDerived(schema, typeName);
    // Extract base URI (collection path without element reference)
    // e.g., "mail://accounts[0]/mailboxes" from "mail://accounts[0]/mailboxes[72]"
    const baseUriMatch = uri.match(/^(.+?)(?:\/[^\/\[]+|\[\d+\])$/);
    const baseUri = baseUriMatch ? baseUriMatch[1] : uri;
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => ElementClass.fromJXA(jxa, uri), uri);
        },
        // Returns a new specifier with the most stable URI form, respecting addressing order
        fix() {
            return tryResolve(() => {
                // First, fix parent path if it has indexed segments
                let fixedBase = baseUri;
                if (baseUri.includes('[')) {
                    const parentSpec = specifierFromURI(baseUri);
                    if (parentSpec.ok) {
                        const fixedParent = parentSpec.value.fix();
                        if (fixedParent.ok) {
                            fixedBase = fixedParent.value.uri;
                        }
                    }
                }
                if (!addressing || addressing.length === 0) {
                    // Can't improve current element, but parent may have been fixed
                    if (fixedBase !== baseUri) {
                        const currentSegment = uri.slice(baseUri.length);
                        return createElementSpecifier(fixedBase + currentSegment, jxa, schema, typeName, addressing);
                    }
                    return spec;
                }
                // Try addressing modes in stability order (id > name), skipping unavailable modes
                let fixedUri;
                const stabilityOrder = ['id', 'name'];
                for (const mode of stabilityOrder) {
                    if (fixedUri !== undefined)
                        break;
                    if (!addressing.includes(mode))
                        continue;
                    if (mode === 'id') {
                        try {
                            const id = jxa.id();
                            if (id != null && id !== '') {
                                fixedUri = `${fixedBase}/${encodeURIComponent(String(id))}`;
                            }
                        }
                        catch { /* ignore */ }
                    }
                    else if (mode === 'name') {
                        try {
                            const name = jxa.name();
                            if (name != null && name !== '') {
                                fixedUri = `${fixedBase}/${encodeURIComponent(String(name))}`;
                            }
                        }
                        catch { /* ignore */ }
                    }
                    // 'index' doesn't provide improvement
                }
                if (fixedUri === undefined) {
                    // Can't improve current element, but parent may have been fixed
                    if (fixedBase !== baseUri) {
                        const currentSegment = uri.slice(baseUri.length);
                        return createElementSpecifier(fixedBase + currentSegment, jxa, schema, typeName, addressing);
                    }
                    return spec;
                }
                // Return new specifier with fixed URI
                return createElementSpecifier(fixedUri, jxa, schema, typeName, addressing);
            }, uri);
        }
    };
    // Add lifted property specifiers
    for (const [key, descriptor] of Object.entries(schema)) {
        if ('_accessor' in descriptor || '_lazyAccessor' in descriptor) {
            // Both accessor and lazyAccessor lift to Specifier<T> on a Specifier
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxa[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxa[desc._jxaName], desc._elementBase, desc._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Collection specifier factory
function createCollectionSpecifier(uri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, pagination, expand) {
    const ElementClass = createDerived(elementBase, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        // Returns base collection specifier (strips query params, fixes parent paths)
        fix() {
            let fixedUri = uri.split('?')[0];
            // Fix parent path if it has indexed segments
            if (fixedUri.includes('[')) {
                // Extract parent element path (everything before the last /collection)
                const lastSlash = fixedUri.lastIndexOf('/');
                const schemeEnd = fixedUri.indexOf('://') + 3;
                if (lastSlash > schemeEnd) {
                    const parentPath = fixedUri.slice(0, lastSlash);
                    const collectionName = fixedUri.slice(lastSlash + 1);
                    const parentSpec = specifierFromURI(parentPath);
                    if (parentSpec.ok) {
                        const fixedParent = parentSpec.value.fix();
                        if (fixedParent.ok) {
                            fixedUri = fixedParent.value.uri + '/' + collectionName;
                        }
                    }
                }
            }
            if (fixedUri === uri) {
                return { ok: true, value: spec }; // Already at base form
            }
            return { ok: true, value: createCollectionSpecifier(fixedUri, jxaCollection, elementBase, addressing, typeName) };
        },
        resolve() {
            return tryResolve(() => {
                const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
                const collectionBaseUri = uri.split('?')[0]; // Strip query params for element URIs
                let results = jxaArray.map((jxa, i) => {
                    // Create element specifier with index-based URI
                    const indexUri = `${collectionBaseUri}[${i}]`;
                    const elementSpec = createElementSpecifier(indexUri, jxa, elementBase, typeName, addressing);
                    // Resolve to get data with _uri = index URI
                    const resolved = elementSpec.resolve();
                    if (!resolved.ok) {
                        return ElementClass.fromJXA(jxa, indexUri); // Fallback
                    }
                    // Get stable reference via fix()
                    const fixed = elementSpec.fix();
                    if (fixed.ok && fixed.value.uri !== indexUri) {
                        resolved.value._ref = fixed.value.uri;
                    }
                    return resolved.value;
                });
                // Apply JS filter if specified
                if (jsFilter && Object.keys(jsFilter).length > 0) {
                    results = results.filter((item) => {
                        for (const [key, predicate] of Object.entries(jsFilter)) {
                            const val = item[key];
                            const pred = predicate;
                            if ('contains' in pred && typeof val === 'string' && !val.includes(pred.contains))
                                return false;
                            if ('startsWith' in pred && typeof val === 'string' && !val.startsWith(pred.startsWith))
                                return false;
                            if ('greaterThan' in pred && !(val > pred.greaterThan))
                                return false;
                            if ('lessThan' in pred && !(val < pred.lessThan))
                                return false;
                            if ('equals' in pred && val !== pred.equals)
                                return false;
                        }
                        return true;
                    });
                }
                // Apply sort if specified
                if (sortSpec) {
                    results.sort((a, b) => {
                        const aVal = a[sortSpec.by];
                        const bVal = b[sortSpec.by];
                        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                        return sortSpec.direction === 'desc' ? -cmp : cmp;
                    });
                }
                // Apply pagination if specified
                if (pagination) {
                    const start = pagination.offset || 0;
                    const end = pagination.limit !== undefined ? start + pagination.limit : undefined;
                    results = results.slice(start, end);
                }
                // Apply expand if specified - resolve lazy specifiers
                if (expand && expand.length > 0) {
                    results = results.map((item) => {
                        // Create a shallow copy with all values resolved
                        const expanded = {};
                        for (const key of Object.keys(item)) {
                            const val = item[key];
                            if (expand.includes(key) && val && val._isSpecifier && typeof val.resolve === 'function') {
                                const resolved = val.resolve();
                                expanded[key] = resolved.ok ? resolved.value : val;
                            }
                            else {
                                expanded[key] = val;
                            }
                        }
                        return expanded;
                    });
                }
                return results;
            }, uri);
        }
    };
    // Get base URI without query string for element URIs
    const baseUri = uri.split('?')[0];
    // Add addressing methods
    if (addressing.includes('index')) {
        spec.byIndex = function (i) {
            return createElementSpecifier(`${baseUri}[${i}]`, jxaCollection.at(i), elementBase, typeName, addressing);
        };
    }
    if (addressing.includes('name')) {
        spec.byName = function (name) {
            return createElementSpecifier(`${baseUri}/${encodeURIComponent(name)}`, jxaCollection.byName(name), elementBase, typeName, addressing);
        };
    }
    if (addressing.includes('id')) {
        spec.byId = function (id) {
            return createElementSpecifier(`${baseUri}/${id}`, jxaCollection.byId(id), elementBase, typeName, addressing);
        };
    }
    // Add whose filtering
    spec.whose = function (filter) {
        const filteredUri = `${uri}?${encodeFilter(filter)}`;
        // Build JXA whose clause
        const jxaFilter = {};
        for (const [key, predicate] of Object.entries(filter)) {
            const descriptor = elementBase[key];
            if (!descriptor || !('_jxaName' in descriptor)) {
                throw new Error(`Unknown property: ${key}`);
            }
            const jxaName = descriptor._jxaName;
            const pred = predicate;
            if ('equals' in pred) {
                jxaFilter[jxaName] = pred.equals;
            }
            else if ('contains' in pred) {
                jxaFilter[jxaName] = { _contains: pred.contains };
            }
            else if ('startsWith' in pred) {
                jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
            }
            else if ('greaterThan' in pred) {
                jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
            }
            else if ('lessThan' in pred) {
                jxaFilter[jxaName] = { _lessThan: pred.lessThan };
            }
        }
        // Try JXA whose first, fall back to JS filter
        try {
            const filteredJXA = jxaCollection.whose(jxaFilter);
            // Test if it works by accessing length (triggers evaluation)
            void filteredJXA.length;
            return createCollectionSpecifier(filteredUri, filteredJXA, elementBase, addressing, typeName, sortSpec, undefined, pagination, expand);
        }
        catch {
            // JXA filter failed, use JS post-filter
            return createCollectionSpecifier(filteredUri, jxaCollection, elementBase, addressing, typeName, sortSpec, filter, pagination, expand);
        }
    };
    // Add sortBy
    spec.sortBy = function (newSortSpec) {
        const sep = uri.includes('?') ? '&' : '?';
        const sortedUri = `${uri}${sep}sort=${String(newSortSpec.by)}.${newSortSpec.direction || 'asc'}`;
        return createCollectionSpecifier(sortedUri, jxaCollection, elementBase, addressing, typeName, newSortSpec, jsFilter, pagination, expand);
    };
    // Add paginate
    spec.paginate = function (newPagination) {
        const parts = [];
        if (newPagination.limit !== undefined)
            parts.push(`limit=${newPagination.limit}`);
        if (newPagination.offset !== undefined)
            parts.push(`offset=${newPagination.offset}`);
        const sep = uri.includes('?') ? '&' : '?';
        const paginatedUri = parts.length > 0 ? `${uri}${sep}${parts.join('&')}` : uri;
        return createCollectionSpecifier(paginatedUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, newPagination, expand);
    };
    // Add expand
    spec.expand = function (newExpand) {
        const sep = uri.includes('?') ? '&' : '?';
        const expandUri = `${uri}${sep}expand=${newExpand.join(',')}`;
        return createCollectionSpecifier(expandUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, pagination, newExpand);
    };
    return spec;
}
// ============================================================================
// Filter Encoding/Decoding
// ============================================================================
function encodeFilter(filter) {
    const parts = [];
    for (const [key, predicate] of Object.entries(filter)) {
        const pred = predicate;
        if ('equals' in pred) {
            parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
        }
        else if ('contains' in pred) {
            parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
        }
        else if ('startsWith' in pred) {
            parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
        }
        else if ('greaterThan' in pred) {
            parts.push(`${key}.gt=${pred.greaterThan}`);
        }
        else if ('lessThan' in pred) {
            parts.push(`${key}.lt=${pred.lessThan}`);
        }
    }
    return parts.join('&');
}
function parseQuery(query) {
    const result = { filter: {} };
    for (const part of query.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = part.slice(eqIdx + 1);
        // Handle sort parameter
        if (key === 'sort') {
            const [by, direction] = value.split('.');
            result.sort = { by, direction: direction || 'asc' };
            continue;
        }
        // Handle pagination parameters
        if (key === 'limit') {
            result.pagination = result.pagination || {};
            result.pagination.limit = Number(value);
            continue;
        }
        if (key === 'offset') {
            result.pagination = result.pagination || {};
            result.pagination.offset = Number(value);
            continue;
        }
        // Handle expand parameter (comma-separated list of properties)
        if (key === 'expand') {
            result.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
            continue;
        }
        // Handle filter parameters
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            result.filter[key] = { equals: decodeURIComponent(value) };
        }
        else {
            const prop = key.slice(0, dotIdx);
            const op = key.slice(dotIdx + 1);
            if (op === 'contains') {
                result.filter[prop] = { contains: decodeURIComponent(value) };
            }
            else if (op === 'startsWith') {
                result.filter[prop] = { startsWith: decodeURIComponent(value) };
            }
            else if (op === 'gt') {
                result.filter[prop] = { greaterThan: Number(value) };
            }
            else if (op === 'lt') {
                result.filter[prop] = { lessThan: Number(value) };
            }
        }
    }
    return result;
}
// Get completions for a partial URI - purely by inspecting live specifier objects
function getCompletions(partial) {
    // Parse scheme
    const schemeMatch = partial.match(/^([^:]*)(:\/?\/?)?(.*)?$/);
    if (!schemeMatch)
        return [];
    const [, schemePartial, schemeSep, pathPart] = schemeMatch;
    // If no scheme separator yet, suggest schemes
    if (!schemeSep || schemeSep !== '://') {
        return Object.keys(schemeRoots)
            .filter(s => s.startsWith(schemePartial))
            .map(s => ({ value: `${s}://`, label: s, description: 'Scheme' }));
    }
    const scheme = schemePartial;
    const path = pathPart || '';
    // Check if we're in a query string
    const queryIdx = path.indexOf('?');
    if (queryIdx !== -1) {
        return getQueryCompletions(scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1));
    }
    // Path completion
    return getPathCompletions(scheme, path);
}
function getPathCompletions(scheme, path) {
    const completions = [];
    // Split path and find the partial segment being typed
    const segments = path.split('/');
    const partialSegment = segments.pop() || '';
    const completePath = segments.join('/');
    // Resolve the parent specifier
    const parentUri = `${scheme}://${completePath}`;
    const parentResult = specifierFromURI(parentUri);
    if (!parentResult.ok)
        return [];
    const parent = parentResult.value;
    // Check if partial matches a property exactly - if so, navigate into it
    if (partialSegment && parent[partialSegment] !== undefined) {
        const child = parent[partialSegment];
        // If it's a collection, suggest addressing
        if (isCollection(child)) {
            return getCollectionCompletions(child, '');
        }
        // If it's a navigable specifier, suggest its properties
        if (child._isSpecifier) {
            return getPropertyCompletions(child, '');
        }
    }
    // Check if parent is a collection - suggest addressing
    if (isCollection(parent)) {
        return getCollectionCompletions(parent, partialSegment);
    }
    // Otherwise suggest properties matching partial
    return getPropertyCompletions(parent, partialSegment);
}
function isCollection(obj) {
    return obj && (typeof obj.byName === 'function' || typeof obj.byIndex === 'function' || typeof obj.byId === 'function');
}
function getCollectionCompletions(collection, partial) {
    const completions = [];
    // Favor name-based addressing - resolve and get actual names
    if (typeof collection.byName === 'function') {
        try {
            const resolved = collection.resolve();
            if (resolved.ok && Array.isArray(resolved.value)) {
                for (const item of resolved.value.slice(0, 10)) {
                    const name = item.name;
                    if (name && String(name).toLowerCase().startsWith(partial.toLowerCase())) {
                        completions.push({
                            value: encodeURIComponent(String(name)),
                            label: String(name),
                            description: 'By name'
                        });
                    }
                }
            }
        }
        catch { /* ignore */ }
    }
    // ID addressing if no name addressing
    if (typeof collection.byId === 'function' && typeof collection.byName !== 'function') {
        try {
            const resolved = collection.resolve();
            if (resolved.ok && Array.isArray(resolved.value)) {
                for (const item of resolved.value.slice(0, 10)) {
                    const id = item.id;
                    if (id && String(id).startsWith(partial)) {
                        completions.push({
                            value: String(id),
                            label: String(id),
                            description: 'By ID'
                        });
                    }
                }
            }
        }
        catch { /* ignore */ }
    }
    // Index addressing - show if typing bracket or no other completions
    if (typeof collection.byIndex === 'function') {
        if (partial.match(/^\[?\d*\]?$/) || completions.length === 0) {
            completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
        }
    }
    // Query option
    if (partial === '' || partial === '?') {
        completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
    }
    return completions;
}
function getPropertyCompletions(specifier, partial) {
    const completions = [];
    // Get all enumerable properties
    for (const key of Object.keys(specifier)) {
        if (key.startsWith('_') || key === 'uri' || key === 'resolve')
            continue;
        if (!key.toLowerCase().startsWith(partial.toLowerCase()))
            continue;
        const value = specifier[key];
        if (typeof value === 'function')
            continue;
        if (isCollection(value)) {
            completions.push({ value: `${key}/`, label: key, description: 'Collection' });
        }
        else if (value && value._isSpecifier && hasNavigableChildren(value)) {
            // Only mark as navigable if it has child properties beyond uri/resolve
            completions.push({ value: `${key}/`, label: key, description: 'Navigable' });
        }
        else {
            completions.push({ value: key, label: key, description: 'Property' });
        }
    }
    // Add completions from hooks
    for (const hook of completionHooks) {
        try {
            const extra = hook(specifier, partial);
            for (const c of extra) {
                if (c.label && c.label.toLowerCase().startsWith(partial.toLowerCase())) {
                    completions.push(c);
                }
            }
        }
        catch { /* ignore */ }
    }
    return completions;
}
function hasNavigableChildren(specifier) {
    for (const key of Object.keys(specifier)) {
        if (key.startsWith('_') || key === 'uri' || key === 'resolve')
            continue;
        if (typeof specifier[key] !== 'function')
            return true;
    }
    return false;
}
function getQueryCompletions(scheme, basePath, query) {
    const completions = [];
    // Resolve to get the collection and a sample element
    const spec = specifierFromURI(`${scheme}://${basePath}`);
    if (!spec.ok || !isCollection(spec.value))
        return [];
    const collection = spec.value;
    // Parse current query
    const params = query.split('&');
    const lastParam = params[params.length - 1] || '';
    // Standard query params
    if (!lastParam.includes('=') || lastParam === '') {
        if ('sort'.startsWith(lastParam))
            completions.push({ value: 'sort=', label: 'sort', description: 'Sort results' });
        if ('limit'.startsWith(lastParam))
            completions.push({ value: 'limit=', label: 'limit', description: 'Limit count' });
        if ('offset'.startsWith(lastParam))
            completions.push({ value: 'offset=', label: 'offset', description: 'Skip N' });
        if ('expand'.startsWith(lastParam))
            completions.push({ value: 'expand=', label: 'expand', description: 'Expand lazy props' });
    }
    // Get a sample element to find filterable properties
    let sampleElement = null;
    try {
        const resolved = collection.resolve();
        if (resolved.ok && resolved.value.length > 0) {
            sampleElement = resolved.value[0];
        }
    }
    catch { /* ignore */ }
    if (!sampleElement)
        return completions;
    // Property name completion for filters
    if (!lastParam.includes('=') && !lastParam.includes('.')) {
        for (const key of Object.keys(sampleElement)) {
            if (key.startsWith('_'))
                continue;
            const val = sampleElement[key];
            if (typeof val !== 'function' && !isCollection(val) && !(val && val._isSpecifier)) {
                if (key.startsWith(lastParam)) {
                    completions.push({ value: `${key}=`, label: key, description: `Filter by ${key}` });
                }
            }
        }
    }
    // Operator completion (property.xxx)
    const dotMatch = lastParam.match(/^(\w+)\.(\w*)$/);
    if (dotMatch) {
        const [, , opPartial] = dotMatch;
        const operators = ['contains', 'startsWith', 'gt', 'lt'];
        for (const op of operators) {
            if (op.startsWith(opPartial)) {
                completions.push({ value: `${dotMatch[1]}.${op}=`, label: op, description: `${op} operator` });
            }
        }
    }
    // Sort value completion
    if (lastParam.startsWith('sort=')) {
        const sortVal = lastParam.slice(5);
        if (!sortVal.includes('.')) {
            for (const key of Object.keys(sampleElement)) {
                if (key.startsWith('_'))
                    continue;
                const val = sampleElement[key];
                if (typeof val !== 'function' && !isCollection(val) && key.startsWith(sortVal)) {
                    completions.push({ value: `sort=${key}.`, label: key, description: `Sort by ${key}` });
                }
            }
        }
        else {
            const [prop] = sortVal.split('.');
            const dir = sortVal.split('.')[1] || '';
            if ('asc'.startsWith(dir))
                completions.push({ value: `sort=${prop}.asc`, label: 'asc', description: 'Ascending' });
            if ('desc'.startsWith(dir))
                completions.push({ value: `sort=${prop}.desc`, label: 'desc', description: 'Descending' });
        }
    }
    // Expand value completion - find lazy specifier properties
    if (lastParam.startsWith('expand=')) {
        const expandVal = lastParam.slice(7);
        for (const key of Object.keys(sampleElement)) {
            if (key.startsWith('_'))
                continue;
            const val = sampleElement[key];
            if (val && val._isSpecifier && key.startsWith(expandVal)) {
                completions.push({ value: `expand=${key}`, label: key, description: 'Expand lazy property' });
            }
        }
    }
    return completions;
}
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
function parseEmailAddress(raw) {
    if (!raw)
        return { name: '', address: '' };
    // Format: "Name" <email@domain.com> or Name <email@domain.com> or just email@domain.com
    const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
    if (match) {
        const name = (match[1] || '').trim();
        const address = (match[2] || '').trim();
        // If no name but we have something that looks like an email, check if address has a name component
        if (!name && address.includes('@')) {
            return { name: '', address };
        }
        // If the "address" doesn't have @, it might just be a name
        if (!address.includes('@')) {
            return { name: address, address: '' };
        }
        return { name, address };
    }
    // Fallback: treat the whole thing as the address
    return { name: '', address: raw.trim() };
}
// ============================================================================
// Apple Mail Schema Definitions
// ============================================================================
// ============================================================================
// Rule Condition Schema
// ============================================================================
const RuleConditionBase = {
    header: accessor('header'),
    qualifier: accessor('qualifier'),
    ruleType: accessor('ruleType'),
    expression: accessor('expression'),
};
// ============================================================================
// Rule Schema
// ============================================================================
const RuleBase = {
    name: accessor('name'),
    enabled: accessor('enabled'),
    allConditionsMustBeMet: accessor('allConditionsMustBeMet'),
    // Actions - simple properties
    deleteMessage: accessor('deleteMessage'),
    markRead: accessor('markRead'),
    markFlagged: accessor('markFlagged'),
    markFlagIndex: accessor('markFlagIndex'),
    stopEvaluatingRules: accessor('stopEvaluatingRules'),
    // Actions - string properties
    forwardMessage: accessor('forwardMessage'),
    redirectMessage: accessor('redirectMessage'),
    replyText: accessor('replyText'),
    playSound: accessor('playSound'),
    highlightTextUsingColor: accessor('highlightTextUsingColor'),
    // Mailbox actions (computed to get mailbox name, lazy to avoid upfront resolution)
    copyMessage: computed((jxa) => {
        try {
            const mb = jxa.copyMessage();
            return mb ? mb.name() : null;
        }
        catch {
            return null;
        }
    }),
    moveMessage: computed((jxa) => {
        try {
            const mb = jxa.moveMessage();
            return mb ? mb.name() : null;
        }
        catch {
            return null;
        }
    }),
    // Conditions collection
    ruleConditions: collection('ruleConditions', RuleConditionBase, ['index']),
};
// ============================================================================
// Signature Schema
// ============================================================================
const SignatureBase = {
    name: accessor('name'),
    content: lazyAccessor('content'), // lazy - can be large
};
// ============================================================================
// Recipient Schema
// ============================================================================
const RecipientBase = {
    name: accessor('name'),
    address: accessor('address'),
};
const AttachmentBase = {
    id: accessor('id'),
    name: accessor('name'),
    fileSize: accessor('fileSize'),
};
const MessageBase = {
    id: accessor('id'),
    messageId: accessor('messageId'),
    subject: accessor('subject'),
    sender: computed((jxa) => parseEmailAddress(str(jxa.sender()))),
    replyTo: computed((jxa) => parseEmailAddress(str(jxa.replyTo()))),
    dateSent: accessor('dateSent'),
    dateReceived: accessor('dateReceived'),
    content: lazyAccessor('content'), // lazy - expensive to fetch
    readStatus: accessor('readStatus'),
    flaggedStatus: accessor('flaggedStatus'),
    junkMailStatus: accessor('junkMailStatus'),
    messageSize: accessor('messageSize'),
    toRecipients: collection('toRecipients', RecipientBase, ['name', 'index']),
    ccRecipients: collection('ccRecipients', RecipientBase, ['name', 'index']),
    bccRecipients: collection('bccRecipients', RecipientBase, ['name', 'index']),
    attachments: collection('mailAttachments', AttachmentBase, ['name', 'index', 'id']),
};
const MailboxBase = {
    name: accessor('name'),
    unreadCount: accessor('unreadCount'),
    messages: collection('messages', MessageBase, ['index', 'id'])
};
// Self-referential: mailboxes contain mailboxes
MailboxBase.mailboxes = collection('mailboxes', MailboxBase, ['name', 'index']);
const AccountBase = {
    id: accessor('id'),
    name: accessor('name'),
    fullName: accessor('fullName'),
    emailAddresses: accessor('emailAddresses'),
    mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'])
};
// Standard mailbox schemas (same structure as Mailbox but different accessors)
const StandardMailboxBase = {
    name: accessor('name'),
    unreadCount: accessor('unreadCount'),
    messages: collection('messages', MessageBase, ['index', 'id'])
};
const MailAppBase = {
    accounts: collection('accounts', AccountBase, ['name', 'index', 'id']),
    rules: collection('rules', RuleBase, ['name', 'index']),
    signatures: collection('signatures', SignatureBase, ['name', 'index']),
    // Standard mailboxes (aggregate across all accounts)
    inbox: { _standardMailbox: true, _jxaName: 'inbox' },
    drafts: { _standardMailbox: true, _jxaName: 'draftsMailbox' },
    junk: { _standardMailbox: true, _jxaName: 'junkMailbox' },
    outbox: { _standardMailbox: true, _jxaName: 'outbox' },
    sent: { _standardMailbox: true, _jxaName: 'sentMailbox' },
    trash: { _standardMailbox: true, _jxaName: 'trashMailbox' }
};
// ============================================================================
// Create Derived Types
// ============================================================================
const RuleCondition = createDerived(RuleConditionBase, 'RuleCondition');
const Rule = createDerived(RuleBase, 'Rule');
const Signature = createDerived(SignatureBase, 'Signature');
const Recipient = createDerived(RecipientBase, 'Recipient');
const Attachment = createDerived(AttachmentBase, 'Attachment');
const Message = createDerived(MessageBase, 'Message');
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');
// ============================================================================
// Entry Point
// ============================================================================
const MailApp = createDerived(MailAppBase, 'Mail');
// Create derived type for standard mailboxes
const StandardMailbox = createDerived(StandardMailboxBase, 'StandardMailbox');
// Helper to create standard mailbox specifier
function createStandardMailboxSpecifier(uri, jxaMailbox) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => StandardMailbox.fromJXA(jxaMailbox, uri), uri);
        }
    };
    // Add properties from StandardMailboxBase
    for (const [key, descriptor] of Object.entries(StandardMailboxBase)) {
        if ('_accessor' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxaMailbox[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxaMailbox[desc._jxaName], desc._elementBase, desc._addressing, 'StandardMailbox_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Lazily initialized app specifier
let _mailApp = null;
function getMailApp() {
    if (!_mailApp) {
        const jxa = Application('Mail');
        const app = MailApp.fromJXA(jxa, 'mail://');
        // Add specifier-like properties
        app.uri = 'mail://';
        app._isSpecifier = true;
        app.resolve = () => ({ ok: true, value: app });
        // Add standard mailbox specifiers
        const standardMailboxes = [
            { name: 'inbox', jxaName: 'inbox' },
            { name: 'drafts', jxaName: 'draftsMailbox' },
            { name: 'junk', jxaName: 'junkMailbox' },
            { name: 'outbox', jxaName: 'outbox' },
            { name: 'sent', jxaName: 'sentMailbox' },
            { name: 'trash', jxaName: 'trashMailbox' }
        ];
        for (const { name, jxaName } of standardMailboxes) {
            Object.defineProperty(app, name, {
                get() {
                    return createStandardMailboxSpecifier(`mail://${name}`, jxa[jxaName]);
                },
                enumerable: true
            });
        }
        _mailApp = app;
    }
    return _mailApp;
}
// Register mail:// scheme
registerScheme('mail', getMailApp);
// Standard mailbox aliases for accounts
// Handles mail://accounts[X]/inbox, /sent, /drafts, /junk, /trash
const accountStandardMailboxes = {
    inbox: 'inbox',
    sent: 'sentMailbox',
    drafts: 'draftsMailbox',
    junk: 'junkMailbox',
    trash: 'trashMailbox'
};
// Completion hook for account standard mailboxes
registerCompletionHook((specifier, partial) => {
    // Only applies to account specifiers (check if URI matches accounts[X])
    if (!specifier || !specifier.uri || !specifier.uri.match(/^mail:\/\/accounts\[\d+\]$/)) {
        return [];
    }
    return Object.keys(accountStandardMailboxes)
        .filter(name => name.startsWith(partial.toLowerCase()))
        .map(name => ({
        value: `${name}/`,
        label: name,
        description: 'Standard mailbox'
    }));
});
registerNavigationHook((parent, name, uri) => {
    // Check if this is an account specifier navigating to a standard mailbox
    const jxaAppName = accountStandardMailboxes[name];
    if (!jxaAppName)
        return undefined;
    // Check if parent has an id (accounts have id)
    if (!parent || !parent._isSpecifier)
        return undefined;
    // Try to get the account's JXA object and find its standard mailbox
    try {
        const parentResult = parent.resolve();
        if (!parentResult.ok)
            return undefined;
        const accountId = parentResult.value.id;
        if (!accountId)
            return undefined;
        // Get the app-level standard mailbox and find the one for this account
        const jxa = Application('Mail');
        const appMailbox = jxa[jxaAppName]();
        const accountMailbox = appMailbox.mailboxes().find((m) => {
            try {
                return m.account().id() === accountId;
            }
            catch {
                return false;
            }
        });
        if (!accountMailbox)
            return undefined;
        // Create a mailbox specifier for it
        return createMailboxSpecifier(uri, accountMailbox);
    }
    catch {
        return undefined;
    }
});
// Helper to create a mailbox specifier for a JXA mailbox
function createMailboxSpecifier(uri, jxaMailbox) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => Mailbox.fromJXA(jxaMailbox, uri), uri);
        }
    };
    // Add properties from MailboxBase
    for (const [key, descriptor] of Object.entries(MailboxBase)) {
        if ('_accessor' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxaMailbox[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxaMailbox[desc._jxaName], desc._elementBase, desc._addressing, 'Mailbox_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Export for JXA
globalThis.specifierFromURI = specifierFromURI;
globalThis.getCompletions = getCompletions;
/// <reference path="./types/mcp.d.ts" />
// ============================================================================
// MCP Resource Handler
// ============================================================================
function readResource(uri) {
    const spec = specifierFromURI(uri);
    if (!spec.ok) {
        return { mimeType: 'text/plain', text: spec.error };
    }
    const result = spec.value.resolve();
    if (!result.ok) {
        return { mimeType: 'text/plain', text: result.error };
    }
    // Try to get a stable reference URI via fix()
    let fixedUri;
    const fixed = spec.value.fix();
    if (fixed.ok && fixed.value.uri !== uri) {
        fixedUri = fixed.value.uri;
        // Update _uri in result if it's an object
        if (result.value && typeof result.value === 'object' && '_uri' in result.value) {
            result.value._uri = fixedUri;
        }
    }
    return { mimeType: 'application/json', text: result.value, fixedUri };
}
function listResources() {
    const resources = [
        // Standard mailboxes (aggregate across accounts)
        { uri: 'mail://inbox', name: 'Inbox', description: 'Combined inbox from all accounts' },
        { uri: 'mail://sent', name: 'Sent', description: 'Combined sent from all accounts' },
        { uri: 'mail://drafts', name: 'Drafts', description: 'Combined drafts from all accounts' },
        { uri: 'mail://trash', name: 'Trash', description: 'Combined trash from all accounts' },
        { uri: 'mail://junk', name: 'Junk', description: 'Combined junk/spam from all accounts' },
        { uri: 'mail://outbox', name: 'Outbox', description: 'Messages waiting to be sent' },
        // Accounts
        { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' },
        // Rules and Signatures
        { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
        { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' }
    ];
    const spec = specifierFromURI('mail://accounts');
    if (spec.ok) {
        const result = spec.value.resolve();
        if (result.ok) {
            for (let i = 0; i < result.value.length; i++) {
                const acc = result.value[i];
                resources.push({
                    uri: `mail://accounts[${i}]`,
                    name: acc.name,
                    description: `Account: ${acc.fullName}`
                });
            }
        }
    }
    return resources;
}
// ============================================================================
// Resource Templates Documentation
// ============================================================================
//
// URI Structure: mail://{path}?{query}
//
// Path Addressing:
//   - By index:  collection[0], collection[1], ...
//   - By name:   collection/MyName (for mailboxes, recipients)
//   - By id:     collection/12345 (for messages)
//
// Query Parameters:
//   Filters (applied server-side when possible):
//     - Exact match:   ?name=Inbox
//     - Greater than:  ?unreadCount.gt=0
//     - Less than:     ?messageSize.lt=1000000
//     - Contains:      ?subject.contains=urgent
//     - Starts with:   ?name.startsWith=Project
//
//   Sorting:
//     - Ascending:     ?sort=name.asc
//     - Descending:    ?sort=dateReceived.desc
//
//   Pagination:
//     - Limit:         ?limit=10
//     - Offset:        ?offset=20
//     - Combined:      ?limit=10&offset=20
//
//   Expand (resolve lazy properties inline):
//     - Single:        ?expand=content
//     - Multiple:      ?expand=content,attachments
//
//   Combined:
//     ?unreadCount.gt=0&sort=unreadCount.desc&limit=10&expand=content
//
// ============================================================================
const resourceTemplates = [
    // --- Standard Mailboxes (aggregate across all accounts) ---
    {
        uriTemplate: 'mail://inbox',
        name: 'All Inboxes',
        description: 'Combined inbox across all accounts. Returns: name, unreadCount, messages'
    },
    {
        uriTemplate: 'mail://inbox/messages',
        name: 'Inbox Messages',
        description: 'Messages from all inboxes'
    },
    {
        uriTemplate: 'mail://inbox/messages?{query}',
        name: 'Filtered Inbox Messages',
        description: 'Filter: ?readStatus=false, ?subject.contains=X. Sort: ?sort=dateReceived.desc. Paginate: ?limit=10&offset=0'
    },
    {
        uriTemplate: 'mail://sent',
        name: 'All Sent',
        description: 'Combined sent mailbox across all accounts'
    },
    {
        uriTemplate: 'mail://drafts',
        name: 'All Drafts',
        description: 'Combined drafts mailbox across all accounts'
    },
    {
        uriTemplate: 'mail://trash',
        name: 'All Trash',
        description: 'Combined trash mailbox across all accounts'
    },
    {
        uriTemplate: 'mail://junk',
        name: 'All Junk',
        description: 'Combined junk/spam mailbox across all accounts'
    },
    {
        uriTemplate: 'mail://outbox',
        name: 'Outbox',
        description: 'Messages waiting to be sent'
    },
    // --- Accounts ---
    {
        uriTemplate: 'mail://accounts',
        name: 'All Accounts',
        description: 'List all mail accounts'
    },
    {
        uriTemplate: 'mail://accounts[{index}]',
        name: 'Account by Index',
        description: 'Single account. Returns: id, name, fullName, emailAddresses'
    },
    {
        uriTemplate: 'mail://accounts/{name}',
        name: 'Account by Name',
        description: 'Single account by name. Example: mail://accounts/iCloud'
    },
    // --- Account Standard Mailboxes ---
    {
        uriTemplate: 'mail://accounts[{index}]/inbox',
        name: 'Account Inbox',
        description: "The account's inbox mailbox"
    },
    {
        uriTemplate: 'mail://accounts[{index}]/sent',
        name: 'Account Sent',
        description: "The account's sent mailbox"
    },
    {
        uriTemplate: 'mail://accounts[{index}]/drafts',
        name: 'Account Drafts',
        description: "The account's drafts mailbox"
    },
    {
        uriTemplate: 'mail://accounts[{index}]/junk',
        name: 'Account Junk',
        description: "The account's junk/spam mailbox"
    },
    {
        uriTemplate: 'mail://accounts[{index}]/trash',
        name: 'Account Trash',
        description: "The account's trash/deleted items mailbox"
    },
    {
        uriTemplate: 'mail://accounts[{index}]/inbox/messages?{query}',
        name: 'Account Inbox Messages',
        description: "Messages in the account's inbox. Supports filter/sort/pagination"
    },
    // --- Mailboxes ---
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes',
        name: 'Mailboxes',
        description: 'All mailboxes for an account. Returns: name, unreadCount per mailbox'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}',
        name: 'Mailbox by Name',
        description: 'Single mailbox. Supports nested: /mailboxes/Work/mailboxes/Projects'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes?{query}',
        name: 'Filtered Mailboxes',
        description: 'Filter: ?name=Inbox, ?unreadCount.gt=0. Sort: ?sort=unreadCount.desc'
    },
    // --- Messages ---
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages',
        name: 'Messages',
        description: 'All messages. Returns: id, subject, sender {name, address}, dateSent, readStatus, etc. Content is lazy (use ?expand=content)'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages[{msgIndex}]',
        name: 'Message by Index',
        description: 'Single message by position (0-indexed)'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}',
        name: 'Message by ID',
        description: 'Single message by Mail.app message ID'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages?{query}',
        name: 'Filtered Messages',
        description: 'Filter: ?readStatus=false, ?flaggedStatus=true. Sort: ?sort=dateReceived.desc. Expand: ?expand=content'
    },
    // --- Message Content (Lazy) ---
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/content',
        name: 'Message Content',
        description: 'Full message body text. Fetched separately as it can be large'
    },
    // --- Recipients ---
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/toRecipients',
        name: 'To Recipients',
        description: 'To recipients. Returns: name, address'
    },
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/ccRecipients',
        name: 'CC Recipients',
        description: 'CC recipients. Returns: name, address'
    },
    // --- Attachments ---
    {
        uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/attachments',
        name: 'Attachments',
        description: 'Message attachments. Returns: id, name, fileSize'
    },
    // --- Rules ---
    {
        uriTemplate: 'mail://rules',
        name: 'All Rules',
        description: 'List all mail filtering rules'
    },
    {
        uriTemplate: 'mail://rules[{index}]',
        name: 'Rule by Index',
        description: 'Single rule. Returns: name, enabled, conditions, actions'
    },
    {
        uriTemplate: 'mail://rules/{name}',
        name: 'Rule by Name',
        description: 'Single rule by name'
    },
    {
        uriTemplate: 'mail://rules[{index}]/ruleConditions',
        name: 'Rule Conditions',
        description: 'Conditions for a rule. Returns: header, qualifier, ruleType, expression'
    },
    // --- Signatures ---
    {
        uriTemplate: 'mail://signatures',
        name: 'All Signatures',
        description: 'List all email signatures'
    },
    {
        uriTemplate: 'mail://signatures[{index}]',
        name: 'Signature by Index',
        description: 'Single signature by position'
    },
    {
        uriTemplate: 'mail://signatures/{name}',
        name: 'Signature by Name',
        description: 'Single signature by name. Returns: name, content (lazy)'
    }
];
// Export for JXA
globalThis.readResource = readResource;
globalThis.listResources = listResources;
globalThis.resourceTemplates = resourceTemplates;
/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mail-app.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="framework.ts" />
/// <reference path="mail.ts" />
/// <reference path="resources.ts" />
// ============================================================================
// Apple Mail MCP Server - Entry Point
// Phase 1: Resources-only implementation
// ============================================================================
const server = new MCPServer("apple-mail-jxa", "1.0.0");
// Register resource handlers
server.setResources(listResources, readResource);
server.setResourceTemplates(resourceTemplates);
// Start the server
server.run();
