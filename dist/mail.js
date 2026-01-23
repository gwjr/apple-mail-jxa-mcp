"use strict";
// URL polyfill for JXA
// JXA doesn't have the native URL constructor, so we provide a minimal implementation
// Only define if URL doesn't exist (avoids overriding in Node test environment)
if (typeof globalThis.URL === 'undefined') {
    globalThis.URL = class URL {
        href;
        protocol;
        pathname;
        search;
        hash;
        host;
        hostname;
        port;
        origin;
        constructor(url, base) {
            let fullUrl = url;
            if (base) {
                const baseStr = typeof base === 'string' ? base : base.href;
                // Simple base resolution - just prepend base if url is relative
                if (!url.includes('://')) {
                    fullUrl = baseStr.replace(/\/[^/]*$/, '/') + url;
                }
            }
            this.href = fullUrl;
            // Parse the URL
            const schemeMatch = fullUrl.match(/^([a-z][a-z0-9+.-]*):\/\//i);
            if (!schemeMatch) {
                throw new TypeError(`Invalid URL: ${url}`);
            }
            this.protocol = schemeMatch[1] + ':';
            const afterScheme = fullUrl.slice(schemeMatch[0].length);
            // Split off hash
            const hashIdx = afterScheme.indexOf('#');
            const beforeHash = hashIdx >= 0 ? afterScheme.slice(0, hashIdx) : afterScheme;
            this.hash = hashIdx >= 0 ? afterScheme.slice(hashIdx) : '';
            // Split off search/query
            const searchIdx = beforeHash.indexOf('?');
            const beforeSearch = searchIdx >= 0 ? beforeHash.slice(0, searchIdx) : beforeHash;
            this.search = searchIdx >= 0 ? beforeHash.slice(searchIdx) : '';
            // For mail:// URLs, there's no host - everything is pathname
            // For http:// URLs, we'd parse host differently
            if (this.protocol === 'mail:') {
                this.host = '';
                this.hostname = '';
                this.port = '';
                this.origin = 'null';
                this.pathname = beforeSearch || '/';
            }
            else {
                // Basic parsing for other schemes - extract host from path
                const slashIdx = beforeSearch.indexOf('/');
                if (slashIdx >= 0) {
                    this.host = beforeSearch.slice(0, slashIdx);
                    this.pathname = beforeSearch.slice(slashIdx);
                }
                else {
                    this.host = beforeSearch;
                    this.pathname = '/';
                }
                // Parse hostname and port from host
                const colonIdx = this.host.lastIndexOf(':');
                if (colonIdx >= 0 && !this.host.includes(']')) {
                    this.hostname = this.host.slice(0, colonIdx);
                    this.port = this.host.slice(colonIdx + 1);
                }
                else {
                    this.hostname = this.host;
                    this.port = '';
                }
                this.origin = `${this.protocol}//${this.host}`;
            }
        }
        toString() {
            return this.href;
        }
        toJSON() {
            return this.href;
        }
    };
}
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
        const uriString = params.uri;
        this.log(`Resource read: ${uriString}`);
        if (!this.resourceReader) {
            this.sendError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, "Resources not supported");
            return;
        }
        // Parse URI string to URL early for type safety
        let uri;
        try {
            uri = new URL(uriString);
        }
        catch (e) {
            this.sendError(id, JsonRpcErrorCodes.INVALID_PARAMS, `Invalid URI: ${uriString}`);
            return;
        }
        try {
            const readResult = this.resourceReader(uri);
            // Handle Result<T> type from readResource
            if (!readResult.ok) {
                this.sendError(id, JsonRpcErrorCodes.RESOURCE_NOT_FOUND, readResult.error);
                return;
            }
            const textContent = typeof readResult.text === 'string'
                ? readResult.text
                : JSON.stringify(readResult.text);
            const response = {
                contents: [{
                        uri: uriString,
                        mimeType: readResult.mimeType || 'application/json',
                        text: textContent
                    }]
            };
            this.sendResult(id, response);
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
// src/framework/delegate.ts - Delegate Interface
//
// The abstraction layer between schema and backing store (JXA/Mock).
// ─────────────────────────────────────────────────────────────────────────────
// Root Marker (for parent navigation)
// ─────────────────────────────────────────────────────────────────────────────
// Explicit unique symbol type - used directly in type literal (no typeof needed)
const RootBrand = Symbol('RootBrand');
const ROOT = { [RootBrand]: true };
function isRoot(d) {
    return RootBrand in d;
}
// src/framework/filter-query.ts - Query & Filter System
//
// Filtering, sorting, pagination for collections.
// ─────────────────────────────────────────────────────────────────────────────
// Filter Operators
// ─────────────────────────────────────────────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────
// Predicate Factories
// ─────────────────────────────────────────────────────────────────────────────
const equals = (value) => ({ operator: equalsOp, value });
const contains = (value) => ({ operator: containsOp, value });
const startsWith = (value) => ({ operator: startsWithOp, value });
const gt = (value) => ({ operator: gtOp, value });
const lt = (value) => ({ operator: ltOp, value });
// ─────────────────────────────────────────────────────────────────────────────
// Query State Application
// ─────────────────────────────────────────────────────────────────────────────
// Helper to get a property value, handling JXA specifiers (functions)
function getPropValue(item, field) {
    if (item && typeof item === 'object' && field in item) {
        const val = item[field];
        return typeof val === 'function' ? val() : val;
    }
    // JXA specifier: property access returns a function to call
    if (typeof item === 'function' && typeof item[field] === 'function') {
        return item[field]();
    }
    return undefined;
}
function applyQueryState(items, query) {
    let results = items;
    if (query.filter && Object.keys(query.filter).length > 0) {
        results = results.filter((item) => {
            for (const [field, pred] of Object.entries(query.filter)) {
                const val = getPropValue(item, field);
                if (!pred.operator.test(val, pred.value)) {
                    return false;
                }
            }
            return true;
        });
    }
    if (query.sort) {
        const { by, direction = 'asc' } = query.sort;
        results = [...results].sort((a, b) => {
            const aVal = getPropValue(a, by);
            const bVal = getPropValue(b, by);
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
// src/framework/schematic.ts - Schema DSL & Type Composition
//
// The core typing system for schema definitions. Types and proto implementations
// live together - the DSL specifies the schema by building the proto.
// ─────────────────────────────────────────────────────────────────────────────
// Strategy Constants
// ─────────────────────────────────────────────────────────────────────────────
// Base keys to skip during object property enumeration
const BASE_KEYS = new Set(['resolve', 'exists', 'uri', '_delegate', 'resolutionStrategy', 'resolveFromParent', 'navigationStrategy']);
function isBaseKey(key) {
    return BASE_KEYS.has(key);
}
// Scalar strategy: just call _jxa() and return the raw value
const scalarStrategy = (delegate) => delegate._jxa();
// Object strategy: gather properties recursively
const objectStrategy = (_delegate, proto, res) => {
    const result = {};
    // Get the target proto for property lookup (handles namespace case)
    const targetProto = proto._namespaceTarget || proto;
    for (const key of Object.keys(targetProto)) {
        if (isBaseKey(key))
            continue;
        const childProto = targetProto[key];
        if (childProto && typeof childProto === 'object' && 'resolutionStrategy' in childProto) {
            try {
                // Access the child through the Res proxy to get proper navigation
                const childRes = res[key];
                if (childRes && typeof childRes === 'object' && '_delegate' in childRes) {
                    // Use resolveFromParent if defined, otherwise fall back to resolutionStrategy
                    const resolveFromParent = childProto.resolveFromParent || childProto.resolutionStrategy;
                    const childValue = resolveFromParent(childRes._delegate, childProto, childRes);
                    if (childValue !== undefined) {
                        result[key] = childValue;
                    }
                }
            }
            catch {
                // Skip properties that fail to resolve
            }
        }
    }
    return result;
};
// Collection strategy: return array of URIs for each item
const collectionStrategy = (delegate) => {
    const raw = delegate._jxa();
    if (!Array.isArray(raw)) {
        throw new TypeError(`Collection expected array, got ${typeof raw}`);
    }
    return raw.map((_item, i) => {
        const itemDelegate = delegate.byIndex(i);
        return { uri: itemDelegate.uri() };
    });
};
// Lazy resolution strategy: return Specifier instead of resolving eagerly
const LazyResolutionFromParentStrategy = (delegate, proto) => {
    return createSpecifier(delegate, proto);
};
// Default navigation: navigate by property name
const defaultNavigation = (delegate, key) => delegate.prop(key);
// Namespace navigation: add URI segment but don't navigate JXA
const namespaceNavigation = (delegate, key) => delegate.namespace(key);
// ─────────────────────────────────────────────────────────────────────────────
// Common exists() implementation
// ─────────────────────────────────────────────────────────────────────────────
function existsImpl() {
    try {
        const result = this._delegate._jxa();
        return result !== undefined && result !== null;
    }
    catch {
        return false;
    }
}
// Primitive validators
const isString = (v) => {
    if (typeof v !== 'string')
        throw new TypeError(`Expected string, got ${typeof v}`);
    return v;
};
const isNumber = (v) => {
    if (typeof v !== 'number')
        throw new TypeError(`Expected number, got ${typeof v}`);
    return v;
};
const isBoolean = (v) => {
    if (typeof v !== 'boolean')
        throw new TypeError(`Expected boolean, got ${typeof v}`);
    return v;
};
const isDate = (v) => {
    if (v instanceof Date)
        return v;
    // Also accept ISO date strings
    if (typeof v === 'string') {
        const d = new Date(v);
        if (!isNaN(d.getTime()))
            return d;
    }
    throw new TypeError(`Expected Date, got ${typeof v}`);
};
// Passthrough validator - no validation, explicit unknown type
const isAny = (v) => v;
// Array validators
const isStringArray = (v) => {
    if (!Array.isArray(v))
        throw new TypeError(`Expected array, got ${typeof v}`);
    return v.map(isString);
};
// Optional wrapper - allows null/undefined
function optional(validator) {
    return (v) => {
        if (v === null || v === undefined)
            return null;
        return validator(v);
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Scalar Factories
// ─────────────────────────────────────────────────────────────────────────────
// Typed scalar factory with runtime validation
function scalar(validate) {
    const validatingStrategy = (delegate) => {
        const raw = delegate._jxa();
        return validate(raw);
    };
    return {
        resolutionStrategy: validatingStrategy,
        exists: existsImpl,
        resolve() {
            return validatingStrategy(this._delegate, null, null);
        },
    }; // Type assertion adds Proto brand
}
// Passthrough scalar - no validation, for untyped content
const passthrough = {
    resolutionStrategy: scalarStrategy,
    exists: existsImpl,
    resolve() {
        return this._delegate._jxa();
    },
};
// Primitive type scalars with runtime validation
const t = {
    string: scalar(isString),
    number: scalar(isNumber),
    boolean: scalar(isBoolean),
    date: scalar(isDate),
    stringArray: scalar(isStringArray),
    any: passthrough,
};
// Base object for complex types that need property gathering
const baseObject = {
    resolutionStrategy: objectStrategy,
    exists: existsImpl,
    resolve() {
        return objectStrategy(this._delegate, baseObject, this);
    },
};
// ─────────────────────────────────────────────────────────────────────────────
// Collection Item Proto Tracking
// ─────────────────────────────────────────────────────────────────────────────
const collectionItemProtos = new WeakMap();
function getItemProto(collectionProto) {
    return collectionItemProtos.get(collectionProto);
}
// ─────────────────────────────────────────────────────────────────────────────
// Lazy Composer
// ─────────────────────────────────────────────────────────────────────────────
// lazy: marks a property as "lazy" - when resolved as part of a parent object,
// returns a specifier (URL) instead of the actual value. Direct resolution returns the value.
function lazy(proto) {
    const lazyProto = {
        ...proto,
        resolveFromParent: LazyResolutionFromParentStrategy,
    };
    // Copy over collection item proto if this is a collection
    const itemProto = collectionItemProtos.get(proto);
    if (itemProto) {
        collectionItemProtos.set(lazyProto, itemProto);
    }
    return lazyProto;
}
// ─────────────────────────────────────────────────────────────────────────────
// Collection Factory
// ─────────────────────────────────────────────────────────────────────────────
// Accessor kinds that a collection can support
var Accessor;
(function (Accessor) {
    Accessor[Accessor["Index"] = 0] = "Index";
    Accessor[Accessor["Name"] = 1] = "Name";
    Accessor[Accessor["Id"] = 2] = "Id";
})(Accessor || (Accessor = {}));
// Collection factory - accessors determined by the 'by' tuple
function collection(itemProto, by) {
    const proto = {
        resolutionStrategy: collectionStrategy,
        exists: existsImpl,
        // resolve() returns URIs for each item
        resolve() {
            return collectionStrategy(this._delegate, proto, this);
        },
    };
    if (by.includes(Accessor.Index)) {
        proto.byIndex = function (n) {
            return createSpecifier(this._delegate.byIndex(n), itemProto);
        };
    }
    if (by.includes(Accessor.Name)) {
        proto.byName = function (name) {
            return createSpecifier(this._delegate.byName(name), itemProto);
        };
    }
    if (by.includes(Accessor.Id)) {
        proto.byId = function (id) {
            return createSpecifier(this._delegate.byId(id), itemProto);
        };
    }
    collectionItemProtos.set(proto, itemProto);
    return proto;
}
// withSet works on scalar protos - adds a set() method for the scalar's value type
function withSet(proto) {
    return {
        ...proto,
        set(value) {
            this._delegate.set(value);
        },
    };
}
// Composer: adds move() with optional custom handler
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
    const computedStrategy = (delegate) => {
        const raw = delegate._jxa();
        return transform(raw);
    };
    return {
        resolutionStrategy: computedStrategy,
        exists: existsImpl,
        resolve() {
            const raw = this._delegate._jxa();
            return transform(raw);
        },
    }; // Type assertion adds Proto brand
}
function computedNav(navigate, targetProto) {
    // Create a strategy that navigates first, then uses target's strategy
    const navStrategy = (delegate, proto, res) => {
        const targetDelegate = navigate(delegate);
        return targetProto.resolutionStrategy(targetDelegate, targetProto, res);
    };
    // Create a navigation strategy that applies the custom navigation
    const navNavigation = (delegate) => navigate(delegate);
    const navProto = {
        ...targetProto,
        resolutionStrategy: navStrategy,
        navigationStrategy: navNavigation,
        _computedNav: { navigate, targetProto }, // Store for URI resolution
        resolve() {
            const targetDelegate = navigate(this._delegate);
            return targetProto.resolutionStrategy(targetDelegate, targetProto, this);
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
    };
    // Copy collection item proto if target is a collection
    const itemProto = collectionItemProtos.get(targetProto);
    if (itemProto) {
        collectionItemProtos.set(navProto, itemProto);
    }
    return navProto;
}
function getComputedNav(proto) {
    return proto._computedNav;
}
function namespaceNav(targetProto) {
    // Custom strategy that gathers all properties from the target proto
    const namespaceStrategy = (delegate, proto, res) => {
        const result = {};
        // Get all property names from the target proto (excluding base methods)
        for (const key of Object.keys(targetProto)) {
            if (isBaseKey(key))
                continue;
            try {
                // Navigate to the property and resolve it
                const propRes = res[key];
                if (propRes && typeof propRes.resolve === 'function') {
                    result[key] = propRes.resolve();
                }
            }
            catch {
                // Skip properties that fail to resolve
            }
        }
        return result;
    };
    const navProto = {
        resolutionStrategy: namespaceStrategy,
        navigationStrategy: namespaceNavigation,
        _namespaceTarget: targetProto, // Store for property lookup
        resolve() {
            return namespaceStrategy(this._delegate, navProto, this);
        },
        exists() {
            return true; // Namespaces always exist
        },
    };
    return navProto;
}
function getNamespaceNav(proto) {
    return proto._namespaceTarget;
}
function withQuery(proto) {
    const itemProto = collectionItemProtos.get(proto);
    const queryStrategy = (delegate) => {
        const raw = delegate._jxa();
        if (!Array.isArray(raw)) {
            throw new TypeError(`Query expected array, got ${typeof raw}`);
        }
        const query = delegate.queryState();
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
    };
    const queryProto = {
        ...proto,
        resolutionStrategy: queryStrategy,
        resolve() {
            return queryStrategy(this._delegate, queryProto, this);
        },
        whose(filter) {
            const newDelegate = this._delegate.withFilter(filter);
            return createSpecifier(newDelegate, withQuery(proto));
        },
        sortBy(spec) {
            const newDelegate = this._delegate.withSort(spec);
            return createSpecifier(newDelegate, withQuery(proto));
        },
        paginate(spec) {
            const newDelegate = this._delegate.withPagination(spec);
            return createSpecifier(newDelegate, withQuery(proto));
        },
        expand(fields) {
            const newDelegate = this._delegate.withExpand(fields);
            return createSpecifier(newDelegate, withQuery(proto));
        },
    };
    // Copy collection item proto
    if (itemProto) {
        collectionItemProtos.set(queryProto, itemProto);
    }
    return queryProto;
}
// src/framework/specifier.ts - Specifier Type & Proxy
//
// The proxy wrapper that makes protos usable. Specifier is the unified type
// for all navigable references - both lazy references from collection accessors
// and fully-resolved proxy objects.
// ─────────────────────────────────────────────────────────────────────────────
// Specifier Factory
// ─────────────────────────────────────────────────────────────────────────────
function createSpecifier(delegate, proto) {
    // For namespace protos, get the target proto for property lookup
    const targetProto = getNamespaceNav(proto) || proto;
    const handler = {
        get(t, prop, receiver) {
            if (prop === '_delegate')
                return t._delegate;
            if (prop === 'uri')
                return t._delegate.uri();
            // Intercept toJSON for MCP serialization
            if (prop === 'toJSON') {
                return () => ({ uri: t._delegate.uri().href });
            }
            // Intercept resolve to use the proto's resolutionStrategy
            if (prop === 'resolve') {
                return () => {
                    if ('resolutionStrategy' in proto && typeof proto.resolutionStrategy === 'function') {
                        return proto.resolutionStrategy(t._delegate, proto, receiver);
                    }
                    // Fallback to proto's resolve method
                    const resolveMethod = proto.resolve;
                    if (typeof resolveMethod === 'function') {
                        return resolveMethod.call(receiver);
                    }
                    throw new Error('Proto has no resolutionStrategy or resolve method');
                };
            }
            // First check the main proto for methods (exists, etc.)
            if (prop in proto) {
                const value = proto[prop];
                if (typeof value === 'function') {
                    return value.bind(receiver);
                }
            }
            // Then check targetProto for properties (works for both namespaces and regular protos)
            if (prop in targetProto) {
                const value = targetProto[prop];
                if (typeof value === 'function') {
                    return value.bind(receiver);
                }
                if (typeof value === 'object' && value !== null) {
                    // Check for namespace navigation - use navigationStrategy
                    const innerNamespaceProto = getNamespaceNav(value);
                    if (innerNamespaceProto) {
                        return createSpecifier(t._delegate.namespace(prop), value);
                    }
                    // Check for computed navigation - use _computedNav data
                    const navInfo = getComputedNav(value);
                    if (navInfo) {
                        const targetDelegate = navInfo.navigate(t._delegate);
                        return createSpecifier(targetDelegate, value);
                    }
                    // Normal property navigation - use jxaName if defined, otherwise use the property name
                    const jxaName = getJxaName(value);
                    const schemaName = prop;
                    if (jxaName) {
                        // Navigate with JXA name but track schema name for URI
                        return createSpecifier(t._delegate.propWithAlias(jxaName, schemaName), value);
                    }
                    else {
                        return createSpecifier(t._delegate.prop(schemaName), value);
                    }
                }
                return value;
            }
            return undefined;
        },
        has(t, prop) {
            if (prop === '_delegate' || prop === 'uri' || prop === 'toJSON')
                return true;
            return prop in proto || prop in targetProto;
        },
        ownKeys(t) {
            // Combine keys from proto and targetProto, plus _delegate, uri, and toJSON
            const keys = new Set(['_delegate', 'uri', 'toJSON']);
            for (const key of Object.keys(proto))
                keys.add(key);
            for (const key of Object.keys(targetProto))
                keys.add(key);
            return [...keys];
        },
        getOwnPropertyDescriptor(t, prop) {
            // Make properties enumerable for Object.keys() to work
            if (prop === '_delegate' || prop === 'uri' || prop === 'toJSON' || prop in proto || prop in targetProto) {
                return { enumerable: true, configurable: true };
            }
            return undefined;
        }
    };
    return new Proxy({ _delegate: delegate }, handler);
}
// src/framework/uri.ts - URI Parsing & Resolution
//
// URI scheme handling and navigation.
// ─────────────────────────────────────────────────────────────────────────────
// URI Building
// ─────────────────────────────────────────────────────────────────────────────
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
                uri += `%5B${seg.value}%5D`; // URL-encoded [ and ]
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
// Proto Guards (for runtime schema navigation during URI resolution)
// ─────────────────────────────────────────────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────
// URI Lexer
// ─────────────────────────────────────────────────────────────────────────────
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
        // Check for literal or encoded brackets/query
        let headEnd = remaining.length;
        for (let i = 0; i < remaining.length; i++) {
            const ch = remaining[i];
            if (ch === '/' || ch === '[' || ch === '?') {
                headEnd = i;
                break;
            }
            // Check for URL-encoded [ (%5B or %5b)
            if (ch === '%' && i + 2 < remaining.length) {
                const encoded = remaining.slice(i, i + 3).toUpperCase();
                if (encoded === '%5B' || encoded === '%3F') {
                    headEnd = i;
                    break;
                }
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
        // Check for literal [ or URL-encoded %5B
        if (remaining.startsWith('[') || remaining.toUpperCase().startsWith('%5B')) {
            const isEncoded = remaining.toUpperCase().startsWith('%5B');
            const openLen = isEncoded ? 3 : 1; // '%5B' vs '['
            const closeChar = isEncoded ? '%5D' : ']';
            const closeIdx = remaining.toUpperCase().indexOf(isEncoded ? '%5D' : ']');
            const closeLen = isEncoded ? 3 : 1;
            if (closeIdx !== -1) {
                const indexStr = remaining.slice(openLen, closeIdx);
                if (isInteger(indexStr)) {
                    segment.qualifier = { kind: 'index', value: parseInt(indexStr, 10) };
                    remaining = remaining.slice(closeIdx + closeLen);
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
// URI Resolution Helpers
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
// ─────────────────────────────────────────────────────────────────────────────
// URI Resolution
// ─────────────────────────────────────────────────────────────────────────────
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
        // For namespace protos, look up properties in the target proto
        const lookupProto = getNamespaceNav(proto) || proto;
        const childProto = lookupProto[head];
        // Check for namespaceNav first (virtual grouping, no JXA navigation)
        const namespaceTargetProto = childProto ? getNamespaceNav(childProto) : undefined;
        if (namespaceTargetProto) {
            delegate = delegate.namespace(head);
            // Keep the navProto (childProto) which has the custom resolve, not the inner targetProto
            proto = childProto;
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
            const available = Object.keys(lookupProto).filter(k => {
                const v = lookupProto[k];
                return isChildProto(v);
            });
            return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
        }
    }
    return { ok: true, value: createSpecifier(delegate, proto) };
}
// src/framework/legacy.ts - Backwards Compatibility Shims
//
// Legacy items kept for URI resolution fallback and type aliases.
// ─────────────────────────────────────────────────────────────────────────────
// Legacy Scalar Alias
// ─────────────────────────────────────────────────────────────────────────────
// Base scalar for fallback in URI resolution (alias for passthrough)
const baseScalar = passthrough;
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
        // Try JXA whose() first
        try {
            const jxaFilter = toJxaFilter(filter);
            const filtered = this._jxaRef.whose(jxaFilter);
            // JXA whose() succeeded - don't store filter in queryState (already applied)
            // Keep other query state (sort, pagination, expand) but clear filter
            const newQuery = { ...this._query, filter: undefined };
            return new JXADelegate(filtered, this._path, undefined, undefined, this._parentDelegate, newQuery);
        }
        catch {
            // JXA whose() failed - keep original ref, apply filter in JS at resolve time
            const newQuery = { ...this._query, filter: mergedFilter };
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
    // Create a delegate from arbitrary JXA ref with explicit path
    fromJxa(jxaRef, path) {
        return new JXADelegate(jxaRef, path, undefined, undefined, this);
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
// Export to globalThis for JXA environment detection
globalThis.createJXADelegate = createJXADelegate;
// src/mail.ts - Mail.app Schema
//
// Uses framework/ building blocks. No framework code here.
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
    ...baseObject,
    header: t.string,
    qualifier: t.string,
    ruleType: t.string,
    expression: t.string,
};
// ─────────────────────────────────────────────────────────────────────────────
// Rule proto
// ─────────────────────────────────────────────────────────────────────────────
const RuleProto = withDelete()({
    ...baseObject,
    name: t.string,
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
    ruleConditions: collection(RuleConditionProto, [Accessor.Index]),
});
// ─────────────────────────────────────────────────────────────────────────────
// Signature proto
// ─────────────────────────────────────────────────────────────────────────────
const SignatureProto = {
    ...baseObject,
    name: t.string,
    content: lazy(t.string),
};
// ─────────────────────────────────────────────────────────────────────────────
// Recipient proto
// ─────────────────────────────────────────────────────────────────────────────
const RecipientProto = {
    ...baseObject,
    name: t.string,
    address: t.string,
};
// ─────────────────────────────────────────────────────────────────────────────
// Attachment proto
// ─────────────────────────────────────────────────────────────────────────────
const AttachmentProto = {
    ...baseObject,
    id: t.string,
    name: t.string,
    fileSize: t.number,
};
// ─────────────────────────────────────────────────────────────────────────────
// Message proto
// ─────────────────────────────────────────────────────────────────────────────
const _MessageProtoBase = {
    ...baseObject,
    id: t.number,
    messageId: t.string,
    subject: withSet(t.string),
    sender: computed(parseEmailAddress),
    replyTo: computed(parseEmailAddress),
    dateSent: t.date,
    dateReceived: t.date,
    content: lazy(t.string),
    readStatus: withSet(t.boolean),
    flaggedStatus: withSet(t.boolean),
    junkMailStatus: withSet(t.boolean),
    messageSize: t.number,
    toRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
    ccRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
    bccRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
    attachments: withJxaName(collection(AttachmentProto, [Accessor.Index, Accessor.Name, Accessor.Id]), 'mailAttachments'),
};
// MessageProto with move and delete operations
const MessageProto = withDelete(messageDeleteHandler)(withMove(_MessageProtoBase, messageMoveHandler)(_MessageProtoBase));
// ─────────────────────────────────────────────────────────────────────────────
// Mailbox proto (recursive - interface required for self-reference)
// ─────────────────────────────────────────────────────────────────────────────
// Messages collection proto (used in MailboxProto and for type reference)
const MessagesProto = collection(MessageProto, [Accessor.Index, Accessor.Id]);
// Mailbox is self-referential (contains mailboxes), so needs forward declaration
// We define the collection proto separately to allow the self-reference
const MailboxesProto = collection(null, [Accessor.Index, Accessor.Name]);
const MailboxProto = {
    ...baseObject,
    name: t.string,
    unreadCount: t.number,
    messages: lazy(MessagesProto),
    mailboxes: lazy(MailboxesProto),
};
// Now fix up the self-reference in MailboxesProto
collectionItemProtos.set(MailboxesProto, MailboxProto);
// ─────────────────────────────────────────────────────────────────────────────
// Account proto
// ─────────────────────────────────────────────────────────────────────────────
const MailAccountProto = {
    ...baseObject,
    id: t.string,
    name: t.string,
    fullName: t.string,
    emailAddresses: t.stringArray,
    mailboxes: collection(MailboxProto, [Accessor.Index, Accessor.Name]),
    // Account inbox: find this account's mailbox in Mail.inbox.mailboxes()
    // (Can't use simple byName because inbox name varies: "INBOX", "Inbox", etc.)
    inbox: computedNav((d) => {
        if (!d.fromJxa) {
            // Mock delegate: fall back to mailboxes.byName('INBOX')
            return d.prop('mailboxes').byName('INBOX');
        }
        // JXA: Find inbox mailbox by matching account ID
        const jxaAccount = d._jxa();
        const accountId = jxaAccount.id();
        const Mail = Application('Mail');
        const inboxMailboxes = Mail.inbox.mailboxes();
        const accountInbox = inboxMailboxes.find((mb) => mb.account.id() === accountId);
        if (!accountInbox) {
            throw new Error(`No inbox found for account ${accountId}`);
        }
        // Build path by parsing current URI and adding /inbox
        // URI is like "mail://accounts%5B0%5D" -> path segments for "accounts[0]/inbox"
        const currentUri = d.uri().href;
        const afterScheme = currentUri.replace('mail://', '');
        const decodedPath = decodeURIComponent(afterScheme);
        // Parse into segments: e.g., "accounts[0]" -> [{root}, {prop: accounts}, {index: 0}]
        const pathSegments = parsePathToSegments('mail', decodedPath);
        pathSegments.push({ kind: 'prop', name: 'inbox' });
        return d.fromJxa(accountInbox, pathSegments);
    }, MailboxProto),
};
// Helper to parse a path string into PathSegment array
function parsePathToSegments(scheme, path) {
    const segments = [{ kind: 'root', scheme }];
    const parts = path.split('/').filter(p => p);
    for (const part of parts) {
        const indexMatch = part.match(/^(.+)\[(\d+)\]$/);
        if (indexMatch) {
            segments.push({ kind: 'prop', name: indexMatch[1] });
            segments.push({ kind: 'index', value: parseInt(indexMatch[2], 10) });
        }
        else {
            segments.push({ kind: 'prop', name: part });
        }
    }
    return segments;
}
// ─────────────────────────────────────────────────────────────────────────────
// Settings proto (namespace for app-level preferences)
// ─────────────────────────────────────────────────────────────────────────────
const MailSettingsProto = {
    ...passthrough,
    // App info (read-only)
    name: t.string,
    version: t.string,
    frontmost: t.boolean,
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
    ...passthrough,
    name: t.string,
    version: t.string,
    accounts: collection(MailAccountProto, [Accessor.Index, Accessor.Name, Accessor.Id]),
    rules: collection(RuleProto, [Accessor.Index, Accessor.Name]),
    signatures: collection(SignatureProto, [Accessor.Index, Accessor.Name]),
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
    return createSpecifier(delegate, MailApplicationProto);
}
// ─────────────────────────────────────────────────────────────────────────────
// Scheme Registration
// ─────────────────────────────────────────────────────────────────────────────
// Register the mail:// scheme with the framework
// This enables resolveURI('mail://...') to work
// Only register in JXA environment (Application and createJXADelegate are JXA-only)
// Use globalThis to check without TypeScript complaining
const _globalThis = globalThis;
if (typeof _globalThis.Application !== 'undefined' && typeof _globalThis.createJXADelegate !== 'undefined') {
    registerScheme('mail', () => _globalThis.createJXADelegate(_globalThis.Application('Mail'), 'mail'), MailApplicationProto);
}
/// <reference path="./types/mcp.d.ts" />
// ============================================================================
// MCP Resource Handler
// ============================================================================
const DEFAULT_COLLECTION_LIMIT = 20;
const MAX_COLLECTION_LIMIT = 100;
function readResource(uri) {
    const resResult = resolveURI(uri.href);
    if (!resResult.ok) {
        return { ok: false, error: `URI resolution failed: ${resResult.error}` };
    }
    const res = resResult.value;
    try {
        let data = res.resolve();
        // Get the canonical URI from the delegate
        const canonicalUri = res._delegate.uri();
        const fixedUri = canonicalUri.href !== uri.href ? canonicalUri : undefined;
        // Protect against returning huge collections
        if (Array.isArray(data)) {
            const queryState = res._delegate.queryState();
            const requestedLimit = queryState.pagination?.limit;
            const requestedOffset = queryState.pagination?.offset ?? 0;
            // Use requested limit (capped at max) or default
            const effectiveLimit = requestedLimit
                ? Math.min(requestedLimit, MAX_COLLECTION_LIMIT)
                : DEFAULT_COLLECTION_LIMIT;
            if (data.length > effectiveLimit) {
                const totalCount = data.length;
                const baseUri = (fixedUri || canonicalUri).href.split('?')[0];
                const nextOffset = requestedOffset + effectiveLimit;
                const nextUri = `${baseUri}?limit=${effectiveLimit}&offset=${nextOffset}`;
                return {
                    ok: true,
                    mimeType: 'application/json',
                    text: {
                        _pagination: {
                            total: totalCount,
                            returned: effectiveLimit,
                            offset: requestedOffset,
                            limit: effectiveLimit,
                            next: nextOffset < totalCount ? nextUri : null
                        },
                        items: data.slice(0, effectiveLimit)
                    },
                    fixedUri
                };
            }
        }
        // Add _uri to the result if it's an object
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            data._uri = (fixedUri || uri).href;
        }
        return { ok: true, mimeType: 'application/json', text: data, fixedUri };
    }
    catch (e) {
        const errorMessage = e.message || String(e);
        return { ok: false, error: `JXA error: ${errorMessage}` };
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
            const specifiers = resResult.value.resolve();
            for (let i = 0; i < specifiers.length; i++) {
                const acc = resResult.value.byIndex(i).resolve();
                resources.push({
                    uri: `mail://accounts/${encodeURIComponent(acc.id)}`,
                    name: acc.fullName,
                    description: acc.userName // email address
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
/// <reference path="framework/uri.ts" />
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
/// <reference path="framework/delegate.ts" />
/// <reference path="framework/filter-query.ts" />
/// <reference path="framework/schematic.ts" />
/// <reference path="framework/specifier.ts" />
/// <reference path="framework/uri.ts" />
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
