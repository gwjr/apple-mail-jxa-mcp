"use strict";
/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
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
// ============================================================================
// Schema Definition DSL - Simplified Syntax
// ============================================================================
// Type markers - property name defaults to JXA name
const t = {
    string: { _t: 'string' },
    number: { _t: 'number' },
    boolean: { _t: 'boolean' },
    date: { _t: 'date' },
    array: (elem) => ({ _t: 'array', _elem: elem }),
};
// Addressing markers (compile-time safe)
const by = {
    name: { _by: 'name' },
    index: { _by: 'index' },
    id: { _by: 'id' },
};
// Modifiers
function lazy(type) {
    return { ...type, _lazy: true };
}
function rw(type) {
    return { ...type, _rw: true };
}
function jxa(type, name) {
    return { ...type, _jxaName: name };
}
function collection(schema, addressing, opts) {
    return { _coll: true, _schema: schema, _addressing: addressing, _opts: opts };
}
// Computed property
function computed(fn) {
    return { _computed: true, _fn: fn };
}
// Standard mailbox marker
function standardMailbox(jxaName) {
    return { _stdMailbox: true, _jxaName: jxaName };
}
// Extract addressing modes from markers
function getAddressingModes(markers) {
    return markers.map(m => m._by);
}
/// <reference path="schema.ts" />
/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />
// ============================================================================
// Runtime Implementation
// ============================================================================
function str(value) {
    return value == null ? '' : '' + value;
}
function tryResolve(fn, context) {
    try {
        return { ok: true, value: fn() };
    }
    catch (error) {
        return { ok: false, error: `${context}: ${error}` };
    }
}
function scalarSpec(uri, getter) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve: () => tryResolve(getter, uri),
        fix: () => ({ ok: true, value: spec })
    };
    return spec;
}
function mutableSpec(uri, getter, setter) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve: () => tryResolve(getter, uri),
        fix: () => ({ ok: true, value: spec }),
        set: (value) => tryResolve(() => setter(value), `${uri}:set`)
    };
    return spec;
}
// Descriptor detection
const isType = (descriptor) => descriptor && '_t' in descriptor;
const isLazy = (descriptor) => descriptor && descriptor._lazy;
const isRW = (descriptor) => descriptor && descriptor._rw;
const isColl = (descriptor) => descriptor && descriptor._coll;
const isComputed = (descriptor) => descriptor && descriptor._computed;
const isStdMailbox = (descriptor) => descriptor && descriptor._stdMailbox;
const getJxaName = (descriptor, key) => descriptor?._jxaName ?? key;
// ============================================================================
// createDerived - builds runtime class from schema
// ============================================================================
function createDerived(schema, typeName) {
    return class {
        _jxa;
        _uri;
        constructor(jxa, uri) {
            this._jxa = jxa;
            this._uri = uri;
            for (const [key, descriptor] of Object.entries(schema)) {
                const jxaName = getJxaName(descriptor, key);
                if (isComputed(descriptor)) {
                    Object.defineProperty(this, key, {
                        get: () => descriptor._fn(this._jxa),
                        enumerable: true
                    });
                }
                else if (isColl(descriptor)) {
                    const self = this;
                    Object.defineProperty(this, key, {
                        get() {
                            const base = self._uri || `${typeName.toLowerCase()}://`;
                            const collUri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
                            return createCollSpec(collUri, self._jxa[jxaName], descriptor._schema, getAddressingModes(descriptor._addressing), `${typeName}_${key}`, descriptor._opts);
                        },
                        enumerable: true
                    });
                }
                else if (isType(descriptor)) {
                    const self = this;
                    if (isLazy(descriptor)) {
                        Object.defineProperty(this, key, {
                            get() {
                                const propUri = self._uri ? `${self._uri}/${key}` : `${typeName.toLowerCase()}://.../${key}`;
                                if (isRW(descriptor)) {
                                    return mutableSpec(propUri, () => convert(self._jxa[jxaName]()), (value) => self._jxa[jxaName].set(value));
                                }
                                return scalarSpec(propUri, () => convert(self._jxa[jxaName]()));
                            },
                            enumerable: true
                        });
                    }
                    else {
                        Object.defineProperty(this, key, {
                            get() { return convert(this._jxa[jxaName]()); },
                            enumerable: true
                        });
                    }
                }
            }
        }
        static fromJXA(jxa, uri) {
            return new this(jxa, uri);
        }
    };
    function convert(value) {
        if (value == null)
            return '';
        if (Array.isArray(value))
            return value.map(convert);
        return value;
    }
}
// ============================================================================
// Element Specifier
// ============================================================================
function createElemSpec(uri, jxa, schema, addressing, typeName) {
    const DerivedClass = createDerived(schema, typeName);
    const baseMatch = uri.match(/^(.+?)(?:\/[^\/\[]+|\[\d+\])$/);
    const baseUri = baseMatch ? baseMatch[1] : uri;
    const spec = {
        _isSpecifier: true,
        _jxa: jxa,
        uri,
        resolve: () => tryResolve(() => DerivedClass.fromJXA(jxa, uri), uri),
        fix() {
            return tryResolve(() => {
                let fixedBase = baseUri;
                if (baseUri.includes('[')) {
                    const parentResult = specifierFromURI(baseUri);
                    if (parentResult.ok) {
                        const fixed = parentResult.value.fix();
                        if (fixed.ok)
                            fixedBase = fixed.value.uri;
                    }
                }
                if (!addressing.length) {
                    if (fixedBase !== baseUri) {
                        return createElemSpec(fixedBase + uri.slice(baseUri.length), jxa, schema, addressing, typeName);
                    }
                    return spec;
                }
                for (const mode of ['id', 'name']) {
                    if (!addressing.includes(mode))
                        continue;
                    try {
                        const value = jxa[mode]();
                        if (value != null && value !== '') {
                            return createElemSpec(`${fixedBase}/${encodeURIComponent(String(value))}`, jxa, schema, addressing, typeName);
                        }
                    }
                    catch { }
                }
                if (fixedBase !== baseUri) {
                    return createElemSpec(fixedBase + uri.slice(baseUri.length), jxa, schema, addressing, typeName);
                }
                return spec;
            }, uri);
        }
    };
    for (const [key, descriptor] of Object.entries(schema)) {
        const jxaName = getJxaName(descriptor, key);
        if (isType(descriptor)) {
            Object.defineProperty(spec, key, {
                get() {
                    if (isRW(descriptor)) {
                        return mutableSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '', (value) => jxa[jxaName].set(value));
                    }
                    return scalarSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '');
                },
                enumerable: true
            });
        }
        else if (isColl(descriptor)) {
            Object.defineProperty(spec, key, {
                get() {
                    return createCollSpec(`${uri}/${key}`, jxa[jxaName], descriptor._schema, getAddressingModes(descriptor._addressing), `${typeName}_${key}`, descriptor._opts);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// ============================================================================
// Collection Specifier
// ============================================================================
function createCollSpec(uri, jxaColl, schema, addressing, typeName, opts, sortSpec, jsFilter, pagination, expand) {
    const DerivedClass = createDerived(schema, typeName);
    const baseUri = uri.split('?')[0];
    const spec = {
        _isSpecifier: true,
        uri,
        fix() {
            let fixedBase = baseUri;
            if (fixedBase.includes('[')) {
                const lastSlash = fixedBase.lastIndexOf('/');
                const schemeEnd = fixedBase.indexOf('://') + 3;
                if (lastSlash > schemeEnd) {
                    const parentResult = specifierFromURI(fixedBase.slice(0, lastSlash));
                    if (parentResult.ok) {
                        const fixed = parentResult.value.fix();
                        if (fixed.ok)
                            fixedBase = fixed.value.uri + '/' + fixedBase.slice(lastSlash + 1);
                    }
                }
            }
            if (fixedBase === uri) {
                return { ok: true, value: spec };
            }
            return { ok: true, value: createCollSpec(fixedBase, jxaColl, schema, addressing, typeName, opts) };
        },
        resolve() {
            return tryResolve(() => {
                const array = typeof jxaColl === 'function' ? jxaColl() : jxaColl;
                let results = array.map((jxaItem, index) => {
                    const itemUri = `${baseUri}[${index}]`;
                    const elemSpec = createElemSpec(itemUri, jxaItem, schema, addressing, typeName);
                    const resolved = elemSpec.resolve();
                    if (!resolved.ok)
                        return DerivedClass.fromJXA(jxaItem, itemUri);
                    const fixed = elemSpec.fix();
                    if (fixed.ok && fixed.value.uri !== itemUri) {
                        resolved.value._ref = fixed.value.uri;
                    }
                    return resolved.value;
                });
                if (jsFilter && Object.keys(jsFilter).length) {
                    results = results.filter((item) => {
                        for (const [key, predicate] of Object.entries(jsFilter)) {
                            const value = item[key];
                            const pred = predicate;
                            if ('contains' in pred && typeof value === 'string' && !value.includes(pred.contains))
                                return false;
                            if ('startsWith' in pred && typeof value === 'string' && !value.startsWith(pred.startsWith))
                                return false;
                            if ('greaterThan' in pred && !(value > pred.greaterThan))
                                return false;
                            if ('lessThan' in pred && !(value < pred.lessThan))
                                return false;
                            if ('equals' in pred && value !== pred.equals)
                                return false;
                        }
                        return true;
                    });
                }
                if (sortSpec) {
                    results.sort((a, b) => {
                        const aVal = a[sortSpec.by];
                        const bVal = b[sortSpec.by];
                        const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                        return sortSpec.direction === 'desc' ? -comparison : comparison;
                    });
                }
                if (pagination) {
                    const start = pagination.offset || 0;
                    const end = pagination.limit !== undefined ? start + pagination.limit : undefined;
                    results = results.slice(start, end);
                }
                if (expand?.length) {
                    results = results.map((item) => {
                        const expanded = {};
                        for (const key of Object.keys(item)) {
                            const value = item[key];
                            if (expand.includes(key) && value?._isSpecifier && typeof value.resolve === 'function') {
                                const resolved = value.resolve();
                                expanded[key] = resolved.ok ? resolved.value : value;
                            }
                            else {
                                expanded[key] = value;
                            }
                        }
                        return expanded;
                    });
                }
                return results;
            }, uri);
        }
    };
    if (addressing.includes('index')) {
        spec.byIndex = (index) => createElemSpec(`${baseUri}[${index}]`, jxaColl.at(index), schema, addressing, typeName);
    }
    if (addressing.includes('name')) {
        spec.byName = (name) => createElemSpec(`${baseUri}/${encodeURIComponent(name)}`, jxaColl.byName(name), schema, addressing, typeName);
    }
    if (addressing.includes('id')) {
        spec.byId = (id) => createElemSpec(`${baseUri}/${id}`, jxaColl.byId(id), schema, addressing, typeName);
    }
    spec.whose = (filter) => {
        const filterUri = `${uri}?${encodeFilter(filter)}`;
        const jxaFilter = {};
        for (const [key, predicate] of Object.entries(filter)) {
            const jxaName = getJxaName(schema[key], key);
            const pred = predicate;
            if ('equals' in pred)
                jxaFilter[jxaName] = pred.equals;
            else if ('contains' in pred)
                jxaFilter[jxaName] = { _contains: pred.contains };
            else if ('startsWith' in pred)
                jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
            else if ('greaterThan' in pred)
                jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
            else if ('lessThan' in pred)
                jxaFilter[jxaName] = { _lessThan: pred.lessThan };
        }
        try {
            const filtered = jxaColl.whose(jxaFilter);
            void filtered.length;
            return createCollSpec(filterUri, filtered, schema, addressing, typeName, opts, sortSpec, undefined, pagination, expand);
        }
        catch {
            return createCollSpec(filterUri, jxaColl, schema, addressing, typeName, opts, sortSpec, filter, pagination, expand);
        }
    };
    spec.sortBy = (sort) => {
        const sep = uri.includes('?') ? '&' : '?';
        return createCollSpec(`${uri}${sep}sort=${String(sort.by)}.${sort.direction || 'asc'}`, jxaColl, schema, addressing, typeName, opts, sort, jsFilter, pagination, expand);
    };
    spec.paginate = (page) => {
        const parts = [];
        if (page.limit !== undefined)
            parts.push(`limit=${page.limit}`);
        if (page.offset !== undefined)
            parts.push(`offset=${page.offset}`);
        const sep = uri.includes('?') ? '&' : '?';
        const newUri = parts.length ? `${uri}${sep}${parts.join('&')}` : uri;
        return createCollSpec(newUri, jxaColl, schema, addressing, typeName, opts, sortSpec, jsFilter, page, expand);
    };
    spec.expand = (expandProps) => {
        const sep = uri.includes('?') ? '&' : '?';
        return createCollSpec(`${uri}${sep}expand=${expandProps.join(',')}`, jxaColl, schema, addressing, typeName, opts, sortSpec, jsFilter, pagination, expandProps);
    };
    if (opts?.create) {
        spec.create = (props) => tryResolve(() => {
            const jxaProps = {};
            for (const [key, value] of Object.entries(props)) {
                jxaProps[getJxaName(schema[key], key)] = value;
            }
            const newItem = jxaColl.make({
                new: typeName.split('_').pop()?.toLowerCase() || typeName.toLowerCase(),
                withProperties: jxaProps
            });
            let newUri;
            try {
                const id = newItem.id();
                newUri = id ? `${baseUri}/${id}` : (() => { throw 0; })();
            }
            catch {
                try {
                    const name = newItem.name();
                    newUri = name ? `${baseUri}/${encodeURIComponent(name)}` : (() => { throw 0; })();
                }
                catch {
                    newUri = `${baseUri}[${(typeof jxaColl === 'function' ? jxaColl() : jxaColl).length - 1}]`;
                }
            }
            return createElemSpec(newUri, newItem, schema, addressing, typeName);
        }, `${uri}:create`);
    }
    if (opts?.delete) {
        spec.delete = (itemUri) => tryResolve(() => {
            const itemSpec = specifierFromURI(itemUri);
            if (!itemSpec.ok)
                throw new Error(itemSpec.error);
            if (itemSpec.value._jxa) {
                itemSpec.value._jxa.delete();
            }
            else {
                throw new Error(`Cannot delete: ${itemUri}`);
            }
        }, `${itemUri}:delete`);
    }
    return spec;
}
/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />
/// <reference path="runtime.ts" />
// ============================================================================
// URI Resolution and Registry
// ============================================================================
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
// ============================================================================
// Error Suggestion Helper
// ============================================================================
let _inErrorSuggestion = false;
function suggestCompletions(partial, max = 5) {
    if (_inErrorSuggestion)
        return '';
    _inErrorSuggestion = true;
    try {
        const completions = getCompletions(partial);
        if (!completions.length)
            return '';
        return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
    }
    finally {
        _inErrorSuggestion = false;
    }
}
// ============================================================================
// Query Parsing and Filter Encoding
// ============================================================================
function parseQuery(query) {
    const result = { filter: {} };
    for (const part of query.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = part.slice(eqIdx + 1);
        if (key === 'sort') {
            const [by, direction] = value.split('.');
            result.sort = { by, direction: direction || 'asc' };
            continue;
        }
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
        if (key === 'expand') {
            result.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
            continue;
        }
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            result.filter[key] = { equals: decodeURIComponent(value) };
        }
        else {
            const prop = key.slice(0, dotIdx);
            const op = key.slice(dotIdx + 1);
            if (op === 'contains')
                result.filter[prop] = { contains: decodeURIComponent(value) };
            else if (op === 'startsWith')
                result.filter[prop] = { startsWith: decodeURIComponent(value) };
            else if (op === 'gt')
                result.filter[prop] = { greaterThan: Number(value) };
            else if (op === 'lt')
                result.filter[prop] = { lessThan: Number(value) };
        }
    }
    return result;
}
function encodeFilter(filter) {
    const parts = [];
    for (const [key, predicate] of Object.entries(filter)) {
        const pred = predicate;
        if ('equals' in pred)
            parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
        else if ('contains' in pred)
            parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
        else if ('startsWith' in pred)
            parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
        else if ('greaterThan' in pred)
            parts.push(`${key}.gt=${pred.greaterThan}`);
        else if ('lessThan' in pred)
            parts.push(`${key}.lt=${pred.lessThan}`);
    }
    return parts.join('&');
}
// ============================================================================
// URI Deserialization
// ============================================================================
function specifierFromURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return { ok: false, error: `Invalid URI (no scheme): ${uri}.${suggestCompletions(uri)}` };
    }
    const scheme = uri.slice(0, schemeEnd);
    let rest = uri.slice(schemeEnd + 3);
    let query;
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        query = rest.slice(queryIdx + 1);
        rest = rest.slice(0, queryIdx);
    }
    const rootFactory = schemeRoots[scheme];
    if (!rootFactory) {
        const knownSchemes = Object.keys(schemeRoots);
        const suggestion = knownSchemes.length ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
        return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
    }
    let current = rootFactory();
    let resolved = `${scheme}://`;
    for (const segment of rest.split('/').filter(s => s)) {
        const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        try {
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
                const nextUri = resolved + (resolved.endsWith('://') ? '' : '/') + name;
                let hooked;
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
                    return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${suggestCompletions(partial)}` };
                }
            }
            if (index !== undefined) {
                if (!current.byIndex) {
                    return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
                }
                current = current.byIndex(index);
                resolved += `[${index}]`;
            }
        }
        catch (error) {
            return { ok: false, error: `Failed at '${segment}': ${error}.${suggestCompletions(resolved)}` };
        }
    }
    if (query) {
        try {
            const { filter, sort, pagination, expand } = parseQuery(query);
            if (Object.keys(filter).length > 0 && current.whose)
                current = current.whose(filter);
            if (sort && current.sortBy)
                current = current.sortBy(sort);
            if (pagination && current.paginate)
                current = current.paginate(pagination);
            if (expand?.length && current.expand)
                current = current.expand(expand);
            resolved += '?' + query;
        }
        catch (error) {
            return { ok: false, error: `Failed to apply query: ${error} (resolved: ${resolved})` };
        }
    }
    return { ok: true, value: current };
}
/// <reference path="../framework/schema.ts" />
/// <reference path="../framework/specifier.ts" />
/// <reference path="../framework/runtime.ts" />
/// <reference path="../framework/uri.ts" />
// ============================================================================
// URI Completions Support
// Autocomplete functionality for partial URIs
// ============================================================================
// ============================================================================
// Main Completion Entry Point
// ============================================================================
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
// ============================================================================
// Path Completions
// ============================================================================
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
        if (isCollectionForCompletion(child)) {
            return getCollectionCompletions(child, '');
        }
        // If it's a navigable specifier, suggest its properties
        if (child._isSpecifier) {
            return getPropertyCompletions(child, '');
        }
    }
    // Check if parent is a collection - suggest addressing
    if (isCollectionForCompletion(parent)) {
        return getCollectionCompletions(parent, partialSegment);
    }
    // Otherwise suggest properties matching partial
    return getPropertyCompletions(parent, partialSegment);
}
// ============================================================================
// Collection Completions
// ============================================================================
function isCollectionForCompletion(obj) {
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
// ============================================================================
// Property Completions
// ============================================================================
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
        if (isCollectionForCompletion(value)) {
            completions.push({ value: `${key}/`, label: key, description: 'Collection' });
        }
        else if (value && value._isSpecifier && hasNavigableChildren(value)) {
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
// ============================================================================
// Query Completions
// ============================================================================
function getQueryCompletions(scheme, basePath, query) {
    const completions = [];
    // Resolve to get the collection and a sample element
    const spec = specifierFromURI(`${scheme}://${basePath}`);
    if (!spec.ok || !isCollectionForCompletion(spec.value))
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
            if (typeof val !== 'function' && !isCollectionForCompletion(val) && !(val && val._isSpecifier)) {
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
                if (typeof val !== 'function' && !isCollectionForCompletion(val) && key.startsWith(sortVal)) {
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
/// <reference path="./framework/schema.ts" />
/// <reference path="./framework/specifier.ts" />
/// <reference path="./framework/runtime.ts" />
/// <reference path="./framework/uri.ts" />
/// <reference path="./framework-extras/completions.ts" />
function parseEmailAddress(raw) {
    if (!raw)
        return { name: '', address: '' };
    const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
    if (match) {
        const name = (match[1] || '').trim();
        const address = (match[2] || '').trim();
        if (!name && address.includes('@'))
            return { name: '', address };
        if (!address.includes('@'))
            return { name: address, address: '' };
        return { name, address };
    }
    return { name: '', address: raw.trim() };
}
// ============================================================================
// Schema Definitions - Using New Simplified Syntax
// ============================================================================
const SettingsSchema = {
    // App info
    name: t.string,
    version: t.string,
    frontmost: t.boolean,
    // Behavior
    alwaysBccMyself: t.boolean,
    alwaysCcMyself: t.boolean,
    downloadHtmlAttachments: t.boolean,
    fetchInterval: t.number,
    expandGroupAddresses: t.boolean,
    // Composing
    defaultMessageFormat: t.string,
    chooseSignatureWhenComposing: t.boolean,
    quoteOriginalMessage: t.boolean,
    sameReplyFormat: t.boolean,
    includeAllOriginalMessageText: t.boolean,
    // Display
    highlightSelectedConversation: t.boolean,
    colorQuotedText: t.boolean,
    levelOneQuotingColor: t.string,
    levelTwoQuotingColor: t.string,
    levelThreeQuotingColor: t.string,
    // Fonts
    messageFont: t.string,
    messageFontSize: t.number,
    messageListFont: t.string,
    messageListFontSize: t.number,
    useFixedWidthFont: t.boolean,
    fixedWidthFont: t.string,
    fixedWidthFontSize: t.number,
    // Sounds
    newMailSound: t.string,
    shouldPlayOtherMailSounds: t.boolean,
    // Spelling
    checkSpellingWhileTyping: t.boolean,
};
const RuleConditionSchema = {
    header: t.string,
    qualifier: t.string,
    ruleType: t.string,
    expression: t.string,
};
const RuleSchema = {
    name: t.string,
    enabled: t.boolean,
    allConditionsMustBeMet: t.boolean,
    deleteMessage: t.boolean,
    markRead: t.boolean,
    markFlagged: t.boolean,
    markFlagIndex: t.number,
    stopEvaluatingRules: t.boolean,
    forwardMessage: t.string,
    redirectMessage: t.string,
    replyText: t.string,
    playSound: t.string,
    highlightTextUsingColor: t.string,
    copyMessage: computed((jxa) => {
        try {
            const mailbox = jxa.copyMessage();
            return mailbox ? mailbox.name() : null;
        }
        catch {
            return null;
        }
    }),
    moveMessage: computed((jxa) => {
        try {
            const mailbox = jxa.moveMessage();
            return mailbox ? mailbox.name() : null;
        }
        catch {
            return null;
        }
    }),
    ruleConditions: collection(RuleConditionSchema, [by.index]),
};
const SignatureSchema = {
    name: t.string,
    content: lazy(t.string),
};
const RecipientSchema = {
    name: t.string,
    address: t.string,
};
const AttachmentSchema = {
    id: t.string,
    name: t.string,
    fileSize: t.number,
};
const MessageSchema = {
    id: t.number,
    messageId: t.string,
    subject: t.string,
    sender: computed((jxa) => parseEmailAddress(str(jxa.sender()))),
    replyTo: computed((jxa) => parseEmailAddress(str(jxa.replyTo()))),
    dateSent: t.date,
    dateReceived: t.date,
    content: lazy(t.string),
    readStatus: t.boolean,
    flaggedStatus: t.boolean,
    junkMailStatus: t.boolean,
    messageSize: t.number,
    toRecipients: collection(RecipientSchema, [by.name, by.index]),
    ccRecipients: collection(RecipientSchema, [by.name, by.index]),
    bccRecipients: collection(RecipientSchema, [by.name, by.index]),
    attachments: jxa(collection(AttachmentSchema, [by.name, by.index, by.id]), 'mailAttachments'),
};
const MailboxSchema = {
    name: t.string,
    unreadCount: t.number,
    messages: collection(MessageSchema, [by.index, by.id]),
};
MailboxSchema.mailboxes = collection(MailboxSchema, [by.name, by.index]);
const AccountSchema = {
    id: t.string,
    name: t.string,
    fullName: t.string,
    emailAddresses: t.array(t.string),
    mailboxes: collection(MailboxSchema, [by.name, by.index]),
};
const StandardMailboxSchema = {
    name: t.string,
    unreadCount: t.number,
    messages: collection(MessageSchema, [by.index, by.id]),
};
const MailAppSchema = {
    accounts: collection(AccountSchema, [by.name, by.index, by.id]),
    rules: collection(RuleSchema, [by.name, by.index]),
    signatures: collection(SignatureSchema, [by.name, by.index]),
    inbox: standardMailbox('inbox'),
    drafts: standardMailbox('draftsMailbox'),
    junk: standardMailbox('junkMailbox'),
    outbox: standardMailbox('outbox'),
    sent: standardMailbox('sentMailbox'),
    trash: standardMailbox('trashMailbox'),
};
// ============================================================================
// Derived Classes
// ============================================================================
const Settings = createDerived(SettingsSchema, 'Settings');
const RuleCondition = createDerived(RuleConditionSchema, 'RuleCondition');
const Rule = createDerived(RuleSchema, 'Rule');
const Signature = createDerived(SignatureSchema, 'Signature');
const Recipient = createDerived(RecipientSchema, 'Recipient');
const Attachment = createDerived(AttachmentSchema, 'Attachment');
const Message = createDerived(MessageSchema, 'Message');
const Mailbox = createDerived(MailboxSchema, 'Mailbox');
const Account = createDerived(AccountSchema, 'Account');
const MailApp = createDerived(MailAppSchema, 'Mail');
const StandardMailbox = createDerived(StandardMailboxSchema, 'StandardMailbox');
// ============================================================================
// Specifier Helpers
// ============================================================================
function createSchemaSpecifier(uri, jxa, schema, typeName) {
    const DerivedClass = createDerived(schema, typeName);
    const spec = {
        _isSpecifier: true, uri,
        resolve: () => tryResolve(() => DerivedClass.fromJXA(jxa, uri), uri),
        fix: () => ({ ok: true, value: spec }),
    };
    for (const [key, descriptor] of Object.entries(schema)) {
        const jxaName = getJxaName(descriptor, key);
        if (descriptor && '_t' in descriptor) {
            Object.defineProperty(spec, key, {
                get() { return scalarSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? ''); },
                enumerable: true
            });
        }
        else if (descriptor && '_coll' in descriptor) {
            const desc = descriptor;
            Object.defineProperty(spec, key, {
                get() { return createCollSpec(`${uri}/${key}`, jxa[jxaName], desc._schema, getAddressingModes(desc._addressing), `${typeName}_${key}`, desc._opts); },
                enumerable: true
            });
        }
    }
    return spec;
}
// ============================================================================
// Entry Point
// ============================================================================
let _mailApp = null;
function getMailApp() {
    if (_mailApp)
        return _mailApp;
    const jxa = Application('Mail');
    const app = MailApp.fromJXA(jxa, 'mail://');
    app.uri = 'mail://';
    app._isSpecifier = true;
    app.resolve = () => ({ ok: true, value: app });
    // Standard mailboxes
    const standardMailboxes = [
        { name: 'inbox', jxaName: 'inbox' },
        { name: 'drafts', jxaName: 'draftsMailbox' },
        { name: 'junk', jxaName: 'junkMailbox' },
        { name: 'outbox', jxaName: 'outbox' },
        { name: 'sent', jxaName: 'sentMailbox' },
        { name: 'trash', jxaName: 'trashMailbox' },
    ];
    for (const { name, jxaName } of standardMailboxes) {
        Object.defineProperty(app, name, {
            get() { return createSchemaSpecifier(`mail://${name}`, jxa[jxaName], StandardMailboxSchema, 'StandardMailbox'); },
            enumerable: true
        });
    }
    // Settings
    Object.defineProperty(app, 'settings', {
        get() { return createSchemaSpecifier('mail://settings', jxa, SettingsSchema, 'Settings'); },
        enumerable: true
    });
    _mailApp = app;
    return _mailApp;
}
registerScheme('mail', getMailApp);
// ============================================================================
// Account Standard Mailbox Navigation
// ============================================================================
const accountStandardMailboxes = {
    inbox: 'inbox',
    sent: 'sentMailbox',
    drafts: 'draftsMailbox',
    junk: 'junkMailbox',
    trash: 'trashMailbox',
};
registerCompletionHook((specifier, partial) => {
    if (!specifier?.uri?.match(/^mail:\/\/accounts\[\d+\]$/))
        return [];
    return Object.keys(accountStandardMailboxes)
        .filter(name => name.startsWith(partial.toLowerCase()))
        .map(name => ({ value: `${name}/`, label: name, description: 'Standard mailbox' }));
});
registerNavigationHook((parent, name, uri) => {
    const jxaAppName = accountStandardMailboxes[name];
    if (!jxaAppName || !parent?._isSpecifier)
        return undefined;
    try {
        const parentResult = parent.resolve();
        if (!parentResult.ok)
            return undefined;
        const accountId = parentResult.value.id;
        if (!accountId)
            return undefined;
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
        return createSchemaSpecifier(uri, accountMailbox, MailboxSchema, 'Mailbox');
    }
    catch {
        return undefined;
    }
});
// ============================================================================
// Exports
// ============================================================================
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
        // Rules, Signatures, Settings
        { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
        { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' },
        { uri: 'mail://settings', name: 'Settings', description: 'Mail.app preferences' }
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
/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mail-app.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="framework/schema.ts" />
/// <reference path="framework/specifier.ts" />
/// <reference path="framework/runtime.ts" />
/// <reference path="framework/uri.ts" />
/// <reference path="framework-extras/completions.ts" />
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
