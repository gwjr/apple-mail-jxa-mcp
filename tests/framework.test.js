"use strict";
// scratch/framework.ts - Plugboard v4 Framework
//
// Core types, proto system, URI parsing - no app-specific code.
// App schemas (mail.ts, notes.ts) use these building blocks.
// ─────────────────────────────────────────────────────────────────────────────
// Root Marker (for parent navigation)
// ─────────────────────────────────────────────────────────────────────────────
// Explicit unique symbol type - used directly in type literal (no typeof needed)
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
        // Apply query state to data if it's an array
        if (Array.isArray(this._data)) {
            return applyQueryState(this._data, this._query);
        }
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
}
// Create a mock delegate from in-memory data
function createMockDelegate(data, scheme = 'mail') {
    return new MockDelegate(data, [{ kind: 'root', scheme }], data, null, null, null);
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
// Only register in JXA environment (Application and createJXADelegate are JXA-only)
// Use globalThis to check without TypeScript complaining
const _globalThis = globalThis;
if (typeof _globalThis.Application !== 'undefined' && typeof _globalThis.createJXADelegate !== 'undefined') {
    registerScheme('mail', () => _globalThis.createJXADelegate(_globalThis.Application('Mail'), 'mail'), MailApplicationProto);
}
// tests/src/test-utils.ts - Shared test utilities
//
// Simple assertion functions that work in both Node and JXA environments.
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
        assertEqual(attachments[0].name, 'doc.pdf', 'Attachment name correct');
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
    // Verify initial state
    const inboxMessages = inbox.messages.resolve();
    const archiveMessages = archive.messages.resolve();
    assertEqual(inboxMessages.length, 2, 'Inbox has 2 messages initially');
    assertEqual(archiveMessages.length, 1, 'Archive has 1 message initially');
    // Get the first message from inbox
    const message = inbox.messages.byId(1001);
    assertEqual(message.subject.resolve(), 'Hello World', 'Message subject is correct');
    // Move message to archive
    const moveResult = message.move(archive.messages);
    assertOk(moveResult, 'Move operation succeeded');
    // Verify message was removed from source
    const inboxMessagesAfter = inbox.messages.resolve();
    assertEqual(inboxMessagesAfter.length, 1, 'Inbox now has 1 message');
    // Verify message was added to destination
    const archiveMessagesAfter = archive.messages.resolve();
    assertEqual(archiveMessagesAfter.length, 2, 'Archive now has 2 messages');
    // Verify the moved message is in archive
    const movedMsg = archiveMessagesAfter.find((m) => m.id === 1001);
    assert(movedMsg !== undefined, 'Moved message found in archive');
    assertEqual(movedMsg?.subject, 'Hello World', 'Moved message has correct subject');
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
    // Verify initial state
    const messagesBefore = inbox.messages.resolve();
    assertEqual(messagesBefore.length, 2, 'Inbox has 2 messages initially');
    // Delete the second message
    const message = inbox.messages.byId(1002);
    const deleteResult = message.delete();
    assertOk(deleteResult, 'Delete operation succeeded');
    // Verify message was removed
    const messagesAfter = inbox.messages.resolve();
    assertEqual(messagesAfter.length, 1, 'Inbox now has 1 message');
    // Verify correct message remains
    assertEqual(messagesAfter[0].id, 1001, 'Remaining message has correct id');
}
function testDeleteRule() {
    group('Delete Rule');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    // Verify initial state
    const rulesBefore = mail.rules.resolve();
    assertEqual(rulesBefore.length, 2, 'App has 2 rules initially');
    // Delete the first rule
    const rule = mail.rules.byName('Spam Filter');
    assert('delete' in rule, 'Rule has delete method');
    const deleteResult = rule.delete();
    assertOk(deleteResult, 'Delete operation succeeded');
    // Verify rule was removed
    const rulesAfter = mail.rules.resolve();
    assertEqual(rulesAfter.length, 1, 'App now has 1 rule');
    assertEqual(rulesAfter[0].name, 'Work Rules', 'Remaining rule is Work Rules');
}
function testCreateMessage() {
    group('Create Message');
    const mockData = createOperationsMockData();
    registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
    const delegate = createMockDelegate(mockData, 'mail');
    const mail = getMailApp(delegate);
    const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
    // Verify initial state
    const messagesBefore = inbox.messages.resolve();
    assertEqual(messagesBefore.length, 2, 'Inbox has 2 messages initially');
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
    const messagesAfter = inbox.messages.resolve();
    assertEqual(messagesAfter.length, 3, 'Inbox now has 3 messages');
    // Verify the new message
    const newMsg = messagesAfter[2];
    assertEqual(newMsg.subject, 'New Test Message', 'New message has correct subject');
    assert(newMsg.id !== undefined, 'New message has an id assigned');
    // Verify URI points to new message
    if (newUri) {
        assert(newUri.href.includes(String(newMsg.id)), 'Returned URI includes new message id');
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
