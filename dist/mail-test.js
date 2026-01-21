"use strict";
// ============================================================================
// Core Types - Foundation (no dependencies)
// ============================================================================
/// <reference path="specifier.ts" />
// ============================================================================
// DSL
// ============================================================================
const by = {
    name: 'name',
    index: 'index',
    id: 'id',
};
const t = {
    string: { dimension: 'scalar', type: String, set: 'unavailable', lazy: false },
    number: { dimension: 'scalar', type: Number, set: 'unavailable', lazy: false },
    boolean: { dimension: 'scalar', type: Boolean, set: 'unavailable', lazy: false },
    date: { dimension: 'scalar', type: Date, set: 'unavailable', lazy: false },
};
function rw(desc) {
    return { ...desc, set: 'default' };
}
function lazy(desc) {
    return { ...desc, lazy: true };
}
function jxa(desc, name) {
    return { ...desc, jxaName: name };
}
function computed(fn) {
    return { dimension: 'scalar', type: Object, set: 'unavailable', lazy: false, computed: fn };
}
function collection(schema, addressing, opts) {
    return {
        dimension: [...addressing],
        type: schema,
        make: opts?.make ?? 'default',
        take: opts?.take ?? 'default',
        lazy: false,
    };
}
// ============================================================================
// URI Lexer - Pure structural parsing, no schema knowledge
// ============================================================================
// ============================================================================
// Query Parsing
// ============================================================================
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
        // Standard query params
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
        // Filter params: field=value or field.op=value
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
function parseFilterOp(op) {
    switch (op) {
        case 'contains': return 'contains';
        case 'startsWith': return 'startsWith';
        case 'gt': return 'gt';
        case 'lt': return 'lt';
        default: return 'equals';
    }
}
// ============================================================================
// Segment Parsing
// ============================================================================
function isInteger(s) {
    return /^-?\d+$/.test(s);
}
function parseSegments(path) {
    if (!path)
        return [];
    const segments = [];
    let remaining = path;
    while (remaining) {
        // Skip leading slash
        if (remaining.startsWith('/')) {
            remaining = remaining.slice(1);
            if (!remaining)
                break;
        }
        // Find end of head (next /, [, or ?)
        let headEnd = remaining.length;
        for (let i = 0; i < remaining.length; i++) {
            if (remaining[i] === '/' || remaining[i] === '[' || remaining[i] === '?') {
                headEnd = i;
                break;
            }
        }
        const head = decodeURIComponent(remaining.slice(0, headEnd));
        remaining = remaining.slice(headEnd);
        // Check if this "head" is actually an ID qualifier for previous segment
        if (segments.length > 0 && isInteger(head)) {
            const prev = segments[segments.length - 1];
            if (!prev.qualifier) {
                prev.qualifier = { kind: 'id', value: parseInt(head, 10) };
                continue;
            }
        }
        const segment = { head };
        // Parse qualifier if present
        if (remaining.startsWith('[')) {
            // Index qualifier: [N]
            const closeIdx = remaining.indexOf(']');
            if (closeIdx !== -1) {
                const indexStr = remaining.slice(1, closeIdx);
                if (!isInteger(indexStr)) {
                    // Invalid index - treat as name addressing instead (will fail later if invalid)
                    segment.head = head + remaining.slice(0, closeIdx + 1);
                    remaining = remaining.slice(closeIdx + 1);
                }
                else {
                    segment.qualifier = { kind: 'index', value: parseInt(indexStr, 10) };
                    remaining = remaining.slice(closeIdx + 1);
                }
            }
        }
        if (remaining.startsWith('?')) {
            // Query qualifier: ?key=value&...
            // Find end of query (next / or end)
            let queryEnd = remaining.length;
            for (let i = 1; i < remaining.length; i++) {
                if (remaining[i] === '/') {
                    queryEnd = i;
                    break;
                }
            }
            const queryStr = remaining.slice(1, queryEnd);
            const queryQualifier = parseQueryQualifier(queryStr);
            // Merge with existing qualifier if index was already parsed
            if (segment.qualifier?.kind === 'index') {
                // Can't have both index and query on same segment
                // Query wins, but this is arguably malformed
            }
            segment.qualifier = queryQualifier;
            remaining = remaining.slice(queryEnd);
        }
        segments.push(segment);
    }
    return segments;
}
// ============================================================================
// Main Lexer
// ============================================================================
function lexURI(uri) {
    // Parse scheme
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        return {
            ok: false,
            error: { message: 'Invalid URI: missing scheme (expected scheme://...)', position: 0 }
        };
    }
    const scheme = uri.slice(0, schemeEnd);
    if (!scheme) {
        return {
            ok: false,
            error: { message: 'Invalid URI: empty scheme', position: 0 }
        };
    }
    const path = uri.slice(schemeEnd + 3);
    const segments = parseSegments(path);
    return {
        ok: true,
        value: { scheme, segments }
    };
}
// ============================================================================
// Exports
// ============================================================================
globalThis.lexURI = lexURI;
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
        set: (value) => tryResolve(() => { setter(value); }, `${uri}:set`)
    };
    return spec;
}
// ============================================================================
// Descriptor Helpers
// ============================================================================
function isScalar(desc) {
    return desc.dimension === 'scalar';
}
function isCollection(desc) {
    return Array.isArray(desc.dimension);
}
function isPrimitive(type) {
    return type === String || type === Number || type === Boolean || type === Date;
}
function getJxaName(desc, key) {
    return desc?.jxaName ?? key;
}
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
            for (const [key, desc] of Object.entries(schema)) {
                const jxaName = getJxaName(desc, key);
                if (isScalar(desc)) {
                    if (desc.computed) {
                        // Computed property
                        Object.defineProperty(this, key, {
                            get: () => desc.computed(this._jxa),
                            enumerable: true
                        });
                    }
                    else if (isPrimitive(desc.type)) {
                        // Primitive scalar
                        const self = this;
                        if (desc.lazy) {
                            Object.defineProperty(this, key, {
                                get() {
                                    const propUri = self._uri ? `${self._uri}/${key}` : `${typeName.toLowerCase()}://.../${key}`;
                                    if (desc.set === 'default') {
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
                    // Nested schema scalars are handled at navigation time, not here
                }
                else if (isCollection(desc)) {
                    const self = this;
                    Object.defineProperty(this, key, {
                        get() {
                            const base = self._uri || `${typeName.toLowerCase()}://`;
                            const collUri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
                            return createCollSpec(collUri, self._jxa[jxaName], desc.type, desc.dimension, `${typeName}_${key}`, desc.make, desc.take);
                        },
                        enumerable: true
                    });
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
    for (const [key, desc] of Object.entries(schema)) {
        const jxaName = getJxaName(desc, key);
        if (isScalar(desc) && isPrimitive(desc.type)) {
            Object.defineProperty(spec, key, {
                get() {
                    if (desc.set === 'default') {
                        return mutableSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '', (value) => jxa[jxaName].set(value));
                    }
                    return scalarSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '');
                },
                enumerable: true
            });
        }
        else if (isCollection(desc)) {
            Object.defineProperty(spec, key, {
                get() {
                    return createCollSpec(`${uri}/${key}`, jxa[jxaName], desc.type, desc.dimension, `${typeName}_${key}`, desc.make, desc.take);
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
function createCollSpec(uri, jxaColl, schema, addressing, typeName, makeOp = 'default', takeOp = 'default', sortSpec, jsFilter, pagination, expand) {
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
            return { ok: true, value: createCollSpec(fixedBase, jxaColl, schema, addressing, typeName, makeOp, takeOp) };
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
    // Addressing methods
    if (addressing.includes('index')) {
        spec.byIndex = (index) => createElemSpec(`${baseUri}[${index}]`, jxaColl.at(index), schema, addressing, typeName);
    }
    if (addressing.includes('name')) {
        spec.byName = (name) => createElemSpec(`${baseUri}/${encodeURIComponent(name)}`, jxaColl.byName(name), schema, addressing, typeName);
    }
    if (addressing.includes('id')) {
        spec.byId = (id) => createElemSpec(`${baseUri}/${id}`, jxaColl.byId(id), schema, addressing, typeName);
    }
    // Query methods
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
            return createCollSpec(filterUri, filtered, schema, addressing, typeName, makeOp, takeOp, sortSpec, undefined, pagination, expand);
        }
        catch {
            return createCollSpec(filterUri, jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, filter, pagination, expand);
        }
    };
    spec.sortBy = (sort) => {
        const sep = uri.includes('?') ? '&' : '?';
        return createCollSpec(`${uri}${sep}sort=${String(sort.by)}.${sort.direction || 'asc'}`, jxaColl, schema, addressing, typeName, makeOp, takeOp, sort, jsFilter, pagination, expand);
    };
    spec.paginate = (page) => {
        const parts = [];
        if (page.limit !== undefined)
            parts.push(`limit=${page.limit}`);
        if (page.offset !== undefined)
            parts.push(`offset=${page.offset}`);
        const sep = uri.includes('?') ? '&' : '?';
        const newUri = parts.length ? `${uri}${sep}${parts.join('&')}` : uri;
        return createCollSpec(newUri, jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, jsFilter, page, expand);
    };
    spec.expand = (expandProps) => {
        const sep = uri.includes('?') ? '&' : '?';
        return createCollSpec(`${uri}${sep}expand=${expandProps.join(',')}`, jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, jsFilter, pagination, expandProps);
    };
    // CRUD operations based on make/take behaviours
    if (makeOp !== 'unavailable') {
        spec.create = (props) => {
            if (typeof makeOp === 'function') {
                return makeOp(jxaColl, props);
            }
            return tryResolve(() => {
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
                return { uri: newUri };
            }, `${uri}:create`);
        };
    }
    if (takeOp !== 'unavailable') {
        spec.deleteItem = (itemUri) => {
            if (typeof takeOp === 'function') {
                const itemResult = specifierFromURI(itemUri);
                if (!itemResult.ok)
                    return { ok: false, error: itemResult.error };
                return takeOp(itemResult.value._jxa);
            }
            return tryResolve(() => {
                const itemSpec = specifierFromURI(itemUri);
                if (!itemSpec.ok)
                    throw new Error(itemSpec.error);
                if (itemSpec.value._jxa) {
                    itemSpec.value._jxa.delete();
                }
                else {
                    throw new Error(`Cannot delete: ${itemUri}`);
                }
                return { deleted: true };
            }, `${itemUri}:delete`);
        };
    }
    return spec;
}
// ============================================================================
// Filter Encoding (for URI construction)
// ============================================================================
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
/// <reference path="specifier.ts" />
/// <reference path="schema.ts" />
/// <reference path="lex.ts" />
/// <reference path="runtime.ts" />
const schemeRegistry = {};
function registerScheme(scheme, root, schema) {
    schemeRegistry[scheme] = { root, schema };
}
// Helpers isPrimitive, isScalar, isCollection defined in runtime.ts
// ============================================================================
// URI Resolution - Route through schema
// ============================================================================
function specifierFromURI(uri) {
    // Lex the URI
    const lexResult = lexURI(uri);
    if (!lexResult.ok) {
        return { ok: false, error: lexResult.error.message };
    }
    const { scheme, segments } = lexResult.value;
    // Look up scheme
    const registration = schemeRegistry[scheme];
    if (!registration) {
        const known = Object.keys(schemeRegistry);
        return { ok: false, error: `Unknown scheme: ${scheme}. Known: ${known.join(', ')}` };
    }
    // Start at root
    let currentJxa = registration.root();
    let currentSchema = registration.schema;
    let currentUri = `${scheme}://`;
    let inCollection = false;
    let collectionSchema = null;
    let collectionAddressing = [];
    let queryQualifier = null;
    // Walk segments
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const { head, qualifier } = segment;
        // Look up head in current schema
        const desc = currentSchema[head];
        if (desc) {
            // Found in schema
            const jxaName = desc.jxaName || head;
            if (isCollection(desc)) {
                // Navigate to collection
                currentJxa = currentJxa[jxaName];
                currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
                collectionSchema = desc.type;
                collectionAddressing = desc.dimension;
                inCollection = true;
                // Apply qualifier
                if (qualifier) {
                    const result = applyQualifier(currentJxa, qualifier, currentUri, collectionSchema, collectionAddressing);
                    if (!result.ok)
                        return result;
                    currentJxa = result.value.jxa;
                    currentUri = result.value.uri;
                    if (qualifier.kind === 'query') {
                        queryQualifier = qualifier;
                    }
                    else {
                        // Index or ID addressing - now at element level
                        currentSchema = collectionSchema;
                        inCollection = false;
                    }
                }
            }
            else if (isScalar(desc)) {
                if (isPrimitive(desc.type)) {
                    // Leaf scalar - can't navigate further
                    currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
                    const getter = () => currentJxa[jxaName]();
                    if (desc.set === 'default') {
                        return { ok: true, value: mutableSpec(currentUri, getter, (v) => currentJxa[jxaName].set(v)) };
                    }
                    return { ok: true, value: scalarSpec(currentUri, getter) };
                }
                else {
                    // Nested schema
                    currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
                    if (desc.computed) {
                        currentJxa = desc.computed(currentJxa);
                    }
                    else {
                        currentJxa = currentJxa[jxaName]();
                    }
                    currentSchema = desc.type;
                    inCollection = false;
                }
            }
        }
        else if (inCollection) {
            // Not in schema, but we're in a collection - treat as name/id address
            currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
            if (collectionAddressing.includes('name')) {
                currentJxa = currentJxa.byName(decodeURIComponent(head));
            }
            else if (collectionAddressing.includes('id')) {
                currentJxa = currentJxa.byId(decodeURIComponent(head));
            }
            else {
                return { ok: false, error: `Cannot address by name at ${currentUri}` };
            }
            currentSchema = collectionSchema;
            inCollection = false;
            // Apply qualifier if present (e.g., query on element)
            if (qualifier?.kind === 'query') {
                // Queries on elements expand lazy props, etc. - handle later
            }
        }
        else {
            // Not found and not in collection
            const available = Object.keys(currentSchema);
            return { ok: false, error: `Unknown segment '${head}' at ${currentUri}. Available: ${available.join(', ')}` };
        }
    }
    // Build final specifier
    if (inCollection) {
        // Convert query qualifier to sort/filter/pagination specs
        let sortSpec;
        let jsFilter;
        let pagination;
        let expand;
        if (queryQualifier) {
            if (queryQualifier.sort) {
                sortSpec = { by: queryQualifier.sort.field, direction: queryQualifier.sort.direction };
            }
            if (queryQualifier.filters.length > 0) {
                jsFilter = {};
                for (const f of queryQualifier.filters) {
                    if (f.op === 'equals')
                        jsFilter[f.field] = { equals: f.value };
                    else if (f.op === 'contains')
                        jsFilter[f.field] = { contains: f.value };
                    else if (f.op === 'startsWith')
                        jsFilter[f.field] = { startsWith: f.value };
                    else if (f.op === 'gt')
                        jsFilter[f.field] = { greaterThan: parseFloat(f.value) };
                    else if (f.op === 'lt')
                        jsFilter[f.field] = { lessThan: parseFloat(f.value) };
                }
            }
            if (queryQualifier.limit !== undefined || queryQualifier.offset !== undefined) {
                pagination = { limit: queryQualifier.limit, offset: queryQualifier.offset };
            }
            if (queryQualifier.expand) {
                expand = queryQualifier.expand;
            }
        }
        return {
            ok: true,
            value: createCollSpec(currentUri, currentJxa, collectionSchema, collectionAddressing, 'Item', 'default', 'default', sortSpec, jsFilter, pagination, expand)
        };
    }
    return {
        ok: true,
        value: createElemSpec(currentUri, currentJxa, currentSchema, [], 'Item')
    };
}
// ============================================================================
// Qualifier Application
// ============================================================================
function applyQualifier(jxa, qualifier, baseUri, schema, addressing) {
    switch (qualifier.kind) {
        case 'index': {
            if (!addressing.includes('index')) {
                return { ok: false, error: `Collection at ${baseUri} does not support index addressing` };
            }
            const newJxa = jxa.at(qualifier.value);
            const newUri = `${baseUri}[${qualifier.value}]`;
            return { ok: true, value: { jxa: newJxa, uri: newUri } };
        }
        case 'id': {
            if (!addressing.includes('id')) {
                return { ok: false, error: `Collection at ${baseUri} does not support id addressing` };
            }
            const newJxa = jxa.byId(qualifier.value);
            const newUri = `${baseUri}/${qualifier.value}`;
            return { ok: true, value: { jxa: newJxa, uri: newUri } };
        }
        case 'query': {
            // Apply filters, sort, pagination to collection
            let filtered = jxa;
            let uri = baseUri;
            if (qualifier.filters.length > 0) {
                const jxaFilter = {};
                for (const f of qualifier.filters) {
                    const jxaName = schema[f.field]?.jxaName || f.field;
                    jxaFilter[jxaName] = filterToJxa(f);
                }
                try {
                    filtered = jxa.whose(jxaFilter);
                }
                catch {
                    // JXA whose failed, filter in JS later
                }
                uri += '?' + qualifier.filters.map(f => `${f.field}${f.op === 'equals' ? '' : '.' + f.op}=${encodeURIComponent(f.value)}`).join('&');
            }
            if (qualifier.sort) {
                uri += (uri.includes('?') ? '&' : '?') + `sort=${qualifier.sort.field}.${qualifier.sort.direction}`;
            }
            if (qualifier.limit !== undefined) {
                uri += (uri.includes('?') ? '&' : '?') + `limit=${qualifier.limit}`;
            }
            if (qualifier.offset !== undefined) {
                uri += (uri.includes('?') ? '&' : '?') + `offset=${qualifier.offset}`;
            }
            return { ok: true, value: { jxa: filtered, uri } };
        }
    }
}
function filterToJxa(filter) {
    switch (filter.op) {
        case 'equals': return filter.value;
        case 'contains': return { _contains: filter.value };
        case 'startsWith': return { _beginsWith: filter.value };
        case 'gt': return { _greaterThan: parseFloat(filter.value) };
        case 'lt': return { _lessThan: parseFloat(filter.value) };
    }
}
// ============================================================================
// Exports
// ============================================================================
globalThis.registerScheme = registerScheme;
globalThis.specifierFromURI = specifierFromURI;
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./framework/schema.ts" />
/// <reference path="./framework/specifier.ts" />
/// <reference path="./framework/lex.ts" />
/// <reference path="./framework/runtime.ts" />
/// <reference path="./framework/uri.ts" />
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
// Schema Definitions
// ============================================================================
const SettingsSchema = {
    // App info
    name: t.string,
    version: t.string,
    frontmost: t.boolean,
    // Behavior
    alwaysBccMyself: rw(t.boolean),
    alwaysCcMyself: rw(t.boolean),
    downloadHtmlAttachments: rw(t.boolean),
    fetchInterval: rw(t.number),
    expandGroupAddresses: rw(t.boolean),
    // Composing
    defaultMessageFormat: rw(t.string),
    chooseSignatureWhenComposing: rw(t.boolean),
    quoteOriginalMessage: rw(t.boolean),
    sameReplyFormat: rw(t.boolean),
    includeAllOriginalMessageText: rw(t.boolean),
    // Display
    highlightSelectedConversation: rw(t.boolean),
    colorQuotedText: rw(t.boolean),
    levelOneQuotingColor: rw(t.string),
    levelTwoQuotingColor: rw(t.string),
    levelThreeQuotingColor: rw(t.string),
    // Fonts
    messageFont: rw(t.string),
    messageFontSize: rw(t.number),
    messageListFont: rw(t.string),
    messageListFontSize: rw(t.number),
    useFixedWidthFont: rw(t.boolean),
    fixedWidthFont: rw(t.string),
    fixedWidthFontSize: rw(t.number),
    // Sounds
    newMailSound: rw(t.string),
    shouldPlayOtherMailSounds: rw(t.boolean),
    // Spelling
    checkSpellingWhileTyping: rw(t.boolean),
};
const RuleConditionSchema = {
    header: t.string,
    qualifier: t.string,
    ruleType: t.string,
    expression: t.string,
};
const RuleSchema = {
    name: t.string,
    enabled: rw(t.boolean),
    allConditionsMustBeMet: rw(t.boolean),
    deleteMessage: rw(t.boolean),
    markRead: rw(t.boolean),
    markFlagged: rw(t.boolean),
    markFlagIndex: rw(t.number),
    stopEvaluatingRules: rw(t.boolean),
    forwardMessage: rw(t.string),
    redirectMessage: rw(t.string),
    replyText: rw(t.string),
    playSound: rw(t.string),
    highlightTextUsingColor: rw(t.string),
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
    ruleConditions: collection(RuleConditionSchema, [by.index], { make: 'unavailable', take: 'unavailable' }),
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
    subject: rw(t.string),
    sender: computed((jxa) => parseEmailAddress(str(jxa.sender()))),
    replyTo: computed((jxa) => parseEmailAddress(str(jxa.replyTo()))),
    dateSent: t.date,
    dateReceived: t.date,
    content: lazy(t.string),
    readStatus: rw(t.boolean),
    flaggedStatus: rw(t.boolean),
    junkMailStatus: rw(t.boolean),
    messageSize: t.number,
    toRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
    ccRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
    bccRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
    attachments: jxa(collection(AttachmentSchema, [by.name, by.index, by.id], { make: 'unavailable', take: 'unavailable' }), 'mailAttachments'),
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
    emailAddresses: computed((jxa) => {
        try {
            return jxa.emailAddresses() || [];
        }
        catch {
            return [];
        }
    }),
    mailboxes: collection(MailboxSchema, [by.name, by.index]),
    // Account-scoped standard mailboxes via computed properties
    inbox: computed((jxa) => jxa.mailbox({ name: 'INBOX' })),
    sent: computed((jxa) => {
        const app = Application('Mail');
        return app.sentMailbox().mailboxes().find((mb) => {
            try {
                return mb.account().id() === jxa.id();
            }
            catch {
                return false;
            }
        });
    }),
    drafts: computed((jxa) => {
        const app = Application('Mail');
        return app.draftsMailbox().mailboxes().find((mb) => {
            try {
                return mb.account().id() === jxa.id();
            }
            catch {
                return false;
            }
        });
    }),
    junk: computed((jxa) => {
        const app = Application('Mail');
        return app.junkMailbox().mailboxes().find((mb) => {
            try {
                return mb.account().id() === jxa.id();
            }
            catch {
                return false;
            }
        });
    }),
    trash: computed((jxa) => {
        const app = Application('Mail');
        return app.trashMailbox().mailboxes().find((mb) => {
            try {
                return mb.account().id() === jxa.id();
            }
            catch {
                return false;
            }
        });
    }),
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
    // Standard mailboxes as computed properties pointing to JXA accessors
    inbox: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.inbox },
    drafts: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.draftsMailbox, jxaName: 'draftsMailbox' },
    junk: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.junkMailbox, jxaName: 'junkMailbox' },
    outbox: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.outbox },
    sent: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.sentMailbox, jxaName: 'sentMailbox' },
    trash: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa.trashMailbox, jxaName: 'trashMailbox' },
    // Settings namespace - properties are directly on app, not in a sub-object
    settings: { dimension: 'scalar', type: SettingsSchema, set: 'unavailable', lazy: false, computed: (jxa) => jxa },
};
// ============================================================================
// Entry Point
// ============================================================================
let _mailApp = null;
function getMailApp() {
    if (_mailApp)
        return _mailApp;
    _mailApp = Application('Mail');
    return _mailApp;
}
registerScheme('mail', getMailApp, MailAppSchema);
// ============================================================================
// Exports
// ============================================================================
globalThis.specifierFromURI = specifierFromURI;
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
