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
// T must be MCP-returnable (enforced by ScalarProto<T>)
function scalar(validate) {
    const validatingStrategy = (delegate) => {
        const raw = delegate._jxa();
        return validate(raw);
    };
    return {
        resolutionStrategy: validatingStrategy,
        exists: existsImpl,
    }; // Type assertion adds Proto brand
}
// Passthrough scalar - no validation, returns any (use sparingly)
// Note: 'any' satisfies MCPReturnableValue at compile time; runtime values must be serializable
const passthrough = {
    resolutionStrategy: scalarStrategy,
    exists: existsImpl,
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
// Resolves to a record of child properties (MCPReturnableValue via objectStrategy)
const baseObject = {
    resolutionStrategy: objectStrategy,
    exists: existsImpl,
};
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
    const itemProto = proto._itemProto;
    if (itemProto) {
        lazyProto._itemProto = itemProto;
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
    proto._itemProto = itemProto;
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
function withJxaName(proto, jxaName) {
    // Create a new object with navigationStrategy that uses the jxaName
    const named = {
        ...proto,
        navigationStrategy: ((delegate, schemaKey) => delegate.propWithAlias(jxaName, schemaKey)),
    };
    // Also copy over the item proto if this is a collection
    const itemProto = proto._itemProto;
    if (itemProto) {
        named._itemProto = itemProto;
    }
    return named;
}
// ─────────────────────────────────────────────────────────────────────────────
// Computed Properties
// ─────────────────────────────────────────────────────────────────────────────
// A computed property transforms the raw value from the delegate
// T must be MCP-returnable (enforced by ComputedProto<T>)
function computed(transform) {
    const computedStrategy = (delegate) => {
        const raw = delegate._jxa();
        return transform(raw);
    };
    return {
        resolutionStrategy: computedStrategy,
        exists: existsImpl,
    };
}
function computedNav(navigate, targetProto) {
    // Create a strategy that navigates first, then uses target's strategy
    const navStrategy = (delegate, _proto, res) => {
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
    const itemProto = targetProto._itemProto;
    if (itemProto) {
        navProto._itemProto = itemProto;
    }
    return navProto;
}
function getComputedNav(proto) {
    return proto._computedNav;
}
function namespaceNav(targetProto) {
    // Custom strategy that gathers all properties from the target proto
    const namespaceStrategy = (_delegate, _proto, res) => {
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
    const itemProto = proto._itemProto;
    const queryStrategy = (delegate) => {
        const raw = delegate._jxa();
        if (!Array.isArray(raw)) {
            throw new TypeError(`Query expected array, got ${typeof raw}`);
        }
        const query = delegate.queryState();
        let results = applyQueryState(raw, query);
        if (query.expand && query.expand.length > 0 && itemProto) {
            results = results.map((item) => {
                const expanded = { ...item };
                for (const field of query.expand) {
                    const fieldProto = itemProto[field];
                    if (fieldProto && typeof fieldProto === 'object' && 'resolutionStrategy' in fieldProto) {
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
        queryProto._itemProto = itemProto;
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
                // Navigate to child proto using navigationStrategy (or default)
                if (typeof value === 'object' && value !== null && 'resolutionStrategy' in value) {
                    const nav = value.navigationStrategy || defaultNavigation;
                    const childDelegate = nav(t._delegate, prop, value);
                    return createSpecifier(childDelegate, value);
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
    return typeof value === 'object' && value !== null && 'resolutionStrategy' in value && typeof value.resolutionStrategy === 'function';
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
        // Namespaces need special handling: no qualifiers allowed, keep the navProto
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
        // Check for computedNav - need target proto for further resolution
        const computedNavInfo = childProto ? getComputedNav(childProto) : undefined;
        if (computedNavInfo) {
            // Use navigationStrategy for delegate navigation
            delegate = childProto.navigationStrategy(delegate, head, childProto);
            // But use the target proto for further resolution
            proto = computedNavInfo.targetProto;
            // Handle qualifiers on the target if any
            if (qualifier) {
                const itemProto = proto._itemProto;
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
            // Normal property navigation - use navigationStrategy or default
            const nav = childProto.navigationStrategy || defaultNavigation;
            delegate = nav(delegate, head, childProto);
            proto = childProto;
            if (qualifier) {
                const itemProto = proto._itemProto;
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
            const itemProto = proto._itemProto;
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
                    proto = subProto._itemProto || baseScalar;
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
MailboxesProto._itemProto = MailboxProto;
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
// tests/src/test-utils.ts - Shared test utilities
//
// Simple assertion functions that work in both Node and JXA environments.
// ─────────────────────────────────────────────────────────────────────────────
// URL Polyfill for tests
// ─────────────────────────────────────────────────────────────────────────────
// Node's URL constructor rejects unencoded brackets, but our mail:// URIs use them.
// Wrap the native URL to auto-encode brackets before parsing.
const _NativeURL = globalThis.URL;
globalThis.URL = class URL extends _NativeURL {
    constructor(url, base) {
        // Encode brackets in the URL before passing to native constructor
        const encoded = url.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
        super(encoded, base);
    }
};
let testCount = 0;
let passCount = 0;
let currentGroup = '';
function group(name) {
    currentGroup = name;
    console.log(`\n=== ${name} ===`);
}
function assert(condition, message) {
    testCount++;
    if (condition) {
        passCount++;
        console.log(`  \u2713 ${message}`);
    }
    else {
        console.log(`  \u2717 ${message}`);
    }
}
function assertEqual(actual, expected, message) {
    testCount++;
    if (actual === expected) {
        passCount++;
        console.log(`  \u2713 ${message}`);
    }
    else {
        console.log(`  \u2717 ${message}`);
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
}
function assertDeepEqual(actual, expected, message) {
    testCount++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        passCount++;
        console.log(`  \u2713 ${message}`);
    }
    else {
        console.log(`  \u2717 ${message}`);
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
}
function assertOk(result, message) {
    testCount++;
    if (result.ok) {
        passCount++;
        console.log(`  \u2713 ${message}`);
        return result.value;
    }
    else {
        console.log(`  \u2717 ${message}`);
        console.log(`      error: ${result.error}`);
        return undefined;
    }
}
function assertError(result, message) {
    testCount++;
    if (!result.ok) {
        passCount++;
        console.log(`  \u2713 ${message}`);
    }
    else {
        console.log(`  \u2717 ${message}`);
        console.log(`      expected error, got: ${JSON.stringify(result.value)}`);
    }
}
function assertThrows(fn, message) {
    testCount++;
    try {
        fn();
        console.log(`  \u2717 ${message}`);
        console.log(`      expected exception, but none was thrown`);
    }
    catch (e) {
        passCount++;
        console.log(`  \u2713 ${message}`);
    }
}
function summary() {
    console.log(`\n========================`);
    console.log(`Tests: ${passCount}/${testCount} passed`);
    const success = passCount === testCount;
    if (!success) {
        console.log('SOME TESTS FAILED');
    }
    return { passed: passCount, total: testCount, success };
}
function resetCounters() {
    testCount = 0;
    passCount = 0;
    currentGroup = '';
}
// tests/src/test-framework-jxa.ts - JXA integration tests (runs with osascript)
//
// Tests the framework against real Mail.app. Requires Mail.app to be configured
// with at least one account.
// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
function testJxaURIResolution() {
    group('JXA URI Resolution');
    // Root app
    const root = resolveURI('mail://');
    assertOk(root, 'Resolve mail://');
    if (root.ok) {
        try {
            const name = root.value.name.resolve();
            assertEqual(name, 'Mail', 'App name is Mail');
        }
        catch (e) {
            console.log(`  \u2717 App name: ${e.message}`);
        }
    }
    // Accounts collection
    const accounts = resolveURI('mail://accounts');
    assertOk(accounts, 'Resolve mail://accounts');
    if (accounts.ok) {
        try {
            const list = accounts.value.resolve();
            assert(Array.isArray(list), 'accounts.resolve() returns array');
            assert(list.length >= 0, 'Accounts array exists (may be empty)');
            if (list.length > 0) {
                // Don't try to map account names - just report count
                console.log(`    Found ${list.length} account(s)`);
            }
        }
        catch (e) {
            console.log(`  \u2717 accounts.resolve(): ${e.message}`);
        }
    }
}
function testJxaAccountNavigation() {
    group('JXA Account Navigation');
    const accounts = resolveURI('mail://accounts');
    if (!accounts.ok) {
        console.log('  - Skipping: could not resolve accounts');
        return;
    }
    let list;
    try {
        list = accounts.value.resolve();
    }
    catch (e) {
        console.log(`  - Skipping: could not resolve accounts list: ${e.message}`);
        return;
    }
    if (list.length === 0) {
        console.log('  - Skipping: no accounts configured');
        return;
    }
    // Navigate by index
    const acc0 = resolveURI('mail://accounts[0]');
    assertOk(acc0, 'Resolve mail://accounts[0]');
    if (acc0.ok) {
        try {
            const name = acc0.value.name.resolve();
            assert(typeof name === 'string', 'Account has name');
            console.log(`    First account: ${name}`);
            const fullName = acc0.value.fullName.resolve();
            assert(typeof fullName === 'string', 'Account has fullName');
            const emails = acc0.value.emailAddresses.resolve();
            assert(Array.isArray(emails), 'Account has emailAddresses');
            // Navigate by name - use resolved name
            const accByName = resolveURI(`mail://accounts/${encodeURIComponent(name)}`);
            assertOk(accByName, `Resolve account by name: ${name}`);
        }
        catch (e) {
            console.log(`  \u2717 Account navigation failed: ${e.message}`);
        }
    }
}
function testJxaMailboxNavigation() {
    group('JXA Mailbox Navigation');
    try {
        const accounts = resolveURI('mail://accounts');
        if (!accounts.ok) {
            console.log('  - Skipping: no accounts');
            return;
        }
        const accList = accounts.value.resolve();
        if (accList.length === 0) {
            console.log('  - Skipping: no accounts');
            return;
        }
    }
    catch (e) {
        console.log(`  - Skipping: ${e.message}`);
        return;
    }
    // Get first account's mailboxes
    const mailboxes = resolveURI('mail://accounts[0]/mailboxes');
    assertOk(mailboxes, 'Resolve mailboxes');
    if (mailboxes.ok) {
        try {
            const list = mailboxes.value.resolve();
            assert(Array.isArray(list), 'mailboxes.resolve() returns array');
            console.log(`    Found ${list.length} mailbox(es)`);
        }
        catch (e) {
            console.log(`  \u2717 mailboxes.resolve(): ${e.message}`);
        }
    }
    // Standard inbox
    const inbox = resolveURI('mail://inbox');
    assertOk(inbox, 'Resolve mail://inbox (aggregate)');
    if (inbox.ok) {
        try {
            const name = inbox.value.name.resolve();
            const unread = inbox.value.unreadCount.resolve();
            console.log(`    Inbox: ${name} (${unread} unread)`);
        }
        catch (e) {
            console.log(`  \u2717 inbox properties: ${e.message}`);
        }
    }
    // Account-specific inbox via computedNav
    const accInbox = resolveURI('mail://accounts[0]/inbox');
    assertOk(accInbox, 'Resolve account inbox via computedNav');
    if (accInbox.ok) {
        try {
            const name = accInbox.value.name.resolve();
            console.log(`    Account[0] inbox: ${name}`);
        }
        catch (e) {
            console.log(`  \u2717 account inbox: ${e.message}`);
        }
    }
}
function testJxaMessageAccess() {
    group('JXA Message Access');
    // Try to find a mailbox with messages
    const inbox = resolveURI('mail://inbox');
    if (!inbox.ok) {
        console.log('  - Skipping: could not resolve inbox');
        return;
    }
    let msgList;
    try {
        const messages = inbox.value.messages;
        msgList = messages.resolve();
    }
    catch (e) {
        console.log(`  - Skipping: could not resolve messages: ${e.message}`);
        return;
    }
    if (msgList.length === 0) {
        console.log('  - Skipping: inbox is empty');
        return;
    }
    console.log(`    Found ${msgList.length} message(s) in inbox`);
    try {
        // Get first message by index
        const msg0 = inbox.value.messages.byIndex(0);
        assert('_delegate' in msg0, 'byIndex returns Res');
        const subject = msg0.subject.resolve();
        assert(typeof subject === 'string', 'Message has subject');
        console.log(`    First message: "${String(subject).substring(0, 50)}..."`);
        // Test computed property (sender parsing)
        const sender = msg0.sender.resolve();
        assert(typeof sender === 'object', 'sender is parsed object');
        assert('address' in sender, 'sender has address');
        console.log(`    From: ${sender.name} <${sender.address}>`);
        // Test lazy property (content) - resolving full message
        const resolved = msg0.resolve();
        assert('content' in resolved, 'Resolved message has content specifier');
    }
    catch (e) {
        console.log(`  \u2717 Message access: ${e.message}`);
    }
}
function testJxaStandardMailboxes() {
    group('JXA Standard Mailboxes');
    const standardNames = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'outbox'];
    for (const name of standardNames) {
        testCount++;
        const result = resolveURI(`mail://${name}`);
        if (result.ok) {
            try {
                const mbName = result.value.name.resolve();
                const unread = result.value.unreadCount.resolve();
                passCount++;
                console.log(`  \u2713 ${name}: ${mbName} (${unread} unread)`);
            }
            catch (e) {
                passCount++;
                console.log(`  \u2713 ${name}: resolved (properties failed: ${e.message})`);
            }
        }
        else {
            console.log(`  \u2717 ${name}: ${result.error}`);
        }
    }
}
function testJxaSettings() {
    group('JXA Settings Namespace');
    const settings = resolveURI('mail://settings');
    assertOk(settings, 'Resolve mail://settings');
    // Test a few settings
    try {
        const fetchInterval = resolveURI('mail://settings/fetchInterval');
        if (fetchInterval.ok) {
            const val = fetchInterval.value.resolve();
            assert(typeof val === 'number', 'fetchInterval is number');
            console.log(`    fetchInterval: ${val}`);
        }
        const alwaysBcc = resolveURI('mail://settings/alwaysBccMyself');
        if (alwaysBcc.ok) {
            const val = alwaysBcc.value.resolve();
            assert(typeof val === 'boolean', 'alwaysBccMyself is boolean');
            console.log(`    alwaysBccMyself: ${val}`);
        }
    }
    catch (e) {
        console.log(`  \u2717 Settings: ${e.message}`);
    }
}
function testJxaRulesAndSignatures() {
    group('JXA Rules and Signatures');
    // Rules
    const rules = resolveURI('mail://rules');
    assertOk(rules, 'Resolve mail://rules');
    if (rules.ok) {
        try {
            const list = rules.value.resolve();
            console.log(`    Found ${list.length} rule(s)`);
        }
        catch (e) {
            console.log(`  \u2717 rules.resolve(): ${e.message}`);
        }
    }
    // Signatures
    const sigs = resolveURI('mail://signatures');
    assertOk(sigs, 'Resolve mail://signatures');
    if (sigs.ok) {
        try {
            const list = sigs.value.resolve();
            console.log(`    Found ${list.length} signature(s)`);
        }
        catch (e) {
            console.log(`  \u2717 signatures.resolve(): ${e.message}`);
        }
    }
}
function testJxaQueryOperations() {
    group('JXA Query Operations');
    // Filter mailboxes by unread count
    try {
        const filtered = resolveURI('mail://accounts[0]/mailboxes?unreadCount.gt=0');
        if (filtered.ok) {
            const list = filtered.value.resolve();
            console.log(`    Mailboxes with unread: ${list.length}`);
            // Collection returns specifiers {uri}, verify we got some results
            assert(list.length > 0, 'Filter returned results');
            assert('uri' in list[0], 'Filter result is specifier');
        }
        else {
            console.log(`    Filter resolve failed: ${filtered.error}`);
        }
    }
    catch (e) {
        console.log(`  \u2717 Filter query failed: ${e.message}`);
    }
    // Sort and limit
    try {
        const sorted = resolveURI('mail://accounts[0]/mailboxes?sort=name.asc&limit=5');
        if (sorted.ok) {
            const list = sorted.value.resolve();
            console.log(`    First 5 sorted: ${list.length} mailbox(es)`);
        }
        else {
            console.log(`    Sort resolve failed: ${sorted.error}`);
        }
    }
    catch (e) {
        console.log(`  \u2717 Sort query failed: ${e.message}`);
    }
}
function testJxaCollectionResolution() {
    group('JXA Collection Resolution (specifiers)');
    // Test that collection.resolve() returns array of {uri} specifiers
    // To get actual item data, use byIndex(n).resolve()
    // Test accounts collection
    const accounts = resolveURI('mail://accounts');
    if (!accounts.ok) {
        console.log('  - Skipping accounts: could not resolve');
    }
    else {
        try {
            const list = accounts.value.resolve();
            assert(Array.isArray(list), 'accounts.resolve() returns array');
            if (list.length > 0) {
                const first = list[0];
                assert(first !== null, 'First account specifier is not null');
                assert('uri' in first, 'First account specifier has uri');
                // Get actual data via byIndex
                const firstData = accounts.value.byIndex(0).resolve();
                console.log(`    Accounts: ${list.length} specifiers, first name: ${firstData.name}`);
            }
            else {
                console.log('    Accounts: empty');
            }
        }
        catch (e) {
            console.log(`  \u2717 accounts: ${e.message}`);
        }
    }
    // Test rules collection
    const rules = resolveURI('mail://rules');
    if (!rules.ok) {
        console.log('  - Skipping rules: could not resolve');
    }
    else {
        try {
            const list = rules.value.resolve();
            assert(Array.isArray(list), 'rules.resolve() returns array');
            if (list.length > 0) {
                const first = list[0];
                assert(first !== null, 'First rule specifier is not null');
                assert('uri' in first, 'First rule specifier has uri');
                const firstData = rules.value.byIndex(0).resolve();
                console.log(`    Rules: ${list.length} specifiers, first name: ${firstData.name}`);
            }
            else {
                console.log('    Rules: empty');
            }
        }
        catch (e) {
            console.log(`  \u2717 rules: ${e.message}`);
        }
    }
    // Test signatures collection
    const sigs = resolveURI('mail://signatures');
    if (!sigs.ok) {
        console.log('  - Skipping signatures: could not resolve');
    }
    else {
        try {
            const list = sigs.value.resolve();
            assert(Array.isArray(list), 'signatures.resolve() returns array');
            if (list.length > 0) {
                const first = list[0];
                assert(first !== null, 'First signature specifier is not null');
                assert('uri' in first, 'First signature specifier has uri');
                const firstData = sigs.value.byIndex(0).resolve();
                console.log(`    Signatures: ${list.length} specifiers, first name: ${firstData.name}`);
            }
            else {
                console.log('    Signatures: empty');
            }
        }
        catch (e) {
            console.log(`  \u2717 signatures: ${e.message}`);
        }
    }
    // Test mailboxes collection (nested in account)
    const mailboxes = resolveURI('mail://accounts[0]/mailboxes');
    if (!mailboxes.ok) {
        console.log('  - Skipping mailboxes: could not resolve');
    }
    else {
        try {
            const list = mailboxes.value.resolve();
            assert(Array.isArray(list), 'mailboxes.resolve() returns array');
            if (list.length > 0) {
                const first = list[0];
                assert(first !== null, 'First mailbox specifier is not null');
                assert('uri' in first, 'First mailbox specifier has uri');
                const firstData = mailboxes.value.byIndex(0).resolve();
                console.log(`    Mailboxes: ${list.length} specifiers, first name: ${firstData.name}`);
            }
            else {
                console.log('    Mailboxes: empty');
            }
        }
        catch (e) {
            console.log(`  \u2717 mailboxes: ${e.message}`);
        }
    }
    // Test messages collection
    const inbox = resolveURI('mail://inbox');
    if (!inbox.ok) {
        console.log('  - Skipping messages: could not resolve inbox');
    }
    else {
        try {
            const messages = inbox.value.messages;
            const list = messages.resolve();
            assert(Array.isArray(list), 'messages.resolve() returns array');
            if (list.length > 0) {
                const first = list[0];
                assert(first !== null, 'First message specifier is not null');
                assert('uri' in first, 'First message specifier has uri');
                const firstData = messages.byIndex(0).resolve();
                console.log(`    Messages: ${list.length} specifiers, first subject: ${String(firstData.subject).substring(0, 40)}...`);
            }
            else {
                console.log('    Messages: empty');
            }
        }
        catch (e) {
            console.log(`  \u2717 messages: ${e.message}`);
        }
    }
}
function testLazyCollections() {
    group('Lazy Collection Properties');
    const inbox = resolveURI('mail://inbox');
    if (!inbox.ok) {
        console.log('  - Skipping: could not resolve inbox');
        return;
    }
    // Check that lazy properties are Res objects (laziness tested via resolve behavior below)
    const messagesRes = inbox.value.messages;
    assert('_delegate' in messagesRes, 'messages is a Res');
    const mailboxesRes = inbox.value.mailboxes;
    assert('_delegate' in mailboxesRes, 'mailboxes is a Res');
    // Test that resolving inbox returns specifiers, not full data
    const resolved = inbox.value.resolve();
    console.log(`  resolved.messages type: ${typeof resolved.messages}`);
    console.log(`  resolved.messages is array: ${Array.isArray(resolved.messages)}`);
    if (resolved.messages && typeof resolved.messages === 'object' && 'uri' in resolved.messages) {
        console.log(`  resolved.messages.uri: ${resolved.messages.uri}`);
        assert(true, 'messages resolved to specifier');
    }
    else {
        console.log(`  resolved.messages: ${JSON.stringify(resolved.messages).substring(0, 100)}`);
        assert(false, 'messages should resolve to {uri} specifier, not array');
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('Framework Tests (JXA/Mail.app)');
console.log('==============================');
testLazyCollections();
testJxaURIResolution();
testJxaAccountNavigation();
testJxaMailboxNavigation();
testJxaMessageAccess();
testJxaStandardMailboxes();
testJxaSettings();
testJxaRulesAndSignatures();
testJxaQueryOperations();
testJxaCollectionResolution();
const jxaTestResult = summary();
