"use strict";
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
// Standard mailbox marker (app-level aggregate)
function standardMailbox(jxaName) {
    return { _stdMailbox: true, _jxaName: jxaName };
}
// Account-scoped mailbox marker (virtual navigation to account's standard mailbox)
function accountScopedMailbox(jxaProperty) {
    return { _accountMailbox: true, _jxaProperty: jxaProperty };
}
// Virtual namespace marker (for object-like navigation with children, e.g., settings)
function namespace(schema, jxaProperty) {
    return { _namespace: true, _schema: schema, _jxaProperty: jxaProperty };
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
// Query operators valid for each type
const validOperators = {
    string: ['equals', 'contains', 'startsWith'],
    number: ['equals', 'gt', 'lt'],
    boolean: ['equals'],
    date: ['equals', 'gt', 'lt'],
    array: ['equals'],
};
// ============================================================================
// Factory Functions
// ============================================================================
const route = {
    property(valueType, opts) {
        return { _property: true, valueType, ...opts };
    },
    computed(fn, jxaName) {
        return { _computed: true, computeFn: fn, jxaName };
    },
    collection(elementSchema, addressing, opts) {
        return { _collection: true, elementSchema, addressing, ...opts };
    },
    virtualProp(jxaProperty, targetSchema, accountScoped) {
        return { _virtualProp: true, jxaProperty, targetSchema, accountScoped };
    },
    virtualCtx(targetSchema) {
        return { _virtualCtx: true, targetSchema };
    },
    root() {
        return { _root: true };
    }
};
// Type guards for discriminating entry types
function isPropertyEntry(entry) {
    return '_property' in entry;
}
function isComputedEntry(entry) {
    return '_computed' in entry;
}
function isCollectionEntry(entry) {
    return '_collection' in entry;
}
function isVirtualPropEntry(entry) {
    return '_virtualProp' in entry;
}
function isVirtualCtxEntry(entry) {
    return '_virtualCtx' in entry;
}
function isVirtualEntry(entry) {
    return '_virtualProp' in entry || '_virtualCtx' in entry;
}
function isRootEntry(entry) {
    return '_root' in entry;
}
// Get descriptive type string for external consumers
function getEntryType(entry) {
    if (isRootEntry(entry))
        return 'root';
    if (isCollectionEntry(entry))
        return 'collection';
    if (isPropertyEntry(entry))
        return 'property';
    if (isComputedEntry(entry))
        return 'computed';
    if (isVirtualEntry(entry))
        return 'virtual';
    return 'unknown';
}
// ============================================================================
// Route Table Compiler
// ============================================================================
function compileRoutes(schema, scheme, namedSchemas) {
    const schemaRegistry = {};
    // Register named schemas provided by caller
    if (namedSchemas) {
        for (const [name, s] of Object.entries(namedSchemas)) {
            schemaRegistry[name] = s;
        }
    }
    // Register schemas as they're encountered
    function registerSchema(s, name) {
        if (s && !schemaRegistry[name]) {
            schemaRegistry[name] = s;
        }
    }
    // Compile a schema into a route node
    function compileSchema(s, name) {
        registerSchema(s, name);
        const children = {};
        for (const [key, descriptor] of Object.entries(s)) {
            if (!descriptor)
                continue;
            const desc = descriptor;
            // Collection
            if ('_coll' in desc) {
                const elementSchemaName = getSchemaName(desc._schema, key);
                registerSchema(desc._schema, elementSchemaName);
                children[key] = {
                    entry: route.collection({ _ref: elementSchemaName }, getAddressingModes(desc._addressing), { jxaName: desc._jxaName, mutable: desc._opts }),
                    children: {},
                };
                continue;
            }
            // Computed property
            if ('_computed' in desc) {
                children[key] = {
                    entry: route.computed(desc._fn, desc._jxaName),
                    children: {},
                };
                continue;
            }
            // Standard mailbox (app-level virtual)
            if ('_stdMailbox' in desc) {
                children[key] = {
                    entry: route.virtualProp(desc._jxaName, { _ref: 'StandardMailbox' }),
                    children: {},
                };
                continue;
            }
            // Account-scoped mailbox (virtual)
            if ('_accountMailbox' in desc) {
                children[key] = {
                    entry: route.virtualProp(desc._jxaProperty, { _ref: 'Mailbox' }, true),
                    children: {},
                };
                continue;
            }
            // Namespace marker (object-like navigation with children)
            if ('_namespace' in desc) {
                const namespaceSchemaName = getSchemaName(desc._schema, key);
                registerSchema(desc._schema, namespaceSchemaName);
                if (desc._jxaProperty) {
                    children[key] = {
                        entry: route.virtualProp(desc._jxaProperty, { _ref: namespaceSchemaName }),
                        children: {},
                    };
                }
                else {
                    children[key] = {
                        entry: route.virtualCtx({ _ref: namespaceSchemaName }),
                        children: {},
                    };
                }
                continue;
            }
            // Type marker (property)
            if ('_t' in desc) {
                children[key] = {
                    entry: route.property(mapType(desc._t, desc), {
                        jxaName: desc._jxaName,
                        lazy: desc._lazy,
                        rw: desc._rw,
                    }),
                    children: {},
                };
                continue;
            }
        }
        return {
            entry: route.root(),
            children,
        };
    }
    function mapType(t, desc) {
        if (t === 'array')
            return 'array';
        return t;
    }
    function getSchemaName(schema, fallback) {
        // Try to find a unique identifier for the schema
        // Use the schema object reference to check if already registered
        for (const [name, registered] of Object.entries(schemaRegistry)) {
            if (registered === schema)
                return name;
        }
        return fallback;
    }
    const root = compileSchema(schema, 'Root');
    return { scheme, root, schemaRegistry };
}
// ============================================================================
// Route Node Resolution (handles schema refs)
// ============================================================================
function getRouteChildren(node, table) {
    const entry = node.entry;
    // For collections, get children from element schema
    if (isCollectionEntry(entry)) {
        const schemaRef = entry.elementSchema;
        if ('_ref' in schemaRef) {
            const schema = table.schemaRegistry[schemaRef._ref];
            if (schema) {
                return compileSchemaChildren(schema, table);
            }
        }
    }
    // For virtual entries, get children from target schema
    if (isVirtualEntry(entry)) {
        const schemaRef = entry.targetSchema;
        if ('_ref' in schemaRef) {
            const schema = table.schemaRegistry[schemaRef._ref];
            if (schema) {
                return compileSchemaChildren(schema, table);
            }
        }
    }
    return node.children;
}
function compileSchemaChildren(schema, table) {
    const children = {};
    for (const [key, descriptor] of Object.entries(schema)) {
        if (!descriptor)
            continue;
        const desc = descriptor;
        // Collection
        if ('_coll' in desc) {
            const elementSchemaName = findSchemaName(desc._schema, table) || key;
            children[key] = {
                entry: route.collection({ _ref: elementSchemaName }, getAddressingModes(desc._addressing), { jxaName: desc._jxaName, mutable: desc._opts }),
                children: {},
            };
            continue;
        }
        // Computed
        if ('_computed' in desc) {
            children[key] = {
                entry: route.computed(desc._fn, desc._jxaName),
                children: {},
            };
            continue;
        }
        // Standard mailbox
        if ('_stdMailbox' in desc) {
            children[key] = {
                entry: route.virtualProp(desc._jxaName, { _ref: 'StandardMailbox' }),
                children: {},
            };
            continue;
        }
        // Account-scoped mailbox
        if ('_accountMailbox' in desc) {
            children[key] = {
                entry: route.virtualProp(desc._jxaProperty, { _ref: 'Mailbox' }, true),
                children: {},
            };
            continue;
        }
        // Namespace marker
        if ('_namespace' in desc) {
            const namespaceSchemaName = findSchemaName(desc._schema, table) || key;
            if (desc._jxaProperty) {
                children[key] = {
                    entry: route.virtualProp(desc._jxaProperty, { _ref: namespaceSchemaName }),
                    children: {},
                };
            }
            else {
                children[key] = {
                    entry: route.virtualCtx({ _ref: namespaceSchemaName }),
                    children: {},
                };
            }
            continue;
        }
        // Property
        if ('_t' in desc) {
            children[key] = {
                entry: route.property(desc._t === 'array' ? 'array' : desc._t, { jxaName: desc._jxaName, lazy: desc._lazy, rw: desc._rw }),
                children: {},
            };
            continue;
        }
    }
    return children;
}
function findSchemaName(schema, table) {
    for (const [name, registered] of Object.entries(table.schemaRegistry)) {
        if (registered === schema)
            return name;
    }
    return undefined;
}
// ============================================================================
// URI Parsing with Route Table
// ============================================================================
function parseURIWithRoutes(uri, routes) {
    // Parse scheme
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return {
            ok: false,
            error: `Invalid URI (no scheme): ${uri}`,
            pathSoFar: '',
            failedSegment: uri,
            availableOptions: [routes.scheme],
        };
    }
    const scheme = uri.slice(0, schemeEnd);
    if (scheme !== routes.scheme) {
        return {
            ok: false,
            error: `Unknown scheme: ${scheme}. Expected: ${routes.scheme}`,
            pathSoFar: '',
            failedSegment: scheme,
            availableOptions: [routes.scheme],
        };
    }
    let rest = uri.slice(schemeEnd + 3);
    // Split query string
    let queryString;
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        queryString = rest.slice(queryIdx + 1);
        rest = rest.slice(0, queryIdx);
    }
    // Handle root URI
    if (!rest || rest === '') {
        return {
            ok: true,
            type: 'root',
            segments: [],
            depth: 0,
            route: routes.root,
            queryValid: true,
        };
    }
    // Parse path segments
    const rawSegments = rest.split('/').filter(s => s);
    const parsedSegments = [];
    let currentNode = routes.root;
    let pathSoFar = `${scheme}://`;
    let depth = 0;
    for (let i = 0; i < rawSegments.length; i++) {
        const segment = rawSegments[i];
        depth++;
        // Check for index addressing: name[index]
        const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        // Get available children at current level
        const children = isRootEntry(currentNode.entry)
            ? currentNode.children
            : getRouteChildren(currentNode, routes);
        // Check if navigating into a collection element
        if (isCollectionEntry(currentNode.entry)) {
            // This segment addresses an element in the collection
            const addressing = currentNode.entry.addressing;
            // Determine addressing type
            if (index !== undefined) {
                // name[index] - but for collections, name should match collection name (already consumed)
                // This is actually a direct index like [0]
                return {
                    ok: false,
                    error: `Unexpected segment '${segment}' - collection already being addressed`,
                    pathSoFar,
                    failedSegment: segment,
                    availableOptions: Object.keys(children),
                };
            }
            // Check if segment matches a child property (not an element address)
            if (children[name]) {
                currentNode = children[name];
                parsedSegments.push({ name });
                pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + name;
                // Handle index on the child (e.g., mailboxes/INBOX/messages[0])
                if (indexMatch) {
                    // This shouldn't happen - index should be on collection, not child
                    return {
                        ok: false,
                        error: `Cannot use index on '${name}'`,
                        pathSoFar,
                        failedSegment: segment,
                        availableOptions: [],
                    };
                }
                continue;
            }
            // Segment addresses an element by name or id
            let addressingType = 'name';
            if (addressing.includes('name')) {
                addressingType = 'name';
            }
            else if (addressing.includes('id')) {
                addressingType = 'id';
            }
            else {
                return {
                    ok: false,
                    error: `Collection does not support name or id addressing, use index: [0]`,
                    pathSoFar,
                    failedSegment: segment,
                    availableOptions: ['[index]'],
                };
            }
            parsedSegments.push({
                name,
                addressing: { type: addressingType, value: decodeURIComponent(name) },
            });
            pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + segment;
            // Stay at collection level but now we're addressing an element
            // Children are from the element schema
            continue;
        }
        // Look up child route
        const childNode = children[name];
        if (!childNode) {
            return {
                ok: false,
                error: `Unknown segment '${name}' at ${pathSoFar}`,
                pathSoFar,
                failedSegment: name,
                availableOptions: Object.keys(children),
            };
        }
        currentNode = childNode;
        parsedSegments.push({ name });
        pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + name;
        // Handle index addressing on collections
        if (index !== undefined) {
            if (!isCollectionEntry(currentNode.entry)) {
                return {
                    ok: false,
                    error: `Cannot use index on non-collection '${name}'`,
                    pathSoFar,
                    failedSegment: segment,
                    availableOptions: [],
                };
            }
            if (!currentNode.entry.addressing.includes('index')) {
                return {
                    ok: false,
                    error: `Collection '${name}' does not support index addressing`,
                    pathSoFar,
                    failedSegment: segment,
                    availableOptions: [],
                };
            }
            parsedSegments.push({
                name: `[${index}]`,
                addressing: { type: 'index', value: index },
            });
            pathSoFar += `[${index}]`;
            depth++;
        }
    }
    // Parse and validate query string
    let query;
    let queryValid = true;
    let queryError;
    if (queryString) {
        const queryResult = parseAndValidateQuery(queryString, currentNode, routes);
        query = queryResult.query;
        queryValid = queryResult.valid;
        queryError = queryResult.error;
    }
    return {
        ok: true,
        type: getEntryType(currentNode.entry),
        segments: parsedSegments,
        depth,
        route: currentNode,
        query,
        queryValid,
        queryError,
    };
}
// ============================================================================
// Query Parsing and Validation
// ============================================================================
function parseAndValidateQuery(queryString, currentNode, routes) {
    const query = { filter: {} };
    let valid = true;
    let error;
    // Get the schema for the current node to validate fields
    let fieldTypes = {};
    if (isCollectionEntry(currentNode.entry)) {
        const schemaRef = currentNode.entry.elementSchema;
        if ('_ref' in schemaRef) {
            const schema = routes.schemaRegistry[schemaRef._ref];
            if (schema) {
                fieldTypes = extractFieldTypes(schema);
            }
        }
    }
    for (const part of queryString.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = part.slice(eqIdx + 1);
        // Standard params
        if (key === 'sort') {
            const [by, direction] = value.split('.');
            query.sort = { by, direction: direction || 'asc' };
            continue;
        }
        if (key === 'limit') {
            query.pagination = query.pagination || {};
            query.pagination.limit = Number(value);
            continue;
        }
        if (key === 'offset') {
            query.pagination = query.pagination || {};
            query.pagination.offset = Number(value);
            continue;
        }
        if (key === 'expand') {
            query.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
            continue;
        }
        // Filter params
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            // Simple equals: ?name=value
            query.filter[key] = { equals: decodeURIComponent(value) };
        }
        else {
            const prop = key.slice(0, dotIdx);
            const op = key.slice(dotIdx + 1);
            // Validate operator against field type
            const fieldType = fieldTypes[prop];
            if (fieldType) {
                const validOps = validOperators[fieldType];
                const normalizedOp = normalizeOperator(op);
                if (!validOps.includes(normalizedOp)) {
                    valid = false;
                    error = `${op} operator not valid for ${fieldType} field`;
                }
            }
            // Parse the filter
            if (op === 'contains')
                query.filter[prop] = { contains: decodeURIComponent(value) };
            else if (op === 'startsWith')
                query.filter[prop] = { startsWith: decodeURIComponent(value) };
            else if (op === 'gt')
                query.filter[prop] = { greaterThan: Number(value) };
            else if (op === 'lt')
                query.filter[prop] = { lessThan: Number(value) };
        }
    }
    return { query, valid, error };
}
function normalizeOperator(op) {
    if (op === 'gt')
        return 'gt';
    if (op === 'lt')
        return 'lt';
    return op;
}
function extractFieldTypes(schema) {
    const types = {};
    for (const [key, descriptor] of Object.entries(schema)) {
        if (!descriptor)
            continue;
        const desc = descriptor;
        if ('_t' in desc) {
            types[key] = desc._t === 'array' ? 'array' : desc._t;
        }
    }
    return types;
}
// ============================================================================
// Completion Support
// ============================================================================
function getRouteCompletions(partial, routes) {
    const completions = [];
    // Parse scheme
    const schemeMatch = partial.match(/^([^:]*)(:\/?\/?)?(.*)?$/);
    if (!schemeMatch)
        return [];
    const [, schemePartial, schemeSep, pathPart] = schemeMatch;
    // Suggest schemes
    if (!schemeSep || schemeSep !== '://') {
        if (routes.scheme.startsWith(schemePartial)) {
            completions.push({ value: `${routes.scheme}://`, label: routes.scheme, description: 'Scheme' });
        }
        return completions;
    }
    const path = pathPart || '';
    // Check if in query string
    const queryIdx = path.indexOf('?');
    if (queryIdx !== -1) {
        return getRouteQueryCompletions(routes.scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1), routes);
    }
    // Path completion
    return getRoutePathCompletions(routes.scheme, path, routes);
}
function getRoutePathCompletions(scheme, path, routes) {
    const completions = [];
    // Split path to find partial segment
    const segments = path.split('/');
    const partialSegment = segments.pop() || '';
    const completePath = segments.join('/');
    // Parse parent path
    const parentUri = `${scheme}://${completePath}`;
    const parentResult = parseURIWithRoutes(parentUri, routes);
    if (!parentResult.ok)
        return [];
    const parentNode = parentResult.route;
    const children = isRootEntry(parentNode.entry)
        ? parentNode.children
        : getRouteChildren(parentNode, routes);
    // Suggest matching children
    for (const [name, node] of Object.entries(children)) {
        if (!name.toLowerCase().startsWith(partialSegment.toLowerCase()))
            continue;
        const entry = node.entry;
        let description;
        let suffix = '';
        if (isCollectionEntry(entry)) {
            suffix = '/';
            description = 'Collection';
        }
        else if (isVirtualEntry(entry)) {
            suffix = '/';
            description = 'Mailbox';
        }
        else if (isPropertyEntry(entry)) {
            description = `${entry.valueType} property`;
        }
        else if (isComputedEntry(entry)) {
            description = 'Computed property';
        }
        else {
            description = 'Entry';
        }
        completions.push({
            value: name + suffix,
            label: name,
            description,
        });
    }
    // If at a collection, suggest addressing options
    if (isCollectionEntry(parentNode.entry)) {
        if (parentNode.entry.addressing.includes('index')) {
            completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
        }
        completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
    }
    return completions;
}
function getRouteQueryCompletions(scheme, basePath, query, routes) {
    const completions = [];
    const parseResult = parseURIWithRoutes(`${scheme}://${basePath}`, routes);
    if (!parseResult.ok || !isCollectionEntry(parseResult.route.entry))
        return [];
    const schemaRef = parseResult.route.entry.elementSchema;
    let fieldTypes = {};
    if ('_ref' in schemaRef) {
        const schema = routes.schemaRegistry[schemaRef._ref];
        if (schema) {
            fieldTypes = extractFieldTypes(schema);
        }
    }
    const params = query.split('&');
    const lastParam = params[params.length - 1] || '';
    // Standard params
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
    // Property filters
    if (!lastParam.includes('=') && !lastParam.includes('.')) {
        for (const [key, type] of Object.entries(fieldTypes)) {
            if (key.startsWith(lastParam)) {
                completions.push({ value: `${key}=`, label: key, description: `Filter by ${key} (${type})` });
            }
        }
    }
    // Operator completion
    const dotMatch = lastParam.match(/^(\w+)\.(\w*)$/);
    if (dotMatch) {
        const [, prop, opPartial] = dotMatch;
        const fieldType = fieldTypes[prop];
        const ops = fieldType ? validOperators[fieldType] : ['contains', 'startsWith', 'gt', 'lt'];
        for (const op of ops) {
            const displayOp = op === 'greaterThan' ? 'gt' : op === 'lessThan' ? 'lt' : op;
            if (displayOp.startsWith(opPartial)) {
                completions.push({ value: `${prop}.${displayOp}=`, label: displayOp, description: `${op} operator` });
            }
        }
    }
    // Sort completion
    if (lastParam.startsWith('sort=')) {
        const sortVal = lastParam.slice(5);
        if (!sortVal.includes('.')) {
            for (const key of Object.keys(fieldTypes)) {
                if (key.startsWith(sortVal)) {
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
    return completions;
}
// ============================================================================
// Exports
// ============================================================================
globalThis.compileRoutes = compileRoutes;
globalThis.parseURIWithRoutes = parseURIWithRoutes;
globalThis.getRouteCompletions = getRouteCompletions;
globalThis.getRouteChildren = getRouteChildren;
globalThis.validOperators = validOperators;
/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />
/// <reference path="runtime.ts" />
/// <reference path="routes.ts" />
const schemeRegistry = {};
function registerScheme(scheme, root, schema, namedSchemas) {
    schemeRegistry[scheme] = {
        root,
        schema,
        routes: compileRoutes(schema, scheme, namedSchemas),
    };
}
// Legacy accessor for completions (read-only)
const schemeRoots = new Proxy({}, {
    get: (_target, prop) => schemeRegistry[prop]?.root,
    ownKeys: () => Object.keys(schemeRegistry),
    getOwnPropertyDescriptor: (_target, prop) => schemeRegistry[prop] ? { configurable: true, enumerable: true } : undefined,
});
// ============================================================================
// Route Table Access
// ============================================================================
function getRoutesForScheme(scheme) {
    return schemeRegistry[scheme]?.routes;
}
function formatAvailableOptions(options, max = 10) {
    if (options.length === 0)
        return '';
    const shown = options.slice(0, max);
    const more = options.length > max ? `, ... (${options.length - max} more)` : '';
    return ` Available: ${shown.join(', ')}${more}`;
}
// ============================================================================
// Error Suggestion Helper (Route-Table Based)
// ============================================================================
function suggestCompletions(partial, max = 5) {
    // Extract scheme
    const schemeEnd = partial.indexOf('://');
    if (schemeEnd === -1)
        return '';
    const scheme = partial.slice(0, schemeEnd);
    const routes = getRoutesForScheme(scheme);
    if (routes) {
        // Use route-based completions
        const completions = getRouteCompletions(partial, routes);
        if (!completions.length)
            return '';
        return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
    }
    // Fall back to legacy completion probing
    const completions = getCompletions(partial);
    if (!completions.length)
        return '';
    return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
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
// URI Deserialization (Route-Table Based)
// ============================================================================
function specifierFromURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return { ok: false, error: `Invalid URI (no scheme): ${uri}` };
    }
    const scheme = uri.slice(0, schemeEnd);
    const registration = schemeRegistry[scheme];
    if (!registration) {
        const knownSchemes = Object.keys(schemeRegistry);
        const suggestion = knownSchemes.length ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
        return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
    }
    return specifierFromURIWithRoutes(uri, scheme, registration, registration.routes);
}
// Route-table based URI resolution
function specifierFromURIWithRoutes(uri, scheme, registration, routes) {
    // Parse and validate URI structure against route table
    const parseResult = parseURIWithRoutes(uri, routes);
    if (!parseResult.ok) {
        // Format error with available options
        const availableStr = formatAvailableOptions(parseResult.availableOptions);
        return {
            ok: false,
            error: `Unknown segment '${parseResult.failedSegment}' at ${parseResult.pathSoFar}.${availableStr}`
        };
    }
    // Query validation
    if (!parseResult.queryValid && parseResult.queryError) {
        return { ok: false, error: `Invalid query: ${parseResult.queryError}` };
    }
    // Now execute navigation using validated route info
    let current = registration.root();
    let resolved = `${scheme}://`;
    // Split path for navigation
    let rest = uri.slice(scheme.length + 3);
    const queryIdx = rest.indexOf('?');
    const query = queryIdx !== -1 ? rest.slice(queryIdx + 1) : undefined;
    if (queryIdx !== -1)
        rest = rest.slice(0, queryIdx);
    // Navigate using route-guided path
    let currentRoute = routes.root;
    for (const segment of rest.split('/').filter(s => s)) {
        const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        try {
            // Get route children to determine navigation type
            const children = isRootEntry(currentRoute.entry)
                ? currentRoute.children
                : getRouteChildren(currentRoute, routes);
            const childRoute = children[name];
            if (childRoute) {
                // Navigate using route-guided navigation
                const entry = childRoute.entry;
                if (isVirtualEntry(entry)) {
                    // Virtual navigation (standard mailboxes, settings, etc.)
                    const newUri = resolved + (resolved.endsWith('://') ? '' : '/') + name;
                    const jxaApp = Application('Mail');
                    const targetSchema = routes.schemaRegistry[entry.targetSchema._ref];
                    if (isVirtualPropEntry(entry)) {
                        if (entry.accountScoped) {
                            // Account-scoped mailbox - need special handling
                            current = navigateAccountMailbox(current, entry, newUri);
                        }
                        else {
                            // Navigation via JXA property
                            const jxaProp = jxaApp[entry.jxaProperty];
                            const jxaObj = typeof jxaProp === 'function' ? jxaProp() : jxaProp;
                            current = createSchemaSpecifier(newUri, jxaObj, targetSchema, entry.targetSchema._ref);
                        }
                    }
                    else {
                        // useSelf: use the current context (e.g., app itself for settings)
                        current = createSchemaSpecifier(newUri, jxaApp, targetSchema, entry.targetSchema._ref);
                    }
                    currentRoute = childRoute;
                    resolved += (resolved.endsWith('://') ? '' : '/') + name;
                }
                else if (current[name] !== undefined) {
                    // Direct property navigation
                    current = current[name];
                    currentRoute = childRoute;
                    resolved += (resolved.endsWith('://') ? '' : '/') + name;
                }
                else {
                    // Should not happen if route table is correct
                    return { ok: false, error: `Route exists but navigation failed for '${name}' at ${resolved}` };
                }
            }
            else if (isCollectionEntry(currentRoute.entry)) {
                // Addressing into a collection element by name/id
                if (current.byName) {
                    current = current.byName(decodeURIComponent(name));
                }
                else if (current.byId) {
                    current = current.byId(decodeURIComponent(name));
                }
                else {
                    return { ok: false, error: `Cannot address collection by name/id at ${resolved}` };
                }
                resolved += (resolved.endsWith('://') ? '' : '/') + name;
                // Stay at collection level for children lookup
            }
            else {
                // No route match - should have been caught by parseURIWithRoutes
                const availableStr = formatAvailableOptions(Object.keys(children));
                return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${availableStr}` };
            }
            // Handle index addressing
            if (index !== undefined) {
                if (!current.byIndex) {
                    return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
                }
                current = current.byIndex(index);
                resolved += `[${index}]`;
            }
        }
        catch (error) {
            return { ok: false, error: `Failed at '${segment}': ${error}` };
        }
    }
    // Apply query parameters
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
        }
        catch (error) {
            return { ok: false, error: `Failed to apply query: ${error}` };
        }
    }
    return { ok: true, value: current };
}
// Navigate to account-scoped mailbox
function navigateAccountMailbox(parent, entry, uri) {
    try {
        const parentResult = parent.resolve();
        if (!parentResult.ok) {
            throw new Error('Failed to resolve parent account');
        }
        const accountId = parentResult.value.id;
        if (!accountId) {
            throw new Error('Account has no ID');
        }
        const jxa = Application('Mail');
        const appMailbox = jxa[entry.jxaProperty]();
        const accountMailbox = appMailbox.mailboxes().find((m) => {
            try {
                return m.account().id() === accountId;
            }
            catch {
                return false;
            }
        });
        if (!accountMailbox) {
            throw new Error(`No ${entry.jxaProperty} mailbox found for account`);
        }
        return createSchemaSpecifier(uri, accountMailbox, MailboxSchema, 'Mailbox');
    }
    catch (error) {
        throw new Error(`Failed to navigate to account mailbox: ${error}`);
    }
}
/// <reference path="../framework/schema.ts" />
/// <reference path="../framework/specifier.ts" />
/// <reference path="../framework/runtime.ts" />
/// <reference path="../framework/uri.ts" />
/// <reference path="../framework/routes.ts" />
// ============================================================================
// URI Completions Support
// Autocomplete functionality for partial URIs
// Route-table based for fast, schema-driven completions
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
    const routes = getRoutesForScheme(scheme);
    if (!routes)
        return [];
    // Check if we're in a query string
    const queryIdx = path.indexOf('?');
    if (queryIdx !== -1) {
        return getRouteQueryCompletions(scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1), routes);
    }
    return getRouteBasedPathCompletions(scheme, path, routes);
}
// ============================================================================
// Route-Table Based Path Completions
// ============================================================================
function getRouteBasedPathCompletions(scheme, path, routes) {
    const completions = [];
    // Split path to find partial segment
    const segments = path.split('/');
    const partialSegment = segments.pop() || '';
    const completePath = segments.join('/');
    // Parse parent path to find current route node
    const parentUri = `${scheme}://${completePath}`;
    const parseResult = parseURIWithRoutes(parentUri, routes);
    if (!parseResult.ok)
        return [];
    const currentNode = parseResult.route;
    // Get children from route table
    const children = isRootEntry(currentNode.entry)
        ? currentNode.children
        : getRouteChildren(currentNode, routes);
    // Add matching route children
    for (const [name, node] of Object.entries(children)) {
        if (!name.toLowerCase().startsWith(partialSegment.toLowerCase()))
            continue;
        const entry = node.entry;
        let description;
        let suffix = '';
        if (isCollectionEntry(entry)) {
            suffix = '/';
            description = 'Collection';
        }
        else if (isVirtualPropEntry(entry)) {
            suffix = '/';
            description = entry.accountScoped ? 'Account mailbox' : 'Mailbox';
        }
        else if (isVirtualCtxEntry(entry)) {
            suffix = '/';
            description = 'Context';
        }
        else if (isPropertyEntry(entry)) {
            description = `${entry.valueType} property`;
            if (entry.lazy)
                description += ' (lazy)';
            if (entry.rw)
                description += ' (rw)';
        }
        else if (isComputedEntry(entry)) {
            description = 'Computed property';
        }
        else {
            description = 'Entry';
        }
        completions.push({
            value: name + suffix,
            label: name,
            description,
        });
    }
    // If current node is a collection, add addressing options and real item names
    if (isCollectionEntry(currentNode.entry)) {
        const collEntry = currentNode.entry;
        // Add real names from resolved collection (if accessible)
        if (collEntry.addressing.includes('name') || collEntry.addressing.includes('id')) {
            try {
                const resolved = specifierFromURI(parentUri);
                if (resolved.ok && typeof resolved.value.resolve === 'function') {
                    const items = resolved.value.resolve();
                    if (items.ok && Array.isArray(items.value)) {
                        for (const item of items.value.slice(0, 10)) {
                            const itemName = item.name;
                            if (itemName && String(itemName).toLowerCase().startsWith(partialSegment.toLowerCase())) {
                                completions.push({
                                    value: encodeURIComponent(String(itemName)),
                                    label: String(itemName),
                                    description: 'By name',
                                });
                            }
                        }
                    }
                }
            }
            catch { /* ignore resolution errors */ }
        }
        // Add index notation
        if (collEntry.addressing.includes('index')) {
            if (partialSegment.match(/^\[?\d*\]?$/) || completions.length === 0) {
                completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
            }
        }
        // Add query option
        if (partialSegment === '' || partialSegment === '?') {
            completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
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
    // Virtual mailboxes - declarative instead of hooks
    inbox: accountScopedMailbox('inbox'),
    sent: accountScopedMailbox('sentMailbox'),
    drafts: accountScopedMailbox('draftsMailbox'),
    junk: accountScopedMailbox('junkMailbox'),
    trash: accountScopedMailbox('trashMailbox'),
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
    settings: namespace(SettingsSchema),
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
registerScheme('mail', getMailApp, MailAppSchema, {
    StandardMailbox: StandardMailboxSchema,
    Mailbox: MailboxSchema,
    Settings: SettingsSchema,
    Account: AccountSchema,
    Message: MessageSchema,
    Recipient: RecipientSchema,
    Attachment: AttachmentSchema,
    Rule: RuleSchema,
    RuleCondition: RuleConditionSchema,
    Signature: SignatureSchema,
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
        // Return null to trigger JSON-RPC error response
        return null;
    }
    const result = spec.value.resolve();
    if (!result.ok) {
        // Return null to trigger JSON-RPC error response
        return null;
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
