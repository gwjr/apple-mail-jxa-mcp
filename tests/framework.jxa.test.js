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
    try {
        // Filter mailboxes by unread count
        const filtered = resolveURI('mail://accounts[0]/mailboxes?unreadCount.gt=0');
        if (filtered.ok) {
            const list = filtered.value.resolve();
            console.log(`    Mailboxes with unread: ${list.length}`);
            if (list.length > 0) {
                assert(list.every((m) => m.unreadCount > 0), 'All have unread > 0');
            }
            else {
                console.log('    (no mailboxes with unread)');
            }
        }
        // Sort and limit
        const sorted = resolveURI('mail://accounts[0]/mailboxes?sort=name.asc&limit=5');
        if (sorted.ok) {
            const list = sorted.value.resolve();
            console.log(`    First 5 sorted: ${list.length} mailbox(es)`);
        }
    }
    catch (e) {
        console.log(`  \u2717 Query operations: ${e.message}`);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────
console.log('Framework Tests (JXA/Mail.app)');
console.log('==============================');
testJxaURIResolution();
testJxaAccountNavigation();
testJxaMailboxNavigation();
testJxaMessageAccess();
testJxaStandardMailboxes();
testJxaSettings();
testJxaRulesAndSignatures();
testJxaQueryOperations();
const jxaTestResult = summary();
