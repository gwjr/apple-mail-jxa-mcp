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
/// <reference path="../types/jxa.d.ts" />
// ============================================================================
// SQLite Cache for message lookups
// Stores message locations to avoid expensive mailbox scans
// ============================================================================
const CACHE_DIR = $.NSHomeDirectory().js + '/.cache/jxa-mail';
const CACHE_DB = CACHE_DIR + '/messages.db';
const ATTACHMENTS_DIR = CACHE_DIR + '/attachments';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    mailbox_path TEXT NOT NULL,
    internal_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_account_mailbox ON messages(account, mailbox_path);
CREATE VIEW IF NOT EXISTS mailbox_popularity AS
SELECT account, mailbox_path, COUNT(*) as message_count
FROM messages GROUP BY account, mailbox_path ORDER BY message_count DESC;
`;
const Cache = {
    _initialized: false,
    init() {
        if (this._initialized)
            return;
        const fm = $.NSFileManager.defaultManager;
        if (!fm.fileExistsAtPath(CACHE_DIR)) {
            fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(CACHE_DIR, true, $(), $());
        }
        if (!fm.fileExistsAtPath(ATTACHMENTS_DIR)) {
            fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(ATTACHMENTS_DIR, true, $(), $());
        }
        this.sql(SCHEMA);
        this._initialized = true;
    },
    sql(query) {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;
        // Shell-safe escaping: single quotes prevent all interpolation
        const shellEsc = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
        try {
            return app.doShellScript('sqlite3 ' + shellEsc(CACHE_DB) + ' ' + shellEsc(query));
        }
        catch {
            return null;
        }
    },
    store(messageId, account, mailboxPath, internalId) {
        this.init();
        const esc = (s) => s.replace(/'/g, "''");
        this.sql(`INSERT OR REPLACE INTO messages VALUES ('${esc(messageId)}', '${esc(account)}', '${esc(mailboxPath)}', ${internalId})`);
    },
    lookup(messageId) {
        this.init();
        const result = this.sql(`SELECT account, mailbox_path, internal_id FROM messages WHERE message_id = '${messageId.replace(/'/g, "''")}'`);
        if (!result)
            return null;
        const parts = result.split('|');
        if (parts.length < 3)
            return null;
        const [account, mailboxPath, internalIdStr] = parts;
        const internalId = parseInt(internalIdStr, 10);
        return !isNaN(internalId) ? { account, mailboxPath, internalId } : null;
    },
    popularMailboxes() {
        this.init();
        const result = this.sql('SELECT account, mailbox_path FROM mailbox_popularity');
        if (!result)
            return [];
        return result.split('\n').filter(l => l).map(l => {
            const [account, mailboxPath] = l.split('|');
            return { account, mailboxPath };
        });
    },
    getAttachmentsDir() {
        this.init();
        return ATTACHMENTS_DIR;
    }
};
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
// ============================================================================
// Collection and Specifier Base Patterns
// Lazy navigation with explicit resolution
// ============================================================================
// ============================================================================
// Result Helpers
// ============================================================================
function ok(value) {
    return { ok: true, value };
}
function err(error) {
    return { ok: false, error };
}
// ============================================================================
// String Coercion
// JXA returns bridged Cocoa strings with enumerable character keys.
// This causes JSON.stringify to iterate every character. Force primitive.
// ============================================================================
function str(val) {
    return val == null ? '' : '' + val;
}
function strOrNull(val) {
    return val == null ? null : '' + val;
}
// Safe property access with fallback
function getOr(fn, fallback) {
    try {
        const value = fn();
        return value ?? fallback;
    }
    catch {
        return fallback;
    }
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="cache.ts" />
/// <reference path="collections.ts" />
function MessageSpecifier(jxa, accountName, mailboxPath) {
    // Cache computed values
    let _id = null;
    let _messageId = null;
    const self = {
        _jxa: jxa,
        accountName,
        mailboxPath,
        get id() {
            if (_id === null) {
                _id = getOr(() => jxa.id(), 0);
            }
            return _id;
        },
        get messageId() {
            if (_messageId === null) {
                _messageId = str(getOr(() => jxa.messageId(), ''));
            }
            return _messageId;
        },
        get messageUrl() {
            const mid = self.messageId
                .replace(/%/g, '%25')
                .replace(/ /g, '%20')
                .replace(/#/g, '%23');
            return `message://<${mid}>`;
        },
        get read() {
            return getOr(() => jxa.readStatus, false);
        },
        set read(value) {
            jxa.readStatus = value;
        },
        get flagged() {
            return getOr(() => jxa.flaggedStatus, false);
        },
        set flagged(value) {
            jxa.flaggedStatus = value;
        },
        uri() {
            return URIBuilder.message(accountName, mailboxPath, self.id);
        },
        cache() {
            try {
                Cache.store(self.messageId, accountName, mailboxPath.join('/'), self.id);
            }
            catch {
                // Ignore cache errors
            }
        },
        resolve() {
            try {
                const id = self.id;
                if (id === 0) {
                    return err(`Failed to resolve message in ${accountName}/${mailboxPath.join('/')}: invalid id`);
                }
                const resolveRecipients = (getter) => {
                    try {
                        return getter().map(r => ({
                            name: strOrNull(getOr(() => r.name(), null)),
                            address: str(getOr(() => r.address(), ''))
                        }));
                    }
                    catch {
                        return [];
                    }
                };
                const resolveAttachments = () => {
                    try {
                        return jxa.mailAttachments().map((a, i) => ({
                            index: i,
                            name: str(getOr(() => a.name(), '')),
                            mimeType: str(getOr(() => a.mimeType(), 'application/octet-stream')),
                            fileSize: getOr(() => a.fileSize(), null),
                            downloaded: getOr(() => a.downloaded(), false)
                        }));
                    }
                    catch {
                        return [];
                    }
                };
                let dateSent = null;
                let dateReceived = null;
                try {
                    const ds = jxa.dateSent();
                    dateSent = ds ? ds.toISOString() : null;
                }
                catch { /* ignore */ }
                try {
                    const dr = jxa.dateReceived();
                    dateReceived = dr ? dr.toISOString() : null;
                }
                catch { /* ignore */ }
                const message = {
                    id,
                    messageId: self.messageId,
                    subject: strOrNull(getOr(() => jxa.subject(), null)),
                    sender: strOrNull(getOr(() => jxa.sender(), null)),
                    dateSent,
                    dateReceived,
                    read: self.read,
                    flagged: self.flagged,
                    replyTo: strOrNull(getOr(() => jxa.replyTo(), null)),
                    content: strOrNull(getOr(() => jxa.content(), null)),
                    toRecipients: resolveRecipients(() => jxa.toRecipients()),
                    ccRecipients: resolveRecipients(() => jxa.ccRecipients()),
                    bccRecipients: resolveRecipients(() => jxa.bccRecipients()),
                    attachments: resolveAttachments()
                };
                self.cache();
                return ok(message);
            }
            catch (e) {
                const err_msg = e instanceof Error ? e.message : String(e);
                return err(`Failed to resolve message in ${accountName}/${mailboxPath.join('/')}: ${err_msg}`);
            }
        },
        summary() {
            self.cache();
            let dateReceived = null;
            try {
                const dr = jxa.dateReceived();
                dateReceived = dr ? dr.toISOString() : null;
            }
            catch { /* ignore */ }
            return {
                id: self.id,
                uri: self.uri(),
                messageUrl: self.messageUrl,
                subject: strOrNull(getOr(() => jxa.subject(), null)),
                sender: strOrNull(getOr(() => jxa.sender(), null)),
                dateReceived,
                read: self.read,
                flagged: self.flagged
            };
        },
        full() {
            self.cache();
            const resolveRecipients = (getter) => {
                try {
                    return getter().map(r => ({
                        name: strOrNull(getOr(() => r.name(), null)),
                        address: str(getOr(() => r.address(), ''))
                    }));
                }
                catch {
                    return [];
                }
            };
            let dateSent = null;
            let dateReceived = null;
            try {
                const ds = jxa.dateSent();
                dateSent = ds ? ds.toISOString() : null;
            }
            catch { /* ignore */ }
            try {
                const dr = jxa.dateReceived();
                dateReceived = dr ? dr.toISOString() : null;
            }
            catch { /* ignore */ }
            return {
                id: self.id,
                uri: self.uri(),
                messageUrl: self.messageUrl,
                subject: strOrNull(getOr(() => jxa.subject(), null)),
                sender: strOrNull(getOr(() => jxa.sender(), null)),
                dateReceived,
                dateSent,
                read: self.read,
                flagged: self.flagged,
                replyTo: strOrNull(getOr(() => jxa.replyTo(), null)),
                junk: getOr(() => jxa.junkMailStatus(), null),
                mailbox: mailboxPath.join('/'),
                account: accountName,
                content: strOrNull(getOr(() => jxa.content(), null)),
                toRecipients: resolveRecipients(() => jxa.toRecipients()),
                ccRecipients: resolveRecipients(() => jxa.ccRecipients()),
                attachments: self.getAttachments(),
                attachmentsUri: URIBuilder.messageAttachments(accountName, mailboxPath, self.id)
            };
        },
        getAttachments() {
            try {
                return jxa.mailAttachments().map((a, i) => ({
                    index: i,
                    name: str(getOr(() => a.name(), '')),
                    mimeType: str(getOr(() => a.mimeType(), 'application/octet-stream')),
                    fileSize: getOr(() => a.fileSize(), null),
                    downloaded: getOr(() => a.downloaded(), false)
                }));
            }
            catch {
                return [];
            }
        }
    };
    return self;
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="cache.ts" />
/// <reference path="collections.ts" />
/// <reference path="message.ts" />
function MailboxSpecifier(jxa, accountName, path) {
    const self = {
        _jxa: jxa,
        accountName,
        path,
        get name() {
            return str(getOr(() => jxa.name(), ''));
        },
        get unreadCount() {
            return getOr(() => jxa.unreadCount(), 0);
        },
        uri() {
            return URIBuilder.mailbox(accountName, path);
        },
        resolve() {
            try {
                const mailbox = {
                    name: self.name,
                    unreadCount: self.unreadCount
                };
                return ok(mailbox);
            }
            catch (e) {
                const err_msg = e instanceof Error ? e.message : String(e);
                return err(`Failed to resolve mailbox ${path.join('/')} in ${accountName}: ${err_msg}`);
            }
        },
        info() {
            return {
                name: self.name,
                uri: self.uri(),
                unreadCount: self.unreadCount,
                messagesUri: URIBuilder.mailboxMessages(accountName, path),
                mailboxesUri: URIBuilder.mailboxMailboxes(accountName, path)
            };
        },
        infoWithChildren(hasChildren) {
            return {
                ...self.info(),
                hasChildren
            };
        },
        // Efficient message access - uses index-based iteration to avoid N+1
        getMessages(opts) {
            const options = opts ?? {};
            const limit = options.limit ?? 20;
            const offset = options.offset ?? 0;
            const unreadOnly = options.unreadOnly ?? false;
            const result = [];
            // If filtering by unread, use whose() clause
            if (unreadOnly) {
                try {
                    const unreadMsgs = jxa.messages.whose({ readStatus: { _equals: false } })();
                    const startIdx = offset;
                    const endIdx = Math.min(offset + limit, unreadMsgs.length);
                    for (let i = startIdx; i < endIdx; i++) {
                        try {
                            result.push(MessageSpecifier(unreadMsgs[i], accountName, path));
                        }
                        catch {
                            // Skip messages that fail to load
                        }
                    }
                    return result;
                }
                catch {
                    return [];
                }
            }
            // For all messages, use index-based access to avoid loading all
            let index = 0;
            let collected = 0;
            try {
                while (collected < limit) {
                    try {
                        const msg = jxa.messages.at(index);
                        // Verify the message exists by accessing a property
                        msg.id();
                        if (index >= offset) {
                            result.push(MessageSpecifier(msg, accountName, path));
                            collected++;
                        }
                        index++;
                    }
                    catch {
                        // No more messages or error accessing this index
                        break;
                    }
                }
                return result;
            }
            catch {
                return [];
            }
        },
        getMessageById(id) {
            try {
                const msg = jxa.messages.byId(id);
                // Verify it exists
                msg.id();
                return MessageSpecifier(msg, accountName, path);
            }
            catch {
                return null;
            }
        },
        searchByMessageId(messageId) {
            try {
                const found = jxa.messages.whose({ messageId: { _equals: messageId } })();
                return found.length > 0 ? MessageSpecifier(found[0], accountName, path) : null;
            }
            catch {
                return null;
            }
        },
        getChildMailboxes() {
            try {
                return jxa.mailboxes().map((m) => {
                    const childName = str(getOr(() => m.name(), ''));
                    return MailboxSpecifier(m, accountName, [...path, childName]);
                });
            }
            catch {
                return [];
            }
        }
    };
    return self;
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="collections.ts" />
/// <reference path="mailbox.ts" />
function AccountSpecifier(jxa) {
    // Cache the name since it's used frequently
    let _name = null;
    const self = {
        _jxa: jxa,
        get name() {
            if (_name === null) {
                _name = str(getOr(() => jxa.name(), ''));
            }
            return _name;
        },
        get emailAddresses() {
            return getOr(() => jxa.emailAddresses(), []);
        },
        get enabled() {
            return getOr(() => jxa.enabled(), false);
        },
        get fullName() {
            return str(getOr(() => jxa.fullName(), ''));
        },
        uri() {
            return URIBuilder.account(self.name);
        },
        info() {
            return {
                name: self.name,
                uri: self.uri(),
                mailboxesUri: URIBuilder.accountMailboxes(self.name),
                emailAddresses: self.emailAddresses,
                enabled: self.enabled
            };
        },
        getAllMailboxes() {
            try {
                return jxa.mailboxes().map((m) => {
                    // Extract path from JXA specifier display string
                    const displayStr = Automation.getDisplayString(m);
                    const match = displayStr.match(/mailboxes\.byName\("([^"]+)"\)/);
                    const mailboxPath = match ? match[1] : str(getOr(() => m.name(), ''));
                    const pathParts = mailboxPath.split('/');
                    return MailboxSpecifier(m, self.name, pathParts);
                });
            }
            catch {
                return [];
            }
        },
        getTopLevelMailboxes() {
            const all = self.getAllMailboxes();
            // Top-level mailboxes have single-element paths
            return all.filter(mb => mb.path.length === 1);
        },
        findMailbox(path) {
            try {
                const mb = jxa.mailboxes.byName(path);
                // Verify it exists
                mb.name();
                const pathParts = path.split('/');
                return MailboxSpecifier(mb, self.name, pathParts);
            }
            catch {
                return null;
            }
        }
    };
    return self;
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="cache.ts" />
/// <reference path="collections.ts" />
/// <reference path="message.ts" />
/// <reference path="mailbox.ts" />
/// <reference path="account.ts" />
// ============================================================================
// Mail.app Singleton
// Central interface to Apple Mail via JXA
// ============================================================================
const Mail = {
    _app: null,
    get app() {
        if (!this._app) {
            this._app = Application('Mail');
        }
        return this._app;
    },
    // ============================================================================
    // Accounts
    // ============================================================================
    getAccounts() {
        try {
            return this.app.accounts().map((a) => AccountSpecifier(a));
        }
        catch {
            return [];
        }
    },
    getAccount(name) {
        try {
            const acc = this.app.accounts.byName(name);
            // Verify exists
            acc.name();
            return AccountSpecifier(acc);
        }
        catch {
            return null;
        }
    },
    // ============================================================================
    // Mailbox Lookup
    // ============================================================================
    findMailbox(accountName, mailboxPath) {
        const account = this.getAccount(accountName);
        if (!account)
            return null;
        return account.findMailbox(mailboxPath);
    },
    // Find mailbox by name across accounts (or within specific account)
    findMailboxByName(accountName, name) {
        const accounts = accountName
            ? [this.getAccount(accountName)].filter((a) => a !== null)
            : this.getAccounts();
        for (const acc of accounts) {
            for (const mb of acc.getAllMailboxes()) {
                if (mb.name === name)
                    return mb;
            }
        }
        return null;
    },
    // Navigate mailbox hierarchy: given path array, find the nested mailbox
    findMailboxByPath(accountName, pathParts) {
        if (pathParts.length === 0)
            return null;
        const account = this.getAccount(accountName);
        if (!account)
            return null;
        // Build the path string for JXA lookup
        const fullPath = pathParts.join('/');
        return account.findMailbox(fullPath);
    },
    // ============================================================================
    // Message Lookup
    // ============================================================================
    // Find message by internal ID in a specific mailbox
    findMessageById(accountName, mailboxPath, messageId) {
        const mb = this.findMailboxByPath(accountName, mailboxPath);
        if (!mb)
            return null;
        return mb.getMessageById(messageId);
    },
    // Best-effort message lookup from message:// URL
    // Uses cache first, then searches inboxes
    messageFromUrl(url) {
        const match = url.match(/^message:\/\/<(.+)>$/);
        if (!match)
            return null;
        // Decode URL escapes (must decode %25 first to handle literal % in message IDs)
        const messageId = match[1]
            .replace(/%25/g, '%')
            .replace(/%23/g, '#')
            .replace(/%20/g, ' ');
        // 1. Cache lookup (fast path)
        const cached = Cache.lookup(messageId);
        if (cached) {
            const mb = this.findMailbox(cached.account, cached.mailboxPath);
            if (mb) {
                const msg = mb.searchByMessageId(messageId);
                if (msg)
                    return msg;
            }
        }
        // 2. Quick inbox search across all accounts
        for (const acc of this.getAccounts()) {
            const inbox = this.findMailboxByName(acc.name, 'INBOX')
                || this.findMailboxByName(acc.name, 'Inbox');
            if (inbox) {
                const msg = inbox.searchByMessageId(messageId);
                if (msg) {
                    msg.cache();
                    return msg;
                }
            }
        }
        // Not found - no exhaustive search to keep response fast
        return null;
    },
    // ============================================================================
    // Unified Mailboxes (Cross-Account)
    // ============================================================================
    get inbox() {
        try {
            return MailboxSpecifier(this.app.inbox, '__unified__', ['INBOX']);
        }
        catch {
            return null;
        }
    },
    get drafts() {
        try {
            return MailboxSpecifier(this.app.drafts, '__unified__', ['Drafts']);
        }
        catch {
            return null;
        }
    },
    get sentMailbox() {
        try {
            return MailboxSpecifier(this.app.sentMailbox, '__unified__', ['Sent']);
        }
        catch {
            return null;
        }
    },
    get junkMailbox() {
        try {
            return MailboxSpecifier(this.app.junkMailbox, '__unified__', ['Junk']);
        }
        catch {
            return null;
        }
    },
    get trash() {
        try {
            return MailboxSpecifier(this.app.trash, '__unified__', ['Trash']);
        }
        catch {
            return null;
        }
    },
    get outbox() {
        try {
            return MailboxSpecifier(this.app.outbox, '__unified__', ['Outbox']);
        }
        catch {
            return null;
        }
    },
    // ============================================================================
    // Actions
    // ============================================================================
    checkForNewMail() {
        try {
            this.app.checkForNewMail();
        }
        catch {
            // Ignore
        }
    },
    moveMessage(msg, toMailbox) {
        this.app.move(msg._jxa, { to: toMailbox._jxa });
    },
    deleteMessage(msg) {
        this.app.delete(msg._jxa);
    },
    // ============================================================================
    // Rules
    // ============================================================================
    getRules() {
        return getOr(() => this.app.rules(), []);
    },
    // ============================================================================
    // Signatures
    // ============================================================================
    getSignatures() {
        return getOr(() => this.app.signatures(), []);
    }
};
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
function readProperties() {
    const app = Mail.app;
    return {
        mimeType: 'application/json',
        text: {
            name: getOr(() => app.name(), null),
            version: getOr(() => app.version(), null),
            applicationVersion: getOr(() => app.applicationVersion(), null),
            frontmost: getOr(() => app.frontmost(), null),
            alwaysBccMyself: getOr(() => app.alwaysBccMyself(), null),
            alwaysCcMyself: getOr(() => app.alwaysCcMyself(), null),
            downloadHtmlAttachments: getOr(() => app.downloadHtmlAttachments(), null),
            fetchInterval: getOr(() => app.fetchInterval(), null),
            expandGroupAddresses: getOr(() => app.expandGroupAddresses(), null),
            defaultMessageFormat: getOr(() => app.defaultMessageFormat(), null),
            chooseSignatureWhenComposing: getOr(() => app.chooseSignatureWhenComposing(), null),
            selectedSignature: getOr(() => { const sig = app.selectedSignature(); return sig ? sig.name() : null; }, null),
            quoteOriginalMessage: getOr(() => app.quoteOriginalMessage(), null),
            sameReplyFormat: getOr(() => app.sameReplyFormat(), null),
            includeAllOriginalMessageText: getOr(() => app.includeAllOriginalMessageText(), null),
            highlightSelectedConversation: getOr(() => app.highlightSelectedConversation(), null),
            colorQuotedText: getOr(() => app.colorQuotedText(), null),
            levelOneQuotingColor: getOr(() => app.levelOneQuotingColor(), null),
            levelTwoQuotingColor: getOr(() => app.levelTwoQuotingColor(), null),
            levelThreeQuotingColor: getOr(() => app.levelThreeQuotingColor(), null),
            messageFont: getOr(() => app.messageFont(), null),
            messageFontSize: getOr(() => app.messageFontSize(), null),
            messageListFont: getOr(() => app.messageListFont(), null),
            messageListFontSize: getOr(() => app.messageListFontSize(), null),
            useFixedWidthFont: getOr(() => app.useFixedWidthFont(), null),
            fixedWidthFont: getOr(() => app.fixedWidthFont(), null),
            fixedWidthFontSize: getOr(() => app.fixedWidthFontSize(), null),
            newMailSound: getOr(() => app.newMailSound(), null),
            shouldPlayOtherMailSounds: getOr(() => app.shouldPlayOtherMailSounds(), null),
            checkSpellingWhileTyping: getOr(() => app.checkSpellingWhileTyping(), null)
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
function readRulesList() {
    const rules = Mail.getRules();
    return {
        mimeType: 'application/json',
        text: {
            count: rules.length,
            rules: rules.map((r, i) => ({
                uri: URIBuilder.rules(i),
                name: getOr(() => r.name(), ''),
                enabled: getOr(() => r.enabled(), false)
            }))
        }
    };
}
function readRule(index) {
    const rules = Mail.getRules();
    if (index < 0 || index >= rules.length) {
        return null;
    }
    const r = rules[index];
    let conditions = [];
    try {
        const rawConditions = r.ruleConditions();
        conditions = rawConditions.map(c => ({
            header: getOr(() => c.header(), null),
            qualifier: getOr(() => c.qualifier(), null),
            ruleType: getOr(() => c.ruleType(), null),
            expression: getOr(() => c.expression(), null)
        }));
    }
    catch {
        // Ignore condition read errors
    }
    return {
        mimeType: 'application/json',
        text: {
            index,
            name: getOr(() => r.name(), null),
            enabled: getOr(() => r.enabled(), null),
            allConditionsMustBeMet: getOr(() => r.allConditionsMustBeMet(), null),
            copyMessage: getOr(() => { const mb = r.copyMessage(); return mb ? mb.name() : null; }, null),
            moveMessage: getOr(() => { const mb = r.moveMessage(); return mb ? mb.name() : null; }, null),
            forwardMessage: getOr(() => r.forwardMessage(), null),
            redirectMessage: getOr(() => r.redirectMessage(), null),
            replyText: getOr(() => r.replyText(), null),
            runScript: getOr(() => { const s = r.runScript(); return s && s.name ? s.name() : null; }, null),
            highlightTextUsingColor: getOr(() => r.highlightTextUsingColor(), null),
            deleteMessage: getOr(() => r.deleteMessage(), null),
            markFlagged: getOr(() => r.markFlagged(), null),
            markFlagIndex: getOr(() => r.markFlagIndex(), null),
            markRead: getOr(() => r.markRead(), null),
            playSound: getOr(() => r.playSound(), null),
            stopEvaluatingRules: getOr(() => r.stopEvaluatingRules(), null),
            ruleConditions: conditions
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
function readSignaturesList() {
    const signatures = Mail.getSignatures();
    return {
        mimeType: 'application/json',
        text: {
            count: signatures.length,
            signatures: signatures.map(s => ({
                uri: URIBuilder.signatures(getOr(() => s.name(), '')),
                name: getOr(() => s.name(), '')
            }))
        }
    };
}
function readSignature(name) {
    const signatures = Mail.getSignatures();
    const sig = signatures.find(s => getOr(() => s.name(), '') === name);
    if (!sig) {
        return null;
    }
    return {
        mimeType: 'application/json',
        text: {
            name: getOr(() => sig.name(), ''),
            content: getOr(() => sig.content(), '')
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
function readAccountsList() {
    const accounts = Mail.getAccounts();
    return {
        mimeType: 'application/json',
        text: {
            accounts: accounts.map(acc => ({
                name: acc.name,
                uri: URIBuilder.account(acc.name),
                mailboxesUri: URIBuilder.accountMailboxes(acc.name)
            }))
        }
    };
}
function readAccount(accountName) {
    const account = Mail.getAccount(accountName);
    if (!account) {
        return null;
    }
    return {
        mimeType: 'application/json',
        text: {
            name: account.name,
            uri: URIBuilder.account(account.name),
            mailboxesUri: URIBuilder.accountMailboxes(account.name),
            emailAddresses: account.emailAddresses,
            enabled: account.enabled,
            fullName: account.fullName
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
// Read top-level mailboxes for an account
function readAccountMailboxes(accountName) {
    const account = Mail.getAccount(accountName);
    if (!account)
        return null;
    const allMailboxes = account.getAllMailboxes();
    const topLevel = account.getTopLevelMailboxes();
    return {
        mimeType: 'application/json',
        text: {
            accountUri: URIBuilder.account(accountName),
            mailboxes: topLevel.map(mb => {
                const pathParts = mb.path;
                const mbPathStr = pathParts.join('/');
                const hasChildren = allMailboxes.some(other => other.path.join('/').startsWith(mbPathStr + '/'));
                return {
                    name: mb.name,
                    uri: URIBuilder.mailbox(accountName, pathParts),
                    unreadCount: mb.unreadCount,
                    messagesUri: URIBuilder.mailboxMessages(accountName, pathParts),
                    mailboxesUri: URIBuilder.mailboxMailboxes(accountName, pathParts),
                    hasChildren
                };
            })
        }
    };
}
// Read a specific mailbox info
function readMailbox(accountName, pathParts) {
    const mb = Mail.findMailboxByPath(accountName, pathParts);
    if (!mb)
        return null;
    return {
        mimeType: 'application/json',
        text: {
            name: mb.name,
            uri: URIBuilder.mailbox(accountName, pathParts),
            unreadCount: mb.unreadCount,
            messagesUri: URIBuilder.mailboxMessages(accountName, pathParts),
            mailboxesUri: URIBuilder.mailboxMailboxes(accountName, pathParts)
        }
    };
}
// Read child mailboxes of a specific mailbox
function readMailboxChildren(accountName, pathParts) {
    const account = Mail.getAccount(accountName);
    if (!account)
        return null;
    const parentPath = pathParts.join('/');
    const allMailboxes = account.getAllMailboxes();
    // Find direct children (one level deeper)
    const prefix = parentPath + '/';
    const children = allMailboxes.filter(mb => {
        const mbPath = mb.path.join('/');
        if (!mbPath.startsWith(prefix))
            return false;
        const remainder = mbPath.slice(prefix.length);
        return !remainder.includes('/'); // Direct child only
    });
    return {
        mimeType: 'application/json',
        text: {
            parentUri: URIBuilder.mailbox(accountName, pathParts),
            mailboxes: children.map(mb => {
                const childPathParts = mb.path;
                const mbPath = childPathParts.join('/');
                const hasChildren = allMailboxes.some(other => other.path.join('/').startsWith(mbPath + '/'));
                return {
                    name: mb.name,
                    uri: URIBuilder.mailbox(accountName, childPathParts),
                    unreadCount: mb.unreadCount,
                    messagesUri: URIBuilder.mailboxMessages(accountName, childPathParts),
                    mailboxesUri: URIBuilder.mailboxMailboxes(accountName, childPathParts),
                    hasChildren
                };
            })
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
// ============================================================================
// Messages Resource Handler
// Returns message listings and individual message details
// ============================================================================
// Read message listing for a mailbox
function readMailboxMessages(accountName, pathParts, query) {
    const mb = Mail.findMailboxByPath(accountName, pathParts);
    if (!mb)
        return null;
    const messages = mb.getMessages({
        limit: query.limit,
        offset: query.offset,
        unreadOnly: query.unread
    });
    return {
        mimeType: 'application/json',
        text: {
            mailboxUri: URIBuilder.mailbox(accountName, pathParts),
            limit: query.limit,
            offset: query.offset,
            unread: query.unread,
            messages: messages.map(msg => msg.summary())
        }
    };
}
// Read a single message by ID
function readMessage(accountName, pathParts, messageId) {
    const msg = Mail.findMessageById(accountName, pathParts, messageId);
    if (!msg)
        return null;
    return {
        mimeType: 'application/json',
        text: msg.full()
    };
}
// Read message attachments
function readMessageAttachments(accountName, pathParts, messageId) {
    const msg = Mail.findMessageById(accountName, pathParts, messageId);
    if (!msg)
        return null;
    return {
        mimeType: 'application/json',
        text: {
            messageUri: URIBuilder.message(accountName, pathParts, messageId),
            attachments: msg.getAttachments()
        }
    };
}
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
/// <reference path="properties.ts" />
/// <reference path="rules.ts" />
/// <reference path="signatures.ts" />
/// <reference path="accounts.ts" />
/// <reference path="mailboxes.ts" />
/// <reference path="messages.ts" />
// ============================================================================
// Resource Registry
// Provides resource lister and reader for the MCP server
// ============================================================================
// List all top-level resources
function listResources() {
    const resources = [
        { uri: 'mail://properties', name: 'App Properties', description: 'Mail.app settings and properties' },
        { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
        { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' },
        { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' }
    ];
    // Add individual accounts
    const accounts = Mail.getAccounts();
    for (const acc of accounts) {
        resources.push({
            uri: URIBuilder.account(acc.name),
            name: acc.name,
            description: 'Mail account'
        });
    }
    return resources;
}
// Read a resource by URI
function readResource(uri) {
    const parsed = parseMailURI(uri);
    switch (parsed.type) {
        case 'properties':
            return readProperties();
        case 'rules':
            if (parsed.index !== undefined) {
                return readRule(parsed.index);
            }
            return readRulesList();
        case 'signatures':
            if (parsed.name !== undefined) {
                return readSignature(parsed.name);
            }
            return readSignaturesList();
        case 'accounts':
            return readAccountsList();
        case 'account':
            return readAccount(parsed.account);
        case 'account-mailboxes':
            return readAccountMailboxes(parsed.account);
        case 'mailbox':
            return readMailbox(parsed.account, parsed.path);
        case 'mailbox-mailboxes':
            return readMailboxChildren(parsed.account, parsed.path);
        case 'mailbox-messages':
            return readMailboxMessages(parsed.account, parsed.path, parsed.query);
        case 'message':
            return readMessage(parsed.account, parsed.path, parsed.id);
        case 'message-attachments':
            return readMessageAttachments(parsed.account, parsed.path, parsed.id);
        case 'unknown':
        default:
            return null;
    }
}
// Resource templates for discovery
const resourceTemplates = [
    {
        uriTemplate: 'mail://accounts/{account}',
        name: 'Account',
        description: 'Mail account details'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes',
        name: 'Account Mailboxes',
        description: 'Top-level mailboxes for an account'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}',
        name: 'Mailbox',
        description: 'Mailbox info (path is slash-separated for nested mailboxes)'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/mailboxes',
        name: 'Child Mailboxes',
        description: 'Child mailboxes of a mailbox'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages',
        name: 'Messages',
        description: 'Messages in a mailbox'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages?limit={limit}&offset={offset}',
        name: 'Paginated Messages',
        description: 'Messages with pagination'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages?unread=true',
        name: 'Unread Messages',
        description: 'Only unread messages'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages/{id}',
        name: 'Message',
        description: 'Full message details'
    },
    {
        uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages/{id}/attachments',
        name: 'Attachments',
        description: 'Message attachments list'
    },
    {
        uriTemplate: 'mail://rules/{index}',
        name: 'Rule',
        description: 'Individual mail rule details'
    },
    {
        uriTemplate: 'mail://signatures/{name}',
        name: 'Signature',
        description: 'Individual signature content'
    }
];
/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mail-app.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/uri-router.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="mail/cache.ts" />
/// <reference path="mail/collections.ts" />
/// <reference path="mail/message.ts" />
/// <reference path="mail/mailbox.ts" />
/// <reference path="mail/account.ts" />
/// <reference path="mail/app.ts" />
/// <reference path="resources/properties.ts" />
/// <reference path="resources/rules.ts" />
/// <reference path="resources/signatures.ts" />
/// <reference path="resources/accounts.ts" />
/// <reference path="resources/mailboxes.ts" />
/// <reference path="resources/messages.ts" />
/// <reference path="resources/index.ts" />
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
