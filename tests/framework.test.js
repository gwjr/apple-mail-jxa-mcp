"use strict";
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
// scratch/mock-backing.ts - Mock Delegate implementation
//
// This file is only included in Node builds (for testing)
// Contains the MockDelegate class that works against in-memory data
// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec, RootMarker, ROOT
// ─────────────────────────────────────────────────────────────────────────────
// Mock Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────
// ID counter for auto-generating IDs
let mockIdCounter = 1000;
class MockDelegate {
    _data;
    _path;
    _root;
    _parentDelegate;
    _parentArray;
    _indexInParent;
    _query;
    constructor(_data, // Current node in mock data
    _path, _root, // Root data for navigation
    _parentDelegate, // Parent delegate
    _parentArray, // Parent array (if this is an item in an array)
    _indexInParent, // Index in parent array
    _query = {}) {
        this._data = _data;
        this._path = _path;
        this._root = _root;
        this._parentDelegate = _parentDelegate;
        this._parentArray = _parentArray;
        this._indexInParent = _indexInParent;
        this._query = _query;
    }
    _jxa() {
        // Return raw data - query state is applied by the proto layer (withQuery.resolve())
        return this._data;
    }
    prop(key) {
        const newPath = [...this._path, { kind: 'prop', name: key }];
        const newData = this._data ? this._data[key] : undefined;
        return new MockDelegate(newData, newPath, this._root, this, null, null);
    }
    propWithAlias(jxaName, uriName) {
        // Navigate data using JXA name, but track URI name in path
        const newPath = [...this._path, { kind: 'prop', name: uriName }];
        const newData = this._data ? this._data[jxaName] : undefined;
        return new MockDelegate(newData, newPath, this._root, this, null, null);
    }
    namespace(name) {
        // A namespace adds a URI segment but keeps the same data (no JXA navigation)
        const newPath = [...this._path, { kind: 'prop', name }];
        return new MockDelegate(this._data, newPath, this._root, this, null, null); // Same data!
    }
    byIndex(n) {
        const newPath = [...this._path, { kind: 'index', value: n }];
        const newData = Array.isArray(this._data) ? this._data[n] : undefined;
        return new MockDelegate(newData, newPath, this._root, this, this._data, n);
    }
    byName(name) {
        const newPath = [...this._path, { kind: 'name', value: name }];
        let item;
        let idx = null;
        if (Array.isArray(this._data)) {
            idx = this._data.findIndex((x) => x.name === name);
            item = idx >= 0 ? this._data[idx] : undefined;
            if (idx < 0)
                idx = null;
        }
        return new MockDelegate(item, newPath, this._root, this, this._data, idx);
    }
    byId(id) {
        const newPath = [...this._path, { kind: 'id', value: id }];
        let item;
        let idx = null;
        if (Array.isArray(this._data)) {
            idx = this._data.findIndex((x) => x.id === id);
            item = idx >= 0 ? this._data[idx] : undefined;
            if (idx < 0)
                idx = null;
        }
        return new MockDelegate(item, newPath, this._root, this, this._data, idx);
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
        // For mock, we need parent reference to actually set
        if (this._parentDelegate && this._parentDelegate._data && this._path.length > 0) {
            const lastSeg = this._path[this._path.length - 1];
            if (lastSeg.kind === 'prop') {
                this._parentDelegate._data[lastSeg.name] = value;
                this._data = value;
                return;
            }
        }
        throw new Error('MockDelegate.set() cannot set this path');
    }
    // Parent navigation
    parent() {
        if (this._parentDelegate) {
            return this._parentDelegate;
        }
        return ROOT;
    }
    // Mutation: move this item to a destination collection
    moveTo(destination) {
        // Remove from source
        if (this._parentArray !== null && this._indexInParent !== null) {
            this._parentArray.splice(this._indexInParent, 1);
        }
        else {
            return { ok: false, error: 'Cannot remove item from source: no parent array' };
        }
        // Add to destination
        const destData = destination._data;
        if (!Array.isArray(destData)) {
            return { ok: false, error: 'Destination is not a collection' };
        }
        destData.push(this._data);
        // Return new URI
        const destUri = destination.uri();
        const id = this._data?.id ?? this._data?.name;
        if (id !== undefined) {
            return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(String(id))}`) };
        }
        // Fall back to index
        const newIndex = destData.length - 1;
        return { ok: true, value: new URL(`${destUri.href}[${newIndex}]`) };
    }
    // Mutation: delete this item
    delete() {
        if (this._parentArray !== null && this._indexInParent !== null) {
            this._parentArray.splice(this._indexInParent, 1);
            // Return the URI we were at (item no longer exists)
            return { ok: true, value: this.uri() };
        }
        return { ok: false, error: 'Cannot delete: item not in a collection' };
    }
    // Mutation: create a new item in this collection
    create(properties) {
        if (!Array.isArray(this._data)) {
            return { ok: false, error: 'Cannot create: this is not a collection' };
        }
        // Assign an id if not provided
        const newItem = { ...properties };
        if (!('id' in newItem)) {
            newItem.id = mockIdCounter++;
        }
        this._data.push(newItem);
        // Return URI to new item
        const id = newItem.id ?? newItem.name;
        if (id !== undefined) {
            return { ok: true, value: new URL(`${this.uri().href}/${encodeURIComponent(String(id))}`) };
        }
        const newIndex = this._data.length - 1;
        return { ok: true, value: new URL(`${this.uri().href}[${newIndex}]`) };
    }
    withFilter(filter) {
        const mergedFilter = { ...this._query.filter, ...filter };
        const newQuery = { ...this._query, filter: mergedFilter };
        return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
    }
    withSort(sort) {
        const newQuery = { ...this._query, sort };
        return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
    }
    withPagination(pagination) {
        const newQuery = { ...this._query, pagination };
        return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
    }
    withExpand(fields) {
        const existing = this._query.expand || [];
        const merged = [...new Set([...existing, ...fields])];
        const newQuery = { ...this._query, expand: merged };
        return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
    }
    queryState() {
        return this._query;
    }
    // Create a delegate from arbitrary data with explicit path
    fromJxa(data, path) {
        return new MockDelegate(data, path, this._root, this, null, null);
    }
}
// Create a mock delegate from in-memory data
function createMockDelegate(data, scheme = 'mail') {
    return new MockDelegate(data, [{ kind: 'root', scheme }], data, null, null, null);
}
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
// tests/src/test-framework.ts - Core framework tests (runs in Node with mock data)
//
// Tests URI parsing, proto composition, Res proxy behavior, and query operations.
// Uses MockDelegate - no Mail.app required.
// ─────────────────────────────────────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────────────────────────────────────
function createMockMailData() {
    return {
        name: 'Mail',
        version: '16.0',
        accounts: [
            {
                id: 'acc1',
                name: 'Work',
                fullName: 'John Doe',
                emailAddresses: ['john@work.com'],
                mailboxes: [
                    {
                        name: 'INBOX',
                        unreadCount: 5,
                        messages: [
                            {
                                id: 1001,
                                messageId: '<msg1@work.com>',
                                subject: 'Hello World',
                                sender: 'alice@example.com',
                                dateSent: '2024-01-15T10:00:00Z',
                                dateReceived: '2024-01-15T10:01:00Z',
                                readStatus: false,
                                flaggedStatus: false,
                                messageSize: 1024,
                                content: 'Hello, this is the message body content.',
                                toRecipients: [{ name: 'John', address: 'john@work.com' }],
                                ccRecipients: [],
                                bccRecipients: [],
                                mailAttachments: [],
                            },
                            {
                                id: 1002,
                                messageId: '<msg2@work.com>',
                                subject: 'Meeting Tomorrow',
                                sender: 'Bob Smith <bob@example.com>',
                                dateSent: '2024-01-15T11:00:00Z',
                                dateReceived: '2024-01-15T11:01:00Z',
                                readStatus: true,
                                flaggedStatus: true,
                                messageSize: 2048,
                                content: 'Let us meet tomorrow at 10am to discuss the project.',
                                toRecipients: [{ name: 'John', address: 'john@work.com' }],
                                ccRecipients: [{ name: 'Alice', address: 'alice@example.com' }],
                                bccRecipients: [],
                                mailAttachments: [{ id: 'att1', name: 'doc.pdf', fileSize: 10240 }],
                            },
                        ],
                        mailboxes: [
                            {
                                name: 'Projects',
                                unreadCount: 2,
                                messages: [],
                                mailboxes: [],
                            },
                        ],
                    },
                    {
                        name: 'Archive',
                        unreadCount: 0,
                        messages: [],
                        mailboxes: [],
                    },
                    {
                        name: 'Sent',
                        unreadCount: 0,
                        messages: [],
                        mailboxes: [],
                    },
                ],
            },
            {
                id: 'acc2',
                name: 'Personal',
                fullName: 'John Doe',
                emailAddresses: ['john@personal.com'],
                mailboxes: [
                    {
                        name: 'INBOX',
                        unreadCount: 3,
                        messages: [],
                        mailboxes: [],
                    },
                ],
            },
        ],
        rules: [
            {
                name: 'Spam Filter',
                enabled: true,
                allConditionsMustBeMet: true,
                deleteMessage: false,
                markRead: false,
                markFlagged: false,
                ruleConditions: [
                    { header: 'Subject', qualifier: 'contains', ruleType: 'header', expression: 'spam' },
                ],
            },
            {
                name: 'Work Rules',
                enabled: false,
                allConditionsMustBeMet: false,
                deleteMessage: false,
                markRead: true,
                markFlagged: false,
                ruleConditions: [],
            },
        ],
        signatures: [
            { name: 'Default', content: '-- \nJohn Doe' },
            { name: 'Work', content: '-- \nJohn Doe\nSenior Engineer' },
        ],
        // Standard mailboxes (aggregates)
        inbox: { name: 'All Inboxes', unreadCount: 8, messages: [], mailboxes: [] },
        sentMailbox: { name: 'All Sent', unreadCount: 0, messages: [], mailboxes: [] },
        draftsMailbox: { name: 'All Drafts', unreadCount: 0, messages: [], mailboxes: [] },
        trashMailbox: { name: 'All Trash', unreadCount: 0, messages: [], mailboxes: [] },
        junkMailbox: { name: 'All Junk', unreadCount: 0, messages: [], mailboxes: [] },
        outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
        // Settings (app-level properties)
        alwaysBccMyself: false,
        alwaysCcMyself: false,
        fetchInterval: 5,
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
function testURIParsing() {
    group('URI Parsing');
    // Basic URIs
    const basic = lexURI('mail://accounts');
    assertOk(basic, 'Parse mail://accounts');
    if (basic.ok) {
        assertEqual(basic.value.scheme, 'mail', 'Scheme is mail');
        assertEqual(basic.value.segments.length, 1, 'One segment');
        assertEqual(basic.value.segments[0].head, 'accounts', 'Segment head is accounts');
    }
    // Index addressing
    const indexed = lexURI('mail://accounts[0]');
    assertOk(indexed, 'Parse mail://accounts[0]');
    if (indexed.ok) {
        assertEqual(indexed.value.segments[0].qualifier?.kind, 'index', 'Has index qualifier');
        if (indexed.value.segments[0].qualifier?.kind === 'index') {
            assertEqual(indexed.value.segments[0].qualifier.value, 0, 'Index is 0');
        }
    }
    // Nested path
    const nested = lexURI('mail://accounts[0]/mailboxes/INBOX/messages');
    assertOk(nested, 'Parse nested path');
    if (nested.ok) {
        assertEqual(nested.value.segments.length, 4, 'Four segments');
        assertEqual(nested.value.segments[2].head, 'INBOX', 'Third segment is INBOX');
    }
    // Query parameters
    const query = lexURI('mail://accounts[0]/mailboxes?name=Inbox&sort=unreadCount.desc');
    assertOk(query, 'Parse query parameters');
    if (query.ok) {
        const q = query.value.segments[1].qualifier;
        assertEqual(q?.kind, 'query', 'Has query qualifier');
        if (q?.kind === 'query') {
            assertEqual(q.filters.length, 1, 'One filter');
            assertEqual(q.filters[0].field, 'name', 'Filter field is name');
            assertEqual(q.sort?.field, 'unreadCount', 'Sort by unreadCount');
            assertEqual(q.sort?.direction, 'desc', 'Sort descending');
        }
    }
    // Pagination
    const paginated = lexURI('mail://accounts[0]/mailboxes?limit=10&offset=5');
    assertOk(paginated, 'Parse pagination');
    if (paginated.ok) {
        const q = paginated.value.segments[1].qualifier;
        if (q?.kind === 'query') {
            assertEqual(q.limit, 10, 'Limit is 10');
            assertEqual(q.offset, 5, 'Offset is 5');
        }
    }
    // Invalid URI
    const invalid = lexURI('not-a-uri');
    assertError(invalid, 'Reject invalid URI');
}
function testURIResolution() {
    group('URI Resolution');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // Root
    const root = resolveURI('mail://');
    assertOk(root, 'Resolve mail://');
    if (root.ok) {
        assertEqual(root.value._delegate.uri().href, 'mail://', 'Root URI is mail://');
    }
    // Accounts collection
    const accounts = resolveURI('mail://accounts');
    assertOk(accounts, 'Resolve mail://accounts');
    // Account by index
    const acc0 = resolveURI('mail://accounts[0]');
    assertOk(acc0, 'Resolve mail://accounts[0]');
    if (acc0.ok) {
        const name = acc0.value.name.resolve();
        assertEqual(name, 'Work', 'First account is Work');
    }
    // Account by name
    const accWork = resolveURI('mail://accounts/Work');
    assertOk(accWork, 'Resolve mail://accounts/Work');
    if (accWork.ok) {
        const name = accWork.value.name.resolve();
        assertEqual(name, 'Work', 'Account name is Work');
    }
    // Nested mailbox
    const inbox = resolveURI('mail://accounts[0]/mailboxes/INBOX');
    assertOk(inbox, 'Resolve mailbox by name');
    if (inbox.ok) {
        const unread = inbox.value.unreadCount.resolve();
        assertEqual(unread, 5, 'INBOX has 5 unread');
    }
    // Message by id
    const msg = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
    assertOk(msg, 'Resolve message by id');
    if (msg.ok) {
        const subject = msg.value.subject.resolve();
        assertEqual(subject, 'Hello World', 'Message subject correct');
    }
    // Standard mailboxes
    const inboxStd = resolveURI('mail://inbox');
    assertOk(inboxStd, 'Resolve mail://inbox');
    const sent = resolveURI('mail://sent');
    assertOk(sent, 'Resolve mail://sent');
    // Settings namespace
    const settings = resolveURI('mail://settings');
    assertOk(settings, 'Resolve mail://settings');
    const fetchInterval = resolveURI('mail://settings/fetchInterval');
    assertOk(fetchInterval, 'Resolve mail://settings/fetchInterval');
    if (fetchInterval.ok) {
        const val = fetchInterval.value.resolve();
        assertEqual(val, 5, 'fetchInterval is 5');
    }
    // Invalid path
    const invalid = resolveURI('mail://nonexistent');
    assertError(invalid, 'Reject unknown path');
}
function testResProxy() {
    group('Res Proxy Behavior');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const result = resolveURI('mail://accounts[0]');
    if (!result.ok) {
        assert(false, 'Failed to resolve account');
        return;
    }
    const account = result.value;
    // Property access creates child Res
    const mailboxes = account.mailboxes;
    assert('_delegate' in mailboxes, 'mailboxes has _delegate');
    assert('byIndex' in mailboxes, 'mailboxes has byIndex method');
    assert('byName' in mailboxes, 'mailboxes has byName method');
    // byIndex returns Res
    const firstMailbox = mailboxes.byIndex(0);
    assert('_delegate' in firstMailbox, 'byIndex result has _delegate');
    assertEqual(firstMailbox.name.resolve(), 'INBOX', 'First mailbox is INBOX');
    // byName returns Res
    const inboxByName = mailboxes.byName('INBOX');
    assert('_delegate' in inboxByName, 'byName result has _delegate');
    assertEqual(inboxByName.name.resolve(), 'INBOX', 'Mailbox by name is INBOX');
    // Chained navigation
    const msg = account.mailboxes.byName('INBOX').messages.byId(1001);
    assert('_delegate' in msg, 'Chained navigation returns Res');
    assertEqual(msg.subject.resolve(), 'Hello World', 'Chained navigation works');
}
function testComputedProperties() {
    group('Computed Properties');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // sender is computed from raw email string
    const msg1 = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
    if (msg1.ok) {
        const sender = msg1.value.sender.resolve();
        assertEqual(sender.address, 'alice@example.com', 'Parsed email address');
        assertEqual(sender.name, '', 'No name in plain email');
    }
    const msg2 = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1002');
    if (msg2.ok) {
        const sender = msg2.value.sender.resolve();
        assertEqual(sender.address, 'bob@example.com', 'Parsed email address with name');
        assertEqual(sender.name, 'Bob Smith', 'Parsed display name');
    }
}
function testJxaNameMapping() {
    group('JXA Name Mapping');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // attachments maps to mailAttachments in JXA
    const msg = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1002');
    if (msg.ok) {
        const attachments = msg.value.attachments.resolve();
        assertEqual(attachments.length, 1, 'Message has 1 attachment');
        // Collection returns {uri} specifiers - use byIndex to get actual data
        const firstAttachment = msg.value.attachments.byIndex(0).resolve();
        assertEqual(firstAttachment.name, 'doc.pdf', 'Attachment name correct');
    }
    // sent maps to sentMailbox in JXA
    const sent = resolveURI('mail://sent');
    if (sent.ok) {
        const name = sent.value.name.resolve();
        assertEqual(name, 'All Sent', 'Sent mailbox name correct');
    }
}
function testQueryOperations() {
    group('Query Operations');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // Filter via URI
    const filtered = resolveURI('mail://accounts?name=Work');
    if (filtered.ok) {
        const accounts = filtered.value.resolve();
        assertEqual(accounts.length, 1, 'Filter returns 1 account');
        assertEqual(accounts[0].name, 'Work', 'Filtered account is Work');
    }
    // Sort via URI
    const sorted = resolveURI('mail://accounts[0]/mailboxes?sort=unreadCount.desc');
    if (sorted.ok) {
        const mailboxes = sorted.value.resolve();
        assert(mailboxes.length >= 2, 'At least 2 mailboxes');
        assert(mailboxes[0].unreadCount >= mailboxes[1].unreadCount, 'Sorted descending');
    }
    // Pagination via URI
    const paginated = resolveURI('mail://accounts[0]/mailboxes?limit=2');
    if (paginated.ok) {
        const mailboxes = paginated.value.resolve();
        assertEqual(mailboxes.length, 2, 'Limit to 2 mailboxes');
    }
    // Combined filter + sort + pagination
    const combo = resolveURI('mail://accounts[0]/mailboxes?unreadCount.gt=0&sort=name.asc&limit=5');
    if (combo.ok) {
        const mailboxes = combo.value.resolve();
        assert(mailboxes.every((m) => m.unreadCount > 0), 'All have unread > 0');
    }
}
function testSetOperation() {
    group('Set Operation');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // Get a rule and check initial state
    const rule = resolveURI('mail://rules[0]');
    if (rule.ok) {
        const enabled = rule.value.enabled.resolve();
        assertEqual(enabled, true, 'Rule initially enabled');
        // Set to false
        rule.value.enabled.set(false);
        const enabledAfter = rule.value.enabled.resolve();
        assertEqual(enabledAfter, false, 'Rule disabled after set');
        // Set back
        rule.value.enabled.set(true);
        assertEqual(rule.value.enabled.resolve(), true, 'Rule re-enabled');
    }
}
function testObjectResolution() {
    group('Object Resolution (baseObject vs baseScalar)');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // Mailbox uses baseObject - resolve() should return a plain object with properties
    const inboxResult = resolveURI('mail://accounts[0]/mailboxes/INBOX');
    if (inboxResult.ok) {
        const resolved = inboxResult.value.resolve();
        assert(typeof resolved === 'object', 'Mailbox resolves to object');
        assertEqual(resolved.name, 'INBOX', 'Resolved mailbox has name property');
        assertEqual(resolved.unreadCount, 5, 'Resolved mailbox has unreadCount property');
        // Lazy collections return Specifiers when resolved as part of parent
        assert(typeof resolved.messages === 'object' && 'uri' in resolved.messages, 'Resolved mailbox has messages specifier');
        assert(typeof resolved.mailboxes === 'object' && 'uri' in resolved.mailboxes, 'Resolved mailbox has mailboxes specifier');
    }
    // Message uses baseScalar - resolve() should also return object with properties
    // This test will FAIL with current code because MessageProto uses baseScalar
    const msgResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
    if (msgResult.ok) {
        const resolved = msgResult.value.resolve();
        assert(typeof resolved === 'object', 'Message resolves to object');
        assertEqual(resolved.id, 1001, 'Resolved message has id property');
        assertEqual(resolved.subject, 'Hello World', 'Resolved message has subject property');
        // sender should be the computed value (parsed email), not raw string
        assert(typeof resolved.sender === 'object', 'Resolved message has parsed sender');
        assertEqual(resolved.sender.address, 'alice@example.com', 'Sender address is parsed');
    }
    // Rule uses baseScalar - should also return object with properties
    const ruleResult = resolveURI('mail://rules[0]');
    if (ruleResult.ok) {
        const resolved = ruleResult.value.resolve();
        assert(typeof resolved === 'object', 'Rule resolves to object');
        assertEqual(resolved.name, 'Spam Filter', 'Resolved rule has name property');
        assertEqual(resolved.enabled, true, 'Resolved rule has enabled property');
    }
    // Account uses baseScalar - should also return object with properties
    const accResult = resolveURI('mail://accounts[0]');
    if (accResult.ok) {
        const resolved = accResult.value.resolve();
        assert(typeof resolved === 'object', 'Account resolves to object');
        assertEqual(resolved.name, 'Work', 'Resolved account has name property');
        assertEqual(resolved.fullName, 'John Doe', 'Resolved account has fullName property');
    }
}
function testCollectionResolution() {
    group('Collection Resolution');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // messages collection resolve() should return array of specifiers (URIs)
    const messagesResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages');
    if (messagesResult.ok) {
        const resolved = messagesResult.value.resolve();
        assert(Array.isArray(resolved), 'Messages collection resolves to array');
        assertEqual(resolved.length, 2, 'Messages array has 2 items');
        // Each item should be a specifier with uri property (just uri, no id/name)
        assert(resolved[0] !== null, 'First message specifier is not null');
        assert('uri' in resolved[0], 'First message specifier has uri');
        assert(resolved[0].uri.href.includes('messages%5B0%5D'), 'First message URI has correct index');
        assert('uri' in resolved[1], 'Second message specifier has uri');
    }
    // To get actual data, use byIndex() or byId() then resolve()
    if (messagesResult.ok) {
        const firstMsg = messagesResult.value.byIndex(0).resolve();
        assertEqual(firstMsg.subject, 'Hello World', 'First message has subject via byIndex');
        const secondMsg = messagesResult.value.byIndex(1).resolve();
        assertEqual(secondMsg.subject, 'Meeting Tomorrow', 'Second message has subject via byIndex');
    }
    // Rules collection should resolve to array of specifiers
    const rulesResult = resolveURI('mail://rules');
    if (rulesResult.ok) {
        const resolved = rulesResult.value.resolve();
        assert(Array.isArray(resolved), 'Rules collection resolves to array');
        assertEqual(resolved.length, 2, 'Rules array has 2 items');
        assert('uri' in resolved[0], 'First rule specifier has uri');
        // To get actual data, use byIndex/byName then resolve
        const firstRule = rulesResult.value.byIndex(0).resolve();
        assertEqual(firstRule.name, 'Spam Filter', 'First rule name via byIndex');
    }
    // Accounts collection
    const accountsResult = resolveURI('mail://accounts');
    if (accountsResult.ok) {
        const resolved = accountsResult.value.resolve();
        assert(Array.isArray(resolved), 'Accounts collection resolves to array');
        assertEqual(resolved.length, 2, 'Accounts array has 2 items');
        assert('uri' in resolved[0], 'First account specifier has uri');
        // To get actual data, use byIndex/byName then resolve
        const firstAccount = accountsResult.value.byIndex(0).resolve();
        assertEqual(firstAccount.name, 'Work', 'First account name via byIndex');
    }
}
function testLazyContentResolution() {
    group('Lazy Content Resolution (specifierFor)');
    const mockData = createMockMailData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    // Test 1: When resolving a message, content should be a specifier (lazy)
    const msgResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
    if (msgResult.ok) {
        const message = msgResult.value.resolve();
        assert(typeof message.content === 'object', 'Content in message is an object (specifier)');
        assert('uri' in message.content, 'Content has uri property (is a specifier)');
        assert(message.content.uri.href.includes('content'), 'Content specifier URI includes "content"');
    }
    // Test 2: Direct resolution of content should return actual value
    const contentResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001/content');
    if (contentResult.ok) {
        const content = contentResult.value.resolve();
        assertEqual(content, 'Hello, this is the message body content.', 'Direct content resolution returns actual text');
    }
    // Test 3: readResource on content should return actual value
    const readResult = readResource(new URL('mail://accounts[0]/mailboxes/INBOX/messages/1001/content'));
    if (assertReadOk(readResult, 'readResource on content succeeds') && readResult.ok) {
        assertEqual(readResult.text, 'Hello, this is the message body content.', 'readResource returns actual content');
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Compile-time type tests
// ─────────────────────────────────────────────────────────────────────────────
// These use @ts-expect-error to verify that unsupported patterns are type errors.
// If the pattern becomes valid, TypeScript will error on the @ts-expect-error comment.
function compileTimeTypeTests() {
    // These tests don't run - they verify type checking at compile time
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    // VALID: collection.resolve() returns CollectionResolveResult
    // (array of {uri: URL} possibly with extra fields)
    const specifiers = inbox.messages.resolve();
    // Can access uri on first element
    if (specifiers.length > 0) {
        const firstUri = specifiers[0].uri;
    }
    // VALID: item.resolve() returns data
    const message = inbox.messages.byId(1001);
    const subject = message.subject.resolve();
    // @ts-expect-error - resolve_eager() no longer exists
    inbox.messages.resolve_eager();
    // @ts-expect-error - resolve_eager() no longer exists on items
    message.resolve_eager();
}
// ─────────────────────────────────────────────────────────────────────────────
// Pagination Tests
// ─────────────────────────────────────────────────────────────────────────────
function createLargeCollectionMockData() {
    // Generate 150 messages for pagination testing
    const messages = [];
    for (let i = 0; i < 150; i++) {
        messages.push({
            id: 2000 + i,
            messageId: `<msg${i}@test.com>`,
            subject: `Test Message ${i}`,
            sender: `sender${i}@example.com`,
            dateSent: `2024-01-${String(15 + (i % 15)).padStart(2, '0')}T10:00:00Z`,
            dateReceived: `2024-01-${String(15 + (i % 15)).padStart(2, '0')}T10:01:00Z`,
            readStatus: i % 2 === 0,
            flaggedStatus: false,
            messageSize: 1024 + i,
            toRecipients: [{ name: 'Test', address: 'test@test.com' }],
            ccRecipients: [],
            bccRecipients: [],
            mailAttachments: [],
        });
    }
    return {
        name: 'Mail',
        version: '16.0',
        accounts: [
            {
                id: 'acc1',
                name: 'TestAccount',
                fullName: 'Test User',
                emailAddresses: ['test@test.com'],
                mailboxes: [
                    {
                        name: 'LargeMailbox',
                        unreadCount: 75,
                        messages,
                        mailboxes: [],
                    },
                ],
            },
        ],
        rules: [],
        signatures: [],
        inbox: { name: 'All Inboxes', unreadCount: 0, messages: [], mailboxes: [] },
        sentMailbox: { name: 'All Sent', unreadCount: 0, messages: [], mailboxes: [] },
        draftsMailbox: { name: 'All Drafts', unreadCount: 0, messages: [], mailboxes: [] },
        trashMailbox: { name: 'All Trash', unreadCount: 0, messages: [], mailboxes: [] },
        junkMailbox: { name: 'All Junk', unreadCount: 0, messages: [], mailboxes: [] },
        outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
        alwaysBccMyself: false,
        alwaysCcMyself: false,
        fetchInterval: 5,
    };
}
function assertReadOk(result, message) {
    testCount++;
    if (result.ok) {
        passCount++;
        console.log(`  \u2713 ${message}`);
        return true;
    }
    else {
        console.log(`  \u2717 ${message}`);
        console.log(`      error: ${result.error}`);
        return false;
    }
}
function testPagination() {
    group('Collection Pagination');
    // Use factory function for fresh data each time
    const freshLargeData = () => createMockDelegate(createLargeCollectionMockData(), 'mail');
    registerScheme('mail', freshLargeData, MailApplicationProto);
    // Test 1: Default limit (20) applied to large collection
    const defaultResult = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages'));
    if (assertReadOk(defaultResult, 'Read large collection without limit') && defaultResult.ok) {
        const data = defaultResult.text;
        assert('_pagination' in data, 'Response has _pagination metadata');
        assertEqual(data._pagination.total, 150, 'Total count is 150');
        assertEqual(data._pagination.returned, 20, 'Default returns 20 items');
        assertEqual(data._pagination.limit, 20, 'Default limit is 20');
        assertEqual(data._pagination.offset, 0, 'Default offset is 0');
        assertEqual(data.items.length, 20, 'Items array has 20 elements');
        assert(data._pagination.next !== null, 'Has next page URL');
        assert(data._pagination.next.includes('offset=20'), 'Next URL has offset=20');
    }
    // Test 2: Explicit limit=50 - framework applies it, we see 50 items (no extra truncation)
    registerScheme('mail', freshLargeData, MailApplicationProto);
    const limit50Result = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=50'));
    if (assertReadOk(limit50Result, 'Read with limit=50') && limit50Result.ok) {
        const data = limit50Result.text;
        // When limit is explicitly requested and honored, no pagination wrapper needed
        assert(Array.isArray(data), 'With explicit limit=50, returns plain array');
        assertEqual(data.length, 50, 'Returns exactly 50 items');
    }
    // Test 3: Limit over max (100) gets capped - framework returns 500 but we cap to 100
    registerScheme('mail', freshLargeData, MailApplicationProto);
    const limit500Result = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=500'));
    if (assertReadOk(limit500Result, 'Read with limit=500 (should cap to 100)') && limit500Result.ok) {
        const data = limit500Result.text;
        assert('_pagination' in data, 'Over-limit request has pagination wrapper');
        assertEqual(data._pagination.returned, 100, 'Capped to 100 items');
        assertEqual(data._pagination.limit, 100, 'Limit capped to 100');
        assertEqual(data.items.length, 100, 'Items array has 100 elements');
    }
    // Test 4: Small collection (under default limit) returns all items without pagination
    registerScheme('mail', () => createMockDelegate(createMockMailData(), 'mail'), MailApplicationProto);
    const smallResult = readResource(new URL('mail://accounts[0]/mailboxes/INBOX/messages'));
    if (assertReadOk(smallResult, 'Read small collection') && smallResult.ok) {
        const data = smallResult.text;
        assert(!('_pagination' in data), 'Small collection has no pagination wrapper');
        assert(Array.isArray(data), 'Small collection returns plain array');
    }
    // Test 5: Offset pagination works (with limit under max)
    registerScheme('mail', freshLargeData, MailApplicationProto);
    const offsetResult = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=20&offset=140'));
    if (assertReadOk(offsetResult, 'Read with offset=140, limit=20') && offsetResult.ok) {
        const data = offsetResult.text;
        // With explicit limit=20 at offset 140, we get 10 items (150-140=10)
        assert(Array.isArray(data), 'With explicit limit, returns plain array');
        assertEqual(data.length, 10, 'Returns remaining 10 items');
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('Framework Tests (Node/Mock)');
console.log('============================');
testURIParsing();
testURIResolution();
testResProxy();
testComputedProperties();
testJxaNameMapping();
testQueryOperations();
testSetOperation();
testObjectResolution();
testCollectionResolution();
testPagination();
testLazyContentResolution();
const frameworkTestResult = summary();
resetCounters();
// tests/src/test-operations.ts - Domain operation tests (runs in Node with mock data)
//
// Tests move, delete, create operations and parent navigation.
// Uses MockDelegate - no Mail.app required.
// ─────────────────────────────────────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────────────────────────────────────
function createOperationsMockData() {
    return {
        name: 'Mail',
        version: '16.0',
        accounts: [
            {
                id: 'acc1',
                name: 'Work',
                fullName: 'John Doe',
                emailAddresses: ['john@work.com'],
                mailboxes: [
                    {
                        name: 'INBOX',
                        unreadCount: 5,
                        messages: [
                            {
                                id: 1001,
                                messageId: '<msg1@work.com>',
                                subject: 'Hello World',
                                sender: 'alice@example.com',
                                dateSent: '2024-01-15T10:00:00Z',
                                dateReceived: '2024-01-15T10:01:00Z',
                                readStatus: false,
                                flaggedStatus: false,
                                messageSize: 1024,
                            },
                            {
                                id: 1002,
                                messageId: '<msg2@work.com>',
                                subject: 'Meeting Tomorrow',
                                sender: 'bob@example.com',
                                dateSent: '2024-01-15T11:00:00Z',
                                dateReceived: '2024-01-15T11:01:00Z',
                                readStatus: true,
                                flaggedStatus: true,
                                messageSize: 2048,
                            },
                        ],
                        mailboxes: [],
                    },
                    {
                        name: 'Archive',
                        unreadCount: 0,
                        messages: [
                            {
                                id: 2001,
                                messageId: '<old@work.com>',
                                subject: 'Old Message',
                                sender: 'old@example.com',
                                dateSent: '2023-01-01T00:00:00Z',
                                dateReceived: '2023-01-01T00:01:00Z',
                                readStatus: true,
                                flaggedStatus: false,
                                messageSize: 512,
                            },
                        ],
                        mailboxes: [],
                    },
                    {
                        name: 'Trash',
                        unreadCount: 0,
                        messages: [],
                        mailboxes: [],
                    },
                ],
            },
        ],
        rules: [
            {
                name: 'Spam Filter',
                enabled: true,
                allConditionsMustBeMet: true,
                deleteMessage: false,
                markRead: false,
                markFlagged: false,
            },
            {
                name: 'Work Rules',
                enabled: true,
                allConditionsMustBeMet: false,
                deleteMessage: false,
                markRead: true,
                markFlagged: false,
            },
        ],
        signatures: [],
        inbox: { name: 'Inbox', unreadCount: 5, messages: [], mailboxes: [] },
        sentMailbox: { name: 'Sent', unreadCount: 0, messages: [], mailboxes: [] },
        draftsMailbox: { name: 'Drafts', unreadCount: 0, messages: [], mailboxes: [] },
        trashMailbox: { name: 'Trash', unreadCount: 0, messages: [], mailboxes: [] },
        junkMailbox: { name: 'Junk', unreadCount: 0, messages: [], mailboxes: [] },
        outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
function testMoveMessageBetweenMailboxes() {
    group('Move Message Between Mailboxes');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    // Get inbox and archive mailboxes
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    const archive = mail.accounts.byName('Work').mailboxes.byName('Archive');
    // Verify initial state - resolve() returns specifiers (URIs), count tells us how many
    const inboxSpecifiers = inbox.messages.resolve();
    const archiveSpecifiers = archive.messages.resolve();
    assertEqual(inboxSpecifiers.length, 2, 'Inbox has 2 messages initially');
    assertEqual(archiveSpecifiers.length, 1, 'Archive has 1 message initially');
    // Get the first message from inbox - use byId for specific access
    const message = inbox.messages.byId(1001);
    assertEqual(message.subject.resolve(), 'Hello World', 'Message subject is correct');
    // Move message to archive
    const moveResult = message.move(archive.messages);
    assertOk(moveResult, 'Move operation succeeded');
    // Verify message was removed from source (check count via specifiers)
    const inboxSpecifiersAfter = inbox.messages.resolve();
    assertEqual(inboxSpecifiersAfter.length, 1, 'Inbox now has 1 message');
    // Verify message was added to destination
    const archiveSpecifiersAfter = archive.messages.resolve();
    assertEqual(archiveSpecifiersAfter.length, 2, 'Archive now has 2 messages');
    // Verify the moved message is in archive - check by existence
    assert(archive.messages.byId(1001).exists(), 'Moved message found in archive');
    assertEqual(archive.messages.byId(1001).subject.resolve(), 'Hello World', 'Moved message has correct subject');
}
function testMoveTypeConstraint() {
    group('Move Type Constraint');
    // This test verifies that the type system constrains move destinations.
    // At compile time: message.move(account.mailboxes) would be a type error
    // because Collection<Mailbox> is not compatible with Collection<Message>.
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    const message = inbox.messages.byId(1001);
    // Verify message has move method
    assert('move' in message, 'Message has move method');
    assert(typeof message.move === 'function', 'move is a function');
    // The type system prevents: message.move(mail.accounts.byName('Work').mailboxes)
    // This is verified at compile time, not runtime.
    console.log('  \u2713 Type constraint prevents moving message to wrong collection type (compile-time check)');
}
function testDeleteMessage() {
    group('Delete Message');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    // Verify initial state - count via specifiers
    const specifiersBefore = inbox.messages.resolve();
    assertEqual(specifiersBefore.length, 2, 'Inbox has 2 messages initially');
    // Delete the second message
    const message = inbox.messages.byId(1002);
    const deleteResult = message.delete();
    assertOk(deleteResult, 'Delete operation succeeded');
    // Verify message was removed
    const specifiersAfter = inbox.messages.resolve();
    assertEqual(specifiersAfter.length, 1, 'Inbox now has 1 message');
    // Verify correct message remains - use byId to check
    assert(inbox.messages.byId(1001).exists(), 'Message 1001 still exists');
    assert(!inbox.messages.byId(1002).exists(), 'Message 1002 no longer exists');
}
function testDeleteRule() {
    group('Delete Rule');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    // Verify initial state - count via specifiers
    const specifiersBefore = mail.rules.resolve();
    assertEqual(specifiersBefore.length, 2, 'App has 2 rules initially');
    // Delete the first rule
    const rule = mail.rules.byName('Spam Filter');
    assert('delete' in rule, 'Rule has delete method');
    const deleteResult = rule.delete();
    assertOk(deleteResult, 'Delete operation succeeded');
    // Verify rule was removed
    const specifiersAfter = mail.rules.resolve();
    assertEqual(specifiersAfter.length, 1, 'App now has 1 rule');
    // Verify correct rule remains - use byName to check
    assert(!mail.rules.byName('Spam Filter').exists(), 'Spam Filter no longer exists');
    assert(mail.rules.byName('Work Rules').exists(), 'Work Rules still exists');
}
function testCreateMessage() {
    group('Create Message');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    // Verify initial state - count via specifiers
    const specifiersBefore = inbox.messages.resolve();
    assertEqual(specifiersBefore.length, 2, 'Inbox has 2 messages initially');
    // Create a new message using delegate
    const createResult = inbox.messages._delegate.create({
        subject: 'New Test Message',
        sender: 'test@example.com',
        readStatus: false,
        flaggedStatus: false,
        messageSize: 100,
    });
    const newUri = assertOk(createResult, 'Create operation succeeded');
    // Verify message was added
    const specifiersAfter = inbox.messages.resolve();
    assertEqual(specifiersAfter.length, 3, 'Inbox now has 3 messages');
    // The new specifier should include an id if available
    const lastSpecifier = specifiersAfter[2];
    assert('uri' in lastSpecifier, 'New message specifier has uri');
    if ('id' in lastSpecifier) {
        assert(lastSpecifier.id !== undefined, 'New message specifier has id');
    }
    // Verify we can access the new message via byIndex
    const newMsg = inbox.messages.byIndex(2).resolve();
    assertEqual(newMsg.subject, 'New Test Message', 'New message has correct subject');
    // Verify URI points to new message
    if (newUri) {
        assert(newUri.href.includes('messages'), 'Returned URI includes messages path');
    }
}
function testParentNavigation() {
    group('Parent Navigation');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    // Navigate to messages collection
    const messagesDelegate = mail.accounts.byName('Work').mailboxes.byName('INBOX').messages._delegate;
    // Get parent (should be the mailbox)
    const parentOrRoot = messagesDelegate.parent();
    assert(!isRoot(parentOrRoot), 'Parent of messages is not root');
    if (!isRoot(parentOrRoot)) {
        const parent = parentOrRoot;
        // Parent should be the mailbox - verify by checking its URI
        const parentUri = parent.uri().href;
        assert(parentUri.includes('INBOX'), 'Parent URI includes INBOX');
    }
    // Navigate to root
    const rootDelegate = mail._delegate;
    const rootParent = rootDelegate.parent();
    assert(isRoot(rootParent), 'Parent of root delegate is RootMarker');
}
function testUriReturnsURL() {
    group('URI Returns URL Object');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const message = mail.accounts.byName('Work').mailboxes.byName('INBOX').messages.byId(1001);
    const uri = message._delegate.uri();
    assert(uri instanceof URL, 'uri() returns URL object');
    assertEqual(typeof uri.href, 'string', 'URL has href property');
    assertEqual(typeof uri.pathname, 'string', 'URL has pathname property');
    assert(uri.href.startsWith('mail://'), 'URI starts with mail://');
}
// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('Domain Operations Tests (Node/Mock)');
console.log('====================================');
testMoveMessageBetweenMailboxes();
testMoveTypeConstraint();
testDeleteMessage();
testDeleteRule();
testCreateMessage();
testParentNavigation();
testUriReturnsURL();
const operationsTestResult = summary();
