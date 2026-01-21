"use strict";
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mcp.d.ts" />
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
// scratch/framework.ts - Plugboard v4 Framework
//
// Core types, proto system, URI parsing - no app-specific code.
// App schemas (mail.ts, notes.ts) use these building blocks.
// ─────────────────────────────────────────────────────────────────────────────
// Root Marker (for parent navigation)
// ─────────────────────────────────────────────────────────────────────────────
// Use a runtime symbol for the RootMarker
const RootBrand = Symbol('RootBrand');
const ROOT = { [RootBrand]: true };
function isRoot(d) {
    return RootBrand in d;
}
const equalsOp = {
    name: 'equals',
    parseUri: (s) => s,
    toJxa: (v) => v,
    test: (a, b) => a === b,
    toUri: (v) => encodeURIComponent(String(v)),
};
const containsOp = {
    name: 'contains',
    parseUri: (s) => s,
    toJxa: (v) => ({ _contains: v }),
    test: (a, b) => typeof a === 'string' && a.includes(b),
    toUri: (v) => encodeURIComponent(v),
};
const startsWithOp = {
    name: 'startsWith',
    parseUri: (s) => s,
    toJxa: (v) => ({ _beginsWith: v }),
    test: (a, b) => typeof a === 'string' && a.startsWith(b),
    toUri: (v) => encodeURIComponent(v),
};
const gtOp = {
    name: 'gt',
    parseUri: parseFloat,
    toJxa: (v) => ({ _greaterThan: v }),
    test: (a, b) => a > b,
    toUri: (v) => String(v),
};
const ltOp = {
    name: 'lt',
    parseUri: parseFloat,
    toJxa: (v) => ({ _lessThan: v }),
    test: (a, b) => a < b,
    toUri: (v) => String(v),
};
const filterOperators = [equalsOp, containsOp, startsWithOp, gtOp, ltOp];
function getOperatorByName(name) {
    return filterOperators.find(op => op.name === name);
}
const equals = (value) => ({ operator: equalsOp, value });
const contains = (value) => ({ operator: containsOp, value });
const startsWith = (value) => ({ operator: startsWithOp, value });
const gt = (value) => ({ operator: gtOp, value });
const lt = (value) => ({ operator: ltOp, value });
function createRes(delegate, proto) {
    const handler = {
        get(t, prop, receiver) {
            if (prop === '_delegate')
                return t._delegate;
            if (prop in proto) {
                const value = proto[prop];
                if (typeof value === 'function') {
                    return value.bind(receiver);
                }
                if (typeof value === 'object' && value !== null) {
                    // Check for namespace navigation first
                    const namespaceProto = getNamespaceNav(value);
                    if (namespaceProto) {
                        return createRes(t._delegate.namespace(prop), namespaceProto);
                    }
                    // Check for computed navigation
                    const navInfo = getComputedNav(value);
                    if (navInfo) {
                        const targetDelegate = navInfo.navigate(t._delegate);
                        return createRes(targetDelegate, navInfo.targetProto);
                    }
                    // Normal property navigation - use jxaName if defined, otherwise use the property name
                    const jxaName = getJxaName(value);
                    const schemaName = prop;
                    if (jxaName) {
                        // Navigate with JXA name but track schema name for URI
                        return createRes(t._delegate.propWithAlias(jxaName, schemaName), value);
                    }
                    else {
                        return createRes(t._delegate.prop(schemaName), value);
                    }
                }
                return value;
            }
            return undefined;
        },
        has(t, prop) {
            if (prop === '_delegate')
                return true;
            return prop in proto;
        }
    };
    return new Proxy({ _delegate: delegate }, handler);
}
// Shared implementation for base proto methods
const _baseProtoImpl = {
    resolve() {
        return this._delegate._jxa();
    },
    resolve_eager() {
        return this.resolve();
    },
    exists() {
        try {
            this._delegate._jxa();
            return true;
        }
        catch {
            return false;
        }
    },
    specifier() {
        return { uri: this._delegate.uri().href };
    },
};
// Typed scalar factory
function scalar() {
    return { ..._baseProtoImpl };
}
// Typed collection factory
function collection() {
    return { ..._baseProtoImpl };
}
// Primitive type scalars
const t = {
    string: scalar(),
    number: scalar(),
    boolean: scalar(),
    date: scalar(),
    any: scalar(),
};
// Legacy aliases (untyped, for backwards compatibility)
const baseScalar = scalar();
const baseCollection = collection();
// Convenience alias
const eagerScalar = baseScalar;
// ─────────────────────────────────────────────────────────────────────────────
// Composers
// ─────────────────────────────────────────────────────────────────────────────
function makeLazy(proto) {
    return {
        ...proto,
        resolve_eager() {
            return this.specifier();
        },
    };
}
function withSet(proto) {
    return {
        ...proto,
        set(value) {
            this._delegate.set(value);
        },
    };
}
const collectionItemProtos = new WeakMap();
function withByIndex(itemProto) {
    return function (proto) {
        const result = {
            ...proto,
            byIndex(n) {
                return createRes(this._delegate.byIndex(n), itemProto);
            },
        };
        collectionItemProtos.set(result, itemProto);
        return result;
    };
}
function withByName(itemProto) {
    return function (proto) {
        const result = {
            ...proto,
            byName(name) {
                return createRes(this._delegate.byName(name), itemProto);
            },
        };
        collectionItemProtos.set(result, itemProto);
        return result;
    };
}
function withById(itemProto) {
    return function (proto) {
        const result = {
            ...proto,
            byId(id) {
                return createRes(this._delegate.byId(id), itemProto);
            },
        };
        collectionItemProtos.set(result, itemProto);
        return result;
    };
}
// Composer: adds move() with optional custom handler
// Type parameter Item constrains what collections this can move to
function withMove(itemProto, handler) {
    return function (proto) {
        const result = {
            ...proto,
            move(to) {
                const urlResult = handler
                    ? handler(this._delegate, to._delegate)
                    : this._delegate.moveTo(to._delegate);
                if (!urlResult.ok)
                    return urlResult;
                // Resolve URL to Res for caller
                const resolveResult = resolveURI(urlResult.value.href);
                if (!resolveResult.ok)
                    return resolveResult;
                return { ok: true, value: resolveResult.value };
            },
        };
        return result;
    };
}
// Composer: adds delete() with optional custom handler
function withDelete(handler) {
    return function (proto) {
        return {
            ...proto,
            delete() {
                return handler
                    ? handler(this._delegate)
                    : this._delegate.delete();
            },
        };
    };
}
// Composer: adds create() with optional custom handler
function withCreate(itemProto, handler) {
    return function (proto) {
        return {
            ...proto,
            create(properties) {
                const urlResult = handler
                    ? handler(this._delegate, properties)
                    : this._delegate.create(properties);
                if (!urlResult.ok)
                    return urlResult;
                const resolveResult = resolveURI(urlResult.value.href);
                if (!resolveResult.ok)
                    return resolveResult;
                return { ok: true, value: resolveResult.value };
            },
        };
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// JXA Name Mapping
// ─────────────────────────────────────────────────────────────────────────────
// Store jxaName mapping (proto -> jxaName)
const jxaNameMap = new WeakMap();
function withJxaName(proto, jxaName) {
    // Create a new object that inherits from proto
    const named = Object.assign(Object.create(null), proto);
    jxaNameMap.set(named, jxaName);
    // Also copy over the item proto if this is a collection
    const itemProto = collectionItemProtos.get(proto);
    if (itemProto) {
        collectionItemProtos.set(named, itemProto);
    }
    return named;
}
function getJxaName(proto) {
    return jxaNameMap.get(proto);
}
// ─────────────────────────────────────────────────────────────────────────────
// Computed Properties
// ─────────────────────────────────────────────────────────────────────────────
// A computed property transforms the raw value from the delegate
function computed(transform) {
    return {
        resolve() {
            const raw = this._delegate._jxa();
            return transform(raw);
        },
        resolve_eager() {
            return this.resolve();
        },
        exists() {
            try {
                this._delegate._jxa();
                return true;
            }
            catch {
                return false;
            }
        },
        specifier() {
            return { uri: this._delegate.uri().href };
        },
    };
}
// Lazy computed - resolve_eager returns specifier instead of value
function lazyComputed(transform) {
    return makeLazy(computed(transform));
}
const computedNavMap = new WeakMap();
function computedNav(navigate, targetProto) {
    // Create a proto that has the base methods (resolve, exists, specifier) using the navigated delegate
    const navProto = {
        resolve() {
            return navigate(this._delegate)._jxa();
        },
        resolve_eager() {
            return this.resolve();
        },
        exists() {
            try {
                navigate(this._delegate)._jxa();
                return true;
            }
            catch {
                return false;
            }
        },
        specifier() {
            return { uri: navigate(this._delegate).uri().href };
        },
    };
    computedNavMap.set(navProto, { navigate, targetProto });
    return navProto;
}
function getComputedNav(proto) {
    return computedNavMap.get(proto);
}
const namespaceNavMap = new WeakMap();
function namespaceNav(targetProto) {
    const navProto = {
        ...baseScalar,
    };
    namespaceNavMap.set(navProto, targetProto);
    return navProto;
}
function getNamespaceNav(proto) {
    return namespaceNavMap.get(proto);
}
function applyQueryState(items, query) {
    let results = items;
    if (query.filter && Object.keys(query.filter).length > 0) {
        results = results.filter((item) => {
            for (const [field, pred] of Object.entries(query.filter)) {
                if (!pred.operator.test(item[field], pred.value)) {
                    return false;
                }
            }
            return true;
        });
    }
    if (query.sort) {
        const { by, direction = 'asc' } = query.sort;
        results = [...results].sort((a, b) => {
            const aVal = a[by];
            const bVal = b[by];
            const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return direction === 'desc' ? -cmp : cmp;
        });
    }
    if (query.pagination) {
        const { offset = 0, limit } = query.pagination;
        results = limit !== undefined ? results.slice(offset, offset + limit) : results.slice(offset);
    }
    return results;
}
function withQuery(proto) {
    const itemProto = collectionItemProtos.get(proto);
    return {
        ...proto,
        resolve() {
            const raw = this._delegate._jxa();
            const query = this._delegate.queryState();
            let results = applyQueryState(raw, query);
            if (query.expand && query.expand.length > 0 && itemProto) {
                results = results.map((item, idx) => {
                    const expanded = { ...item };
                    for (const field of query.expand) {
                        const fieldProto = itemProto[field];
                        if (fieldProto && typeof fieldProto === 'object' && 'resolve' in fieldProto) {
                            try {
                                if (field in item && typeof item[field] === 'function') {
                                    expanded[field] = item[field]();
                                }
                                else if (field in item) {
                                    expanded[field] = item[field];
                                }
                            }
                            catch {
                            }
                        }
                    }
                    return expanded;
                });
            }
            return results;
        },
        whose(filter) {
            const newDelegate = this._delegate.withFilter(filter);
            return createRes(newDelegate, withQuery(proto));
        },
        sortBy(spec) {
            const newDelegate = this._delegate.withSort(spec);
            return createRes(newDelegate, withQuery(proto));
        },
        paginate(spec) {
            const newDelegate = this._delegate.withPagination(spec);
            return createRes(newDelegate, withQuery(proto));
        },
        expand(fields) {
            const newDelegate = this._delegate.withExpand(fields);
            return createRes(newDelegate, withQuery(proto));
        },
    };
}
function buildURIString(segments) {
    let uri = '';
    for (const seg of segments) {
        switch (seg.kind) {
            case 'root':
                uri = `${seg.scheme}://`;
                break;
            case 'prop':
                uri += (uri.endsWith('://') ? '' : '/') + seg.name;
                break;
            case 'index':
                uri += `[${seg.value}]`;
                break;
            case 'name':
                uri += '/' + encodeURIComponent(seg.value);
                break;
            case 'id':
                uri += '/' + encodeURIComponent(String(seg.value));
                break;
        }
    }
    return uri;
}
function buildURI(segments) {
    return new URL(buildURIString(segments));
}
function buildQueryString(query) {
    const parts = [];
    if (query.filter) {
        for (const [field, pred] of Object.entries(query.filter)) {
            const opName = pred.operator.name;
            const value = pred.operator.toUri(pred.value);
            if (opName === 'equals') {
                parts.push(`${field}=${value}`);
            }
            else {
                parts.push(`${field}.${opName}=${value}`);
            }
        }
    }
    if (query.sort) {
        parts.push(`sort=${String(query.sort.by)}.${query.sort.direction || 'asc'}`);
    }
    if (query.pagination?.limit !== undefined) {
        parts.push(`limit=${query.pagination.limit}`);
    }
    if (query.pagination?.offset !== undefined) {
        parts.push(`offset=${query.pagination.offset}`);
    }
    if (query.expand && query.expand.length > 0) {
        parts.push(`expand=${query.expand.join(',')}`);
    }
    return parts.join('&');
}
// ─────────────────────────────────────────────────────────────────────────────
// Composition utilities
// ─────────────────────────────────────────────────────────────────────────────
function pipe(a, f) {
    return f(a);
}
function pipe2(a, f, g) {
    return g(f(a));
}
function pipe3(a, f, g, h) {
    return h(g(f(a)));
}
function parseFilterOp(op) {
    switch (op) {
        case 'contains': return 'contains';
        case 'startsWith': return 'startsWith';
        case 'gt': return 'gt';
        case 'lt': return 'lt';
        default: return 'equals';
    }
}
function parseQueryQualifier(query) {
    const result = { kind: 'query', filters: [] };
    for (const part of query.split('&')) {
        if (!part)
            continue;
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = decodeURIComponent(part.slice(eqIdx + 1));
        if (key === 'sort') {
            const dotIdx = value.lastIndexOf('.');
            if (dotIdx !== -1) {
                const field = value.slice(0, dotIdx);
                const dir = value.slice(dotIdx + 1);
                result.sort = { field, direction: dir === 'desc' ? 'desc' : 'asc' };
            }
            else {
                result.sort = { field: value, direction: 'asc' };
            }
            continue;
        }
        if (key === 'limit') {
            result.limit = parseInt(value, 10);
            continue;
        }
        if (key === 'offset') {
            result.offset = parseInt(value, 10);
            continue;
        }
        if (key === 'expand') {
            result.expand = value.split(',').map(s => s.trim());
            continue;
        }
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            result.filters.push({ field: key, op: 'equals', value });
        }
        else {
            const field = key.slice(0, dotIdx);
            const opStr = key.slice(dotIdx + 1);
            const op = parseFilterOp(opStr);
            result.filters.push({ field, op, value });
        }
    }
    return result;
}
function isInteger(s) {
    return /^-?\d+$/.test(s);
}
function parseSegments(path) {
    if (!path)
        return [];
    const segments = [];
    let remaining = path;
    while (remaining) {
        if (remaining.startsWith('/')) {
            remaining = remaining.slice(1);
            if (!remaining)
                break;
        }
        let headEnd = remaining.length;
        for (let i = 0; i < remaining.length; i++) {
            if (remaining[i] === '/' || remaining[i] === '[' || remaining[i] === '?') {
                headEnd = i;
                break;
            }
        }
        const head = decodeURIComponent(remaining.slice(0, headEnd));
        remaining = remaining.slice(headEnd);
        if (segments.length > 0 && isInteger(head)) {
            const prev = segments[segments.length - 1];
            if (!prev.qualifier) {
                prev.qualifier = { kind: 'id', value: parseInt(head, 10) };
                continue;
            }
        }
        const segment = { head };
        if (remaining.startsWith('[')) {
            const closeIdx = remaining.indexOf(']');
            if (closeIdx !== -1) {
                const indexStr = remaining.slice(1, closeIdx);
                if (isInteger(indexStr)) {
                    segment.qualifier = { kind: 'index', value: parseInt(indexStr, 10) };
                    remaining = remaining.slice(closeIdx + 1);
                }
            }
        }
        if (remaining.startsWith('?')) {
            let queryEnd = remaining.length;
            for (let i = 1; i < remaining.length; i++) {
                if (remaining[i] === '/') {
                    queryEnd = i;
                    break;
                }
            }
            const queryStr = remaining.slice(1, queryEnd);
            segment.qualifier = parseQueryQualifier(queryStr);
            remaining = remaining.slice(queryEnd);
        }
        segments.push(segment);
    }
    return segments;
}
function lexURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return { ok: false, error: 'Invalid URI: missing scheme (expected scheme://...)' };
    }
    const scheme = uri.slice(0, schemeEnd);
    if (!scheme) {
        return { ok: false, error: 'Invalid URI: empty scheme' };
    }
    const path = uri.slice(schemeEnd + 3);
    const segments = parseSegments(path);
    return { ok: true, value: { scheme, segments } };
}
const schemeRegistry = {};
function registerScheme(scheme, createRoot, proto) {
    schemeRegistry[scheme] = { createRoot, proto };
}
// ─────────────────────────────────────────────────────────────────────────────
// URI Resolution
// ─────────────────────────────────────────────────────────────────────────────
function filtersToWhoseFilter(filters) {
    const result = {};
    for (const { field, op, value } of filters) {
        const operator = getOperatorByName(op);
        if (operator) {
            result[field] = { operator, value: operator.parseUri(value) };
        }
    }
    return result;
}
function sortToSortSpec(sort) {
    return { by: sort.field, direction: sort.direction };
}
function applyQueryQualifier(delegate, proto, qualifier) {
    let newDelegate = delegate;
    if (qualifier.filters.length > 0) {
        const whoseFilter = filtersToWhoseFilter(qualifier.filters);
        newDelegate = newDelegate.withFilter(whoseFilter);
    }
    if (qualifier.sort) {
        const sortSpec = sortToSortSpec(qualifier.sort);
        newDelegate = newDelegate.withSort(sortSpec);
    }
    if (qualifier.limit !== undefined || qualifier.offset !== undefined) {
        newDelegate = newDelegate.withPagination({
            limit: qualifier.limit,
            offset: qualifier.offset,
        });
    }
    if (qualifier.expand && qualifier.expand.length > 0) {
        newDelegate = newDelegate.withExpand(qualifier.expand);
    }
    const queryableProto = withQuery(proto);
    return { delegate: newDelegate, proto: queryableProto };
}
function hasByIndex(proto) {
    return 'byIndex' in proto && typeof proto.byIndex === 'function';
}
function hasByName(proto) {
    return 'byName' in proto && typeof proto.byName === 'function';
}
function hasById(proto) {
    return 'byId' in proto && typeof proto.byId === 'function';
}
function isChildProto(value) {
    return typeof value === 'object' && value !== null && 'resolve' in value && typeof value.resolve === 'function';
}
function getItemProto(collectionProto) {
    return collectionItemProtos.get(collectionProto);
}
function resolveURI(uri) {
    const lexResult = lexURI(uri);
    if (!lexResult.ok) {
        return { ok: false, error: lexResult.error };
    }
    const { scheme, segments } = lexResult.value;
    const registration = schemeRegistry[scheme];
    if (!registration) {
        const known = Object.keys(schemeRegistry);
        return { ok: false, error: `Unknown scheme: ${scheme}. Known: ${known.join(', ') || '(none)'}` };
    }
    let delegate = registration.createRoot();
    let proto = registration.proto;
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const { head, qualifier } = segment;
        const childProto = proto[head];
        // Check for namespaceNav first (virtual grouping, no JXA navigation)
        const namespaceProto = childProto ? getNamespaceNav(childProto) : undefined;
        if (namespaceProto) {
            delegate = delegate.namespace(head);
            proto = namespaceProto;
            // Namespaces don't have qualifiers - if there's a qualifier, it's an error
            if (qualifier) {
                return { ok: false, error: `Namespace '${head}' does not support qualifiers` };
            }
            continue;
        }
        // Check for computedNav
        const navInfo = childProto ? getComputedNav(childProto) : undefined;
        if (navInfo) {
            // Apply the computed navigation
            delegate = navInfo.navigate(delegate);
            proto = navInfo.targetProto;
            // Handle qualifiers on the target if any
            if (qualifier) {
                const itemProto = getItemProto(proto);
                if (qualifier.kind === 'index') {
                    if (!hasByIndex(proto)) {
                        return { ok: false, error: `computedNav target '${head}' does not support index addressing` };
                    }
                    delegate = delegate.byIndex(qualifier.value);
                    proto = itemProto || baseScalar;
                }
                else if (qualifier.kind === 'id') {
                    if (!hasById(proto)) {
                        return { ok: false, error: `computedNav target '${head}' does not support id addressing` };
                    }
                    delegate = delegate.byId(qualifier.value);
                    proto = itemProto || baseScalar;
                }
                else if (qualifier.kind === 'query') {
                    const applied = applyQueryQualifier(delegate, proto, qualifier);
                    delegate = applied.delegate;
                    proto = applied.proto;
                }
            }
        }
        else if (childProto !== undefined && isChildProto(childProto)) {
            // Normal property navigation - use jxaName if available
            const jxaName = getJxaName(childProto) || head;
            delegate = delegate.prop(jxaName);
            proto = childProto;
            if (qualifier) {
                const itemProto = getItemProto(proto);
                if (qualifier.kind === 'index') {
                    if (!hasByIndex(proto)) {
                        return { ok: false, error: `Collection '${head}' does not support index addressing` };
                    }
                    delegate = delegate.byIndex(qualifier.value);
                    proto = itemProto || baseScalar;
                }
                else if (qualifier.kind === 'id') {
                    if (!hasById(proto)) {
                        return { ok: false, error: `Collection '${head}' does not support id addressing` };
                    }
                    delegate = delegate.byId(qualifier.value);
                    proto = itemProto || baseScalar;
                }
                else if (qualifier.kind === 'query') {
                    const applied = applyQueryQualifier(delegate, proto, qualifier);
                    delegate = applied.delegate;
                    proto = applied.proto;
                }
            }
        }
        else if (hasByName(proto) || hasById(proto)) {
            const itemProto = getItemProto(proto);
            if (hasByName(proto)) {
                delegate = delegate.byName(head);
                proto = itemProto || baseScalar;
            }
            else if (hasById(proto)) {
                delegate = delegate.byId(head);
                proto = itemProto || baseScalar;
            }
            if (qualifier && qualifier.kind === 'index') {
                const subProto = proto[head];
                if (subProto && isChildProto(subProto) && hasByIndex(subProto)) {
                    delegate = delegate.prop(head).byIndex(qualifier.value);
                    proto = getItemProto(subProto) || baseScalar;
                }
            }
        }
        else {
            const available = Object.keys(proto).filter(k => {
                const v = proto[k];
                return isChildProto(v);
            });
            return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
        }
    }
    return { ok: true, value: createRes(delegate, proto) };
}
// scratch/jxa-backing.ts - JXA Delegate implementation
//
// This file is only included in JXA builds (osascript -l JavaScript)
// Contains the JXADelegate class and JXA-specific utilities
// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec, RootMarker, ROOT
// ─────────────────────────────────────────────────────────────────────────────
// JXA Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────
class JXADelegate {
    _jxaRef;
    _path;
    _jxaParent;
    _key;
    _parentDelegate;
    _query;
    constructor(_jxaRef, _path, _jxaParent, // Parent JXA object
    _key, // Property key in parent
    _parentDelegate, // Parent delegate for navigation
    _query = {}) {
        this._jxaRef = _jxaRef;
        this._path = _path;
        this._jxaParent = _jxaParent;
        this._key = _key;
        this._parentDelegate = _parentDelegate;
        this._query = _query;
    }
    _jxa() {
        // If we have a parent and key, call as property getter
        if (this._jxaParent && this._key) {
            return this._jxaParent[this._key]();
        }
        // Otherwise try to call directly (may be a specifier or function)
        if (typeof this._jxaRef === 'function') {
            return this._jxaRef();
        }
        return this._jxaRef;
    }
    prop(key) {
        const newPath = [...this._path, { kind: 'prop', name: key }];
        return new JXADelegate(this._jxaRef[key], newPath, this._jxaRef, key, this);
    }
    propWithAlias(jxaName, uriName) {
        // Navigate JXA using jxaName, but track uriName in path
        const newPath = [...this._path, { kind: 'prop', name: uriName }];
        return new JXADelegate(this._jxaRef[jxaName], newPath, this._jxaRef, jxaName, this);
    }
    namespace(name) {
        // A namespace adds a URI segment but keeps the same JXA ref (no navigation)
        const newPath = [...this._path, { kind: 'prop', name }];
        return new JXADelegate(this._jxaRef, newPath, this._jxaParent, this._key, this); // Same ref!
    }
    byIndex(n) {
        const newPath = [...this._path, { kind: 'index', value: n }];
        return new JXADelegate(this._jxaRef[n], newPath, this._jxaRef, undefined, this);
    }
    byName(name) {
        const newPath = [...this._path, { kind: 'name', value: name }];
        return new JXADelegate(this._jxaRef.byName(name), newPath, this._jxaRef, undefined, this);
    }
    byId(id) {
        const newPath = [...this._path, { kind: 'id', value: id }];
        return new JXADelegate(this._jxaRef.byId(id), newPath, this._jxaRef, undefined, this);
    }
    uri() {
        const base = buildURI(this._path);
        const queryStr = buildQueryString(this._query);
        if (queryStr) {
            return new URL(`${base.href}?${queryStr}`);
        }
        return base;
    }
    set(value) {
        if (this._jxaParent && this._key) {
            this._jxaParent[this._key] = value;
        }
        else {
            throw new Error('Cannot set on root object');
        }
    }
    // Parent navigation
    parent() {
        if (this._parentDelegate) {
            return this._parentDelegate;
        }
        return ROOT;
    }
    // Mutation: move this item to a destination collection
    // Generic JXA implementation - domain handlers may override
    moveTo(destination) {
        try {
            const destJxa = destination._jxaRef;
            // JXA move pattern: item.move({ to: destination })
            this._jxaRef.move({ to: destJxa });
            // Return the new URI (item is now in destination)
            const destUri = destination.uri();
            // Try to construct a URI based on item's id or name
            try {
                const id = this._jxaRef.id();
                return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(String(id))}`) };
            }
            catch {
                try {
                    const name = this._jxaRef.name();
                    return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(name)}`) };
                }
                catch {
                    // Fall back to destination URI (can't determine specific item URI)
                    return { ok: true, value: destUri };
                }
            }
        }
        catch (e) {
            return { ok: false, error: `JXA move failed: ${e.message || e}` };
        }
    }
    // Mutation: delete this item
    delete() {
        try {
            const uri = this.uri();
            this._jxaRef.delete();
            return { ok: true, value: uri };
        }
        catch (e) {
            return { ok: false, error: `JXA delete failed: ${e.message || e}` };
        }
    }
    // Mutation: create a new item in this collection
    create(properties) {
        try {
            // JXA create pattern: Application.make({ new: 'type', withProperties: {...} })
            // For collections, we typically use collection.push() or make()
            // This generic implementation tries the push pattern
            const newItem = this._jxaRef.push(properties);
            // Return URI to new item
            const baseUri = this.uri();
            try {
                const id = newItem.id();
                return { ok: true, value: new URL(`${baseUri.href}/${encodeURIComponent(String(id))}`) };
            }
            catch {
                try {
                    const name = newItem.name();
                    return { ok: true, value: new URL(`${baseUri.href}/${encodeURIComponent(name)}`) };
                }
                catch {
                    return { ok: true, value: baseUri };
                }
            }
        }
        catch (e) {
            return { ok: false, error: `JXA create failed: ${e.message || e}` };
        }
    }
    // Query state methods - merge filters, don't replace
    withFilter(filter) {
        const mergedFilter = { ...this._query.filter, ...filter };
        const newQuery = { ...this._query, filter: mergedFilter };
        // Try JXA whose() first
        try {
            const jxaFilter = toJxaFilter(filter);
            const filtered = this._jxaRef.whose(jxaFilter);
            return new JXADelegate(filtered, this._path, undefined, undefined, this._parentDelegate, newQuery);
        }
        catch {
            // JXA whose() failed - keep original ref, apply filter in JS at resolve time
            return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
        }
    }
    withSort(sort) {
        const newQuery = { ...this._query, sort };
        return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
    }
    withPagination(pagination) {
        const newQuery = { ...this._query, pagination };
        return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
    }
    withExpand(fields) {
        // Merge with existing expand fields
        const existing = this._query.expand || [];
        const merged = [...new Set([...existing, ...fields])];
        const newQuery = { ...this._query, expand: merged };
        return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
    }
    queryState() {
        return this._query;
    }
}
// Convert WhoseFilter to JXA filter format
function toJxaFilter(filter) {
    const jxaFilter = {};
    for (const [field, pred] of Object.entries(filter)) {
        jxaFilter[field] = pred.operator.toJxa(pred.value);
    }
    return jxaFilter;
}
// Create a JXA delegate from an Application reference
function createJXADelegate(app, scheme = 'mail') {
    return new JXADelegate(app, [{ kind: 'root', scheme }], undefined, undefined, undefined);
}
// scratch/mail.ts - Mail.app Schema
//
// Uses framework.ts building blocks. No framework code here.
// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific mutation handlers
// ─────────────────────────────────────────────────────────────────────────────
// Messages move by setting the mailbox property, not using JXA move command
const messageMoveHandler = (msgDelegate, destCollectionDelegate) => {
    // destCollectionDelegate is the messages collection
    // parent() gives us the mailbox
    const destMailboxOrRoot = destCollectionDelegate.parent();
    if (isRoot(destMailboxOrRoot)) {
        return { ok: false, error: 'Cannot determine destination mailbox' };
    }
    const destMailbox = destMailboxOrRoot;
    // For JXA: message.mailbox = destMailbox._jxa()
    // For Mock: move data from one array to another
    const moveResult = msgDelegate.moveTo(destCollectionDelegate);
    if (!moveResult.ok)
        return moveResult;
    // Return new URL - construct from destination mailbox URI
    const destMailboxUri = destMailbox.uri();
    // Get the message's RFC messageId (stable across moves)
    try {
        const rfcMessageId = msgDelegate.prop('messageId')._jxa();
        const newUrl = new URL(`${destMailboxUri.href}/messages/${encodeURIComponent(rfcMessageId)}`);
        return { ok: true, value: newUrl };
    }
    catch {
        // Fall back to default move result
        return moveResult;
    }
};
// Messages delete by moving to trash, not actual delete
const messageDeleteHandler = (msgDelegate) => {
    // For now, use the default delete behavior
    // A full implementation would navigate to account's trash and move there
    return msgDelegate.delete();
};
// Extract mailbox name from JXA mailbox object (used for rule actions)
function extractMailboxName(mailbox) {
    try {
        return mailbox ? mailbox.name() : null;
    }
    catch {
        return null;
    }
}
function parseEmailAddress(raw) {
    if (!raw)
        return { name: '', address: '' };
    // Plain email address (no angle brackets)
    if (!raw.includes('<') && raw.includes('@')) {
        return { name: '', address: raw.trim() };
    }
    // Format: "Name" <email> or Name <email>
    const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
    if (match) {
        const name = (match[1] || '').trim();
        const address = (match[2] || '').trim();
        return { name, address };
    }
    return { name: '', address: raw.trim() };
}
// ─────────────────────────────────────────────────────────────────────────────
// Mail Schema - prototype composition
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// RuleCondition proto
// ─────────────────────────────────────────────────────────────────────────────
const RuleConditionProto = {
    ...baseScalar,
    header: eagerScalar,
    qualifier: eagerScalar,
    ruleType: eagerScalar,
    expression: eagerScalar,
};
// ─────────────────────────────────────────────────────────────────────────────
// Rule proto
// ─────────────────────────────────────────────────────────────────────────────
const _RuleProtoBase = {
    ...baseScalar,
    name: eagerScalar,
    enabled: withSet(t.boolean),
    allConditionsMustBeMet: withSet(t.boolean),
    deleteMessage: withSet(t.boolean),
    markRead: withSet(t.boolean),
    markFlagged: withSet(t.boolean),
    markFlagIndex: withSet(t.number),
    stopEvaluatingRules: withSet(t.boolean),
    forwardMessage: withSet(t.string),
    redirectMessage: withSet(t.string),
    replyText: withSet(t.string),
    playSound: withSet(t.string),
    highlightTextUsingColor: withSet(t.string),
    // copyMessage/moveMessage return the destination mailbox name (or null)
    copyMessage: computed(extractMailboxName),
    moveMessage: computed(extractMailboxName),
    ruleConditions: pipe(baseCollection, withByIndex(RuleConditionProto)),
};
// RuleProto with delete operation (uses default JXA delete)
const RuleProto = pipe(_RuleProtoBase, withDelete());
// ─────────────────────────────────────────────────────────────────────────────
// Signature proto
// ─────────────────────────────────────────────────────────────────────────────
const SignatureProto = {
    ...baseScalar,
    name: eagerScalar,
    content: makeLazy(baseScalar),
};
// ─────────────────────────────────────────────────────────────────────────────
// Recipient proto
// ─────────────────────────────────────────────────────────────────────────────
const RecipientProto = {
    ...baseScalar,
    name: eagerScalar,
    address: eagerScalar,
};
// ─────────────────────────────────────────────────────────────────────────────
// Attachment proto
// ─────────────────────────────────────────────────────────────────────────────
const AttachmentProto = {
    ...baseScalar,
    id: eagerScalar,
    name: eagerScalar,
    fileSize: eagerScalar,
};
const _MessageProtoBase = {
    ...baseScalar,
    id: eagerScalar,
    messageId: eagerScalar,
    subject: withSet(t.string),
    sender: computed(parseEmailAddress),
    replyTo: computed(parseEmailAddress),
    dateSent: eagerScalar,
    dateReceived: eagerScalar,
    content: makeLazy(baseScalar),
    readStatus: withSet(t.boolean),
    flaggedStatus: withSet(t.boolean),
    junkMailStatus: withSet(t.boolean),
    messageSize: eagerScalar,
    toRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
    ccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
    bccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
    attachments: withJxaName(pipe3(baseCollection, withByIndex(AttachmentProto), withByName(AttachmentProto), withById(AttachmentProto)), 'mailAttachments'),
};
// MessageProto with move and delete operations
const MessageProto = pipe2(_MessageProtoBase, withMove(_MessageProtoBase, messageMoveHandler), withDelete(messageDeleteHandler));
const LazyMessageProto = makeLazy(MessageProto);
const MailboxProto = {
    ...baseScalar,
    name: eagerScalar,
    unreadCount: eagerScalar,
    messages: pipe2(collection(), withByIndex(LazyMessageProto), withById(LazyMessageProto)),
    mailboxes: null,
};
MailboxProto.mailboxes = pipe2(collection(), withByIndex(MailboxProto), withByName(MailboxProto));
// ─────────────────────────────────────────────────────────────────────────────
// Account proto
// ─────────────────────────────────────────────────────────────────────────────
const MailAccountProto = {
    ...baseScalar,
    id: eagerScalar,
    name: eagerScalar,
    fullName: eagerScalar,
    emailAddresses: eagerScalar, // Returns string[] of account's email addresses
    mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
    // Account inbox navigates to mailboxes.byName('INBOX')
    inbox: computedNav((d) => d.prop('mailboxes').byName('INBOX'), MailboxProto),
};
// ─────────────────────────────────────────────────────────────────────────────
// Settings proto (namespace for app-level preferences)
// ─────────────────────────────────────────────────────────────────────────────
const MailSettingsProto = {
    ...baseScalar,
    // App info (read-only)
    name: eagerScalar,
    version: eagerScalar,
    frontmost: eagerScalar,
    // Behavior
    alwaysBccMyself: withSet(t.boolean),
    alwaysCcMyself: withSet(t.boolean),
    downloadHtmlAttachments: withSet(t.boolean),
    fetchInterval: withSet(t.number),
    expandGroupAddresses: withSet(t.boolean),
    // Composing
    defaultMessageFormat: withSet(t.string),
    chooseSignatureWhenComposing: withSet(t.boolean),
    quoteOriginalMessage: withSet(t.boolean),
    sameReplyFormat: withSet(t.boolean),
    includeAllOriginalMessageText: withSet(t.boolean),
    // Display
    highlightSelectedConversation: withSet(t.boolean),
    colorQuotedText: withSet(t.boolean),
    levelOneQuotingColor: withSet(t.string),
    levelTwoQuotingColor: withSet(t.string),
    levelThreeQuotingColor: withSet(t.string),
    // Fonts
    messageFont: withSet(t.string),
    messageFontSize: withSet(t.number),
    messageListFont: withSet(t.string),
    messageListFontSize: withSet(t.number),
    useFixedWidthFont: withSet(t.boolean),
    fixedWidthFont: withSet(t.string),
    fixedWidthFontSize: withSet(t.number),
    // Sounds
    newMailSound: withSet(t.string),
    shouldPlayOtherMailSounds: withSet(t.boolean),
    // Spelling
    checkSpellingWhileTyping: withSet(t.boolean),
};
// ─────────────────────────────────────────────────────────────────────────────
// Application proto
// ─────────────────────────────────────────────────────────────────────────────
const MailApplicationProto = {
    ...baseScalar,
    name: eagerScalar,
    version: eagerScalar,
    accounts: pipe3(baseCollection, withByIndex(MailAccountProto), withByName(MailAccountProto), withById(MailAccountProto)),
    rules: pipe2(baseCollection, withByIndex(RuleProto), withByName(RuleProto)),
    signatures: pipe2(baseCollection, withByIndex(SignatureProto), withByName(SignatureProto)),
    // Standard mailboxes - simple property access with jxaName mapping
    inbox: MailboxProto,
    drafts: withJxaName(MailboxProto, 'draftsMailbox'),
    junk: withJxaName(MailboxProto, 'junkMailbox'),
    outbox: MailboxProto,
    sent: withJxaName(MailboxProto, 'sentMailbox'),
    trash: withJxaName(MailboxProto, 'trashMailbox'),
    // Settings namespace - virtual grouping of app-level preferences
    settings: namespaceNav(MailSettingsProto),
};
// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
function getMailApp(delegate) {
    return createRes(delegate, MailApplicationProto);
}
// ─────────────────────────────────────────────────────────────────────────────
// Scheme Registration
// ─────────────────────────────────────────────────────────────────────────────
// Register the mail:// scheme with the framework
// This enables resolveURI('mail://...') to work
registerScheme('mail', () => createJXADelegate(Application('Mail'), 'mail'), MailApplicationProto);
/// <reference path="./types/mcp.d.ts" />
// ============================================================================
// MCP Resource Handler
// ============================================================================
function readResource(uri) {
    const resResult = resolveURI(uri);
    if (!resResult.ok) {
        // Return null to trigger JSON-RPC error response
        return null;
    }
    const res = resResult.value;
    try {
        const data = res.resolve();
        // Get the canonical URI from the delegate
        const canonicalUri = res._delegate.uri().href;
        const fixedUri = canonicalUri !== uri ? canonicalUri : undefined;
        // Add _uri to the result if it's an object
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            data._uri = fixedUri || uri;
        }
        return { mimeType: 'application/json', text: data, fixedUri };
    }
    catch (e) {
        // Return null to trigger JSON-RPC error response
        return null;
    }
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
        // Rules, Signatures, Settings
        { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
        { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' },
        { uri: 'mail://settings', name: 'Settings', description: 'Mail.app preferences' }
    ];
    const resResult = resolveURI('mail://accounts');
    if (resResult.ok) {
        try {
            const accounts = resResult.value.resolve();
            for (let i = 0; i < accounts.length; i++) {
                const acc = accounts[i];
                resources.push({
                    uri: `mail://accounts[${i}]`,
                    name: acc.name,
                    description: `Account: ${acc.fullName}`
                });
            }
        }
        catch {
            // Silently ignore if we can't resolve accounts
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
    },
    // --- Settings ---
    {
        uriTemplate: 'mail://settings',
        name: 'Settings',
        description: 'Mail.app preferences: fonts, colors, behavior, composing options'
    },
    {
        uriTemplate: 'mail://settings/{property}',
        name: 'Setting Property',
        description: 'Individual setting value (e.g., mail://settings/fetchInterval)'
    }
];
// Export for JXA
globalThis.readResource = readResource;
globalThis.listResources = listResources;
globalThis.resourceTemplates = resourceTemplates;
/// <reference path="framework.ts" />
// ============================================================================
// Set Tool - Modify scalar values
// ============================================================================
function toolSet(uri, value) {
    // Guard: Detect if URI uses name addressing for the item being modified
    // If so, and we're setting 'name', this would break the reference
    const segments = uri.split('/');
    const lastSegment = segments[segments.length - 1];
    // Check if parent uses name addressing and we're setting 'name'
    if (lastSegment === 'name') {
        const parentLastSegment = segments[segments.length - 2];
        if (parentLastSegment && !parentLastSegment.match(/\[\d+\]$/) && !parentLastSegment.includes('://')) {
            return {
                ok: false,
                error: `Cannot set 'name' when the object is addressed by name. Use index addressing (e.g., [0]) instead.`
            };
        }
    }
    const resResult = resolveURI(uri);
    if (!resResult.ok) {
        return { ok: false, error: resResult.error };
    }
    const res = resResult.value;
    // Check if the proto has a set method (added by withSet)
    if (typeof res.set !== 'function') {
        return { ok: false, error: `Property at ${uri} is not mutable` };
    }
    try {
        res.set(value);
        return { ok: true, value: { uri, updated: true } };
    }
    catch (e) {
        return { ok: false, error: `Set failed: ${e.message || e}` };
    }
}
// ============================================================================
// Make Tool - Create new objects in collections
// ============================================================================
function toolMake(collectionUri, properties) {
    const resResult = resolveURI(collectionUri);
    if (!resResult.ok) {
        return { ok: false, error: resResult.error };
    }
    const res = resResult.value;
    // Check if proto has create method (from withCreate) or use delegate
    if (typeof res.create === 'function') {
        const result = res.create(properties);
        if (!result.ok) {
            return { ok: false, error: result.error };
        }
        return { ok: true, value: { uri: result.value._delegate.uri().href } };
    }
    // Fall back to delegate create
    const createResult = res._delegate.create(properties);
    if (!createResult.ok) {
        return { ok: false, error: createResult.error };
    }
    return { ok: true, value: { uri: createResult.value.href } };
}
// ============================================================================
// Move Tool - Move objects between collections
// ============================================================================
function toolMove(itemUri, destinationCollectionUri) {
    // Guard: Cannot move mailboxes
    if (itemUri.match(/\/mailboxes\/[^/]+$/) || itemUri.match(/\/mailboxes\[\d+\]$/)) {
        if (!itemUri.includes('/messages')) {
            return { ok: false, error: `Cannot move mailboxes. Use Mail.app directly to manage mailboxes.` };
        }
    }
    // Get source item
    const itemResult = resolveURI(itemUri);
    if (!itemResult.ok) {
        return { ok: false, error: itemResult.error };
    }
    // Get destination collection
    const destResult = resolveURI(destinationCollectionUri);
    if (!destResult.ok) {
        return { ok: false, error: destResult.error };
    }
    const item = itemResult.value;
    const dest = destResult.value;
    // Check if item has move method (from withMove)
    if (typeof item.move === 'function') {
        const moveResult = item.move(dest);
        if (!moveResult.ok) {
            return { ok: false, error: moveResult.error };
        }
        return { ok: true, value: { uri: moveResult.value._delegate.uri().href } };
    }
    // Fall back to delegate moveTo
    const moveResult = item._delegate.moveTo(dest._delegate);
    if (!moveResult.ok) {
        return { ok: false, error: moveResult.error };
    }
    return { ok: true, value: { uri: moveResult.value.href } };
}
// ============================================================================
// Delete Tool - Delete objects with mailbox guard
// ============================================================================
function toolDelete(itemUri) {
    // Guard: Cannot delete mailboxes
    if (itemUri.match(/\/mailboxes\/[^/]+$/) || itemUri.match(/\/mailboxes\[\d+\]$/)) {
        if (!itemUri.includes('/messages')) {
            return { ok: false, error: `Cannot delete mailboxes. Use Mail.app directly to manage mailboxes.` };
        }
    }
    const itemResult = resolveURI(itemUri);
    if (!itemResult.ok) {
        return { ok: false, error: itemResult.error };
    }
    const item = itemResult.value;
    // Check if item has delete method (from withDelete)
    if (typeof item.delete === 'function') {
        const deleteResult = item.delete();
        if (!deleteResult.ok) {
            return { ok: false, error: deleteResult.error };
        }
        return { ok: true, value: { deleted: true, uri: itemUri } };
    }
    // Fall back to delegate delete
    const deleteResult = item._delegate.delete();
    if (!deleteResult.ok) {
        return { ok: false, error: deleteResult.error };
    }
    return { ok: true, value: { deleted: true, uri: itemUri } };
}
// ============================================================================
// Tool Registration Helper
// ============================================================================
function registerMailTools(server) {
    server.addTool({
        name: 'set',
        description: 'Set a scalar property value. Use URI to specify the property (e.g., mail://rules[0]/enabled).',
        inputSchema: {
            type: 'object',
            properties: {
                uri: { type: 'string', description: 'URI of the property to set' },
                value: { description: 'New value for the property' }
            },
            required: ['uri', 'value']
        },
        handler: (args) => {
            const result = toolSet(args.uri, args.value);
            if (!result.ok)
                return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
            return { content: [{ type: 'text', text: JSON.stringify(result.value) }] };
        }
    });
    server.addTool({
        name: 'make',
        description: 'Create a new object in a collection (e.g., new rule, signature).',
        inputSchema: {
            type: 'object',
            properties: {
                collection: { type: 'string', description: 'URI of the collection (e.g., mail://rules)' },
                properties: { type: 'object', description: 'Properties for the new object' }
            },
            required: ['collection', 'properties']
        },
        handler: (args) => {
            const result = toolMake(args.collection, args.properties);
            if (!result.ok)
                return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
            return { content: [{ type: 'text', text: JSON.stringify(result.value) }] };
        }
    });
    server.addTool({
        name: 'move',
        description: 'Move an object to a different collection (e.g., move message to another mailbox).',
        inputSchema: {
            type: 'object',
            properties: {
                item: { type: 'string', description: 'URI of the item to move' },
                destination: { type: 'string', description: 'URI of the destination collection' }
            },
            required: ['item', 'destination']
        },
        handler: (args) => {
            const result = toolMove(args.item, args.destination);
            if (!result.ok)
                return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
            return { content: [{ type: 'text', text: JSON.stringify(result.value) }] };
        }
    });
    server.addTool({
        name: 'delete',
        description: 'Delete an object. Messages are moved to trash. Mailbox deletion is blocked.',
        inputSchema: {
            type: 'object',
            properties: {
                item: { type: 'string', description: 'URI of the item to delete' }
            },
            required: ['item']
        },
        handler: (args) => {
            const result = toolDelete(args.item);
            if (!result.ok)
                return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
            return { content: [{ type: 'text', text: JSON.stringify(result.value) }] };
        }
    });
}
// Export for use in main.ts
globalThis.registerMailTools = registerMailTools;
/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="framework.ts" />
/// <reference path="jxa-delegate.ts" />
/// <reference path="mail.ts" />
/// <reference path="resources.ts" />
/// <reference path="tools.ts" />
// ============================================================================
// Apple Mail MCP Server - Entry Point
// ============================================================================
const server = new MCPServer("apple-mail-jxa", "1.0.0");
// Register resource handlers
server.setResources(listResources, readResource);
server.setResourceTemplates(resourceTemplates);
// Register tools
registerMailTools(server);
// Start the server (unless loaded as a library)
if (!globalThis.__LIBRARY_MODE__) {
    server.run();
}
