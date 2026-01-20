"use strict";
/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
// ============================================================================
// Declarative JXA Schema Framework
// ============================================================================
// ============================================================================
// Helpers
// ============================================================================
function str(val) {
    return val == null ? '' : '' + val;
}
function tryResolve(fn, context) {
    try {
        return { ok: true, value: fn() };
    }
    catch (e) {
        return { ok: false, error: `${context}: ${e}` };
    }
}
// Registry of root specifier factories by scheme
const schemeRoots = {};
function registerScheme(scheme, root) {
    schemeRoots[scheme] = root;
}
// Guard against recursive completion calls during error handling
let _inErrorSuggestion = false;
// Helper to format completion suggestions for error messages
function suggestCompletions(partial, max = 5) {
    if (_inErrorSuggestion)
        return '';
    _inErrorSuggestion = true;
    try {
        const completions = getCompletions(partial);
        if (completions.length === 0)
            return '';
        const suggestions = completions.slice(0, max).map(c => c.label || c.value);
        return ` Did you mean: ${suggestions.join(', ')}?`;
    }
    finally {
        _inErrorSuggestion = false;
    }
}
// Deserialize a URI into a specifier
function specifierFromURI(uri) {
    const schemeEnd = uri.indexOf('://');
    if (schemeEnd === -1) {
        const suggestions = suggestCompletions(uri);
        return { ok: false, error: `Invalid URI (no scheme): ${uri}.${suggestions}` };
    }
    const scheme = uri.slice(0, schemeEnd);
    let rest = uri.slice(schemeEnd + 3);
    // Separate query string
    let query;
    const queryIdx = rest.indexOf('?');
    if (queryIdx !== -1) {
        query = rest.slice(queryIdx + 1);
        rest = rest.slice(0, queryIdx);
    }
    const rootFactory = schemeRoots[scheme];
    if (!rootFactory) {
        const knownSchemes = Object.keys(schemeRoots);
        const suggestion = knownSchemes.length > 0 ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
        return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
    }
    let current = rootFactory();
    let resolved = `${scheme}://`;
    for (const segment of rest.split('/').filter(s => s)) {
        const indexMatch = segment.match(/^(.+?)\[(\d+)\]$/);
        const name = indexMatch ? indexMatch[1] : segment;
        const index = indexMatch ? parseInt(indexMatch[2]) : undefined;
        try {
            // Property access or element access?
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
                const partial = resolved + (resolved.endsWith('://') ? '' : '/') + name;
                const suggestions = suggestCompletions(partial);
                return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${suggestions}` };
            }
            // Apply index if present
            if (index !== undefined) {
                if (!current.byIndex) {
                    return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
                }
                current = current.byIndex(index);
                resolved += `[${index}]`;
            }
        }
        catch (e) {
            const suggestions = suggestCompletions(resolved);
            return { ok: false, error: `Failed at '${segment}': ${e}.${suggestions}` };
        }
    }
    // Apply whose filter, sort, pagination, and expand if present
    if (query) {
        try {
            const { filter, sort, pagination, expand } = parseQuery(query);
            if (Object.keys(filter).length > 0 && current.whose) {
                current = current.whose(filter);
            }
            if (sort && current.sortBy) {
                current = current.sortBy(sort);
            }
            if (pagination && current.paginate) {
                current = current.paginate(pagination);
            }
            if (expand && expand.length > 0 && current.expand) {
                current = current.expand(expand);
            }
            resolved += '?' + query;
        }
        catch (e) {
            return { ok: false, error: `Failed to apply query: ${e} (resolved: ${resolved})` };
        }
    }
    return { ok: true, value: current };
}
// ============================================================================
// Helper Functions for Schema Definition
// ============================================================================
function accessor(jxaName) {
    return {
        _accessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function lazyAccessor(jxaName) {
    return {
        _lazyAccessor: true,
        _type: undefined,
        _jxaName: jxaName
    };
}
function collection(jxaName, elementBase, addressing) {
    return {
        _collection: true,
        _elementBase: elementBase,
        _jxaName: jxaName,
        _addressing: addressing
    };
}
function computed(compute) {
    return {
        _computed: true,
        _type: undefined,
        _compute: compute
    };
}
// ============================================================================
// Runtime Implementation Factory
// ============================================================================
function createDerived(schema, typeName) {
    class DerivedClass {
        _jxa;
        _uri;
        constructor(_jxa, _uri) {
            this._jxa = _jxa;
            this._uri = _uri;
            this._initializeProperties();
        }
        static fromJXA(_jxa, _uri) {
            return new DerivedClass(_jxa, _uri);
        }
        _initializeProperties() {
            for (const [key, descriptor] of Object.entries(schema)) {
                if (this._isAccessor(descriptor)) {
                    this._defineAccessorProperty(key, descriptor);
                }
                else if (this._isLazyAccessor(descriptor)) {
                    this._defineLazyAccessorProperty(key, descriptor);
                }
                else if (this._isCollection(descriptor)) {
                    this._defineCollectionProperty(key, descriptor);
                }
                else if (this._isComputed(descriptor)) {
                    this._defineComputedProperty(key, descriptor);
                }
            }
        }
        _isAccessor(desc) {
            return desc && desc._accessor === true;
        }
        _isLazyAccessor(desc) {
            return desc && desc._lazyAccessor === true;
        }
        _isCollection(desc) {
            return desc && desc._collection === true;
        }
        _isComputed(desc) {
            return desc && desc._computed === true;
        }
        _defineAccessorProperty(key, descriptor) {
            Object.defineProperty(this, key, {
                get() {
                    const value = this._jxa[descriptor._jxaName]();
                    return this._convertValue(value);
                },
                enumerable: true
            });
        }
        _defineLazyAccessorProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    const uri = self._uri
                        ? `${self._uri}/${key}`
                        : `${typeName.toLowerCase()}://.../${key}`;
                    return scalarSpecifier(uri, () => {
                        const value = self._jxa[descriptor._jxaName]();
                        return self._convertValue(value);
                    });
                },
                enumerable: true
            });
        }
        _defineCollectionProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    const jxaCollection = self._jxa[descriptor._jxaName];
                    const base = self._uri || `${typeName.toLowerCase()}://`;
                    const uri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
                    return createCollectionSpecifier(uri, jxaCollection, descriptor._elementBase, descriptor._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
        _defineComputedProperty(key, descriptor) {
            const self = this;
            Object.defineProperty(this, key, {
                get() {
                    return descriptor._compute(self._jxa);
                },
                enumerable: true
            });
        }
        _convertValue(value) {
            if (value == null)
                return '';
            if (Array.isArray(value))
                return value.map(v => this._convertValue(v));
            return value;
        }
    }
    return DerivedClass;
}
// ============================================================================
// Specifier Factories
// ============================================================================
// Helper for scalar specifiers
function scalarSpecifier(uri, getValue) {
    return {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(getValue, uri);
        }
    };
}
// Element specifier factory
function createElementSpecifier(uri, jxa, schema, typeName) {
    const ElementClass = createDerived(schema, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => ElementClass.fromJXA(jxa, uri), uri);
        }
    };
    // Add lifted property specifiers
    for (const [key, descriptor] of Object.entries(schema)) {
        if ('_accessor' in descriptor || '_lazyAccessor' in descriptor) {
            // Both accessor and lazyAccessor lift to Specifier<T> on a Specifier
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxa[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxa[desc._jxaName], desc._elementBase, desc._addressing, typeName + '_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Collection specifier factory
function createCollectionSpecifier(uri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, pagination, expand) {
    const ElementClass = createDerived(elementBase, typeName);
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => {
                const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
                let results = jxaArray.map((jxa, i) => ElementClass.fromJXA(jxa, `${uri}[${i}]`));
                // Apply JS filter if specified
                if (jsFilter && Object.keys(jsFilter).length > 0) {
                    results = results.filter((item) => {
                        for (const [key, predicate] of Object.entries(jsFilter)) {
                            const val = item[key];
                            const pred = predicate;
                            if ('contains' in pred && typeof val === 'string' && !val.includes(pred.contains))
                                return false;
                            if ('startsWith' in pred && typeof val === 'string' && !val.startsWith(pred.startsWith))
                                return false;
                            if ('greaterThan' in pred && !(val > pred.greaterThan))
                                return false;
                            if ('lessThan' in pred && !(val < pred.lessThan))
                                return false;
                            if ('equals' in pred && val !== pred.equals)
                                return false;
                        }
                        return true;
                    });
                }
                // Apply sort if specified
                if (sortSpec) {
                    results.sort((a, b) => {
                        const aVal = a[sortSpec.by];
                        const bVal = b[sortSpec.by];
                        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                        return sortSpec.direction === 'desc' ? -cmp : cmp;
                    });
                }
                // Apply pagination if specified
                if (pagination) {
                    const start = pagination.offset || 0;
                    const end = pagination.limit !== undefined ? start + pagination.limit : undefined;
                    results = results.slice(start, end);
                }
                // Apply expand if specified - resolve lazy specifiers
                if (expand && expand.length > 0) {
                    results = results.map((item) => {
                        // Create a shallow copy with all values resolved
                        const expanded = {};
                        for (const key of Object.keys(item)) {
                            const val = item[key];
                            if (expand.includes(key) && val && val._isSpecifier && typeof val.resolve === 'function') {
                                const resolved = val.resolve();
                                expanded[key] = resolved.ok ? resolved.value : val;
                            }
                            else {
                                expanded[key] = val;
                            }
                        }
                        return expanded;
                    });
                }
                return results;
            }, uri);
        }
    };
    // Add addressing methods
    if (addressing.includes('index')) {
        spec.byIndex = function (i) {
            return createElementSpecifier(`${uri}[${i}]`, jxaCollection.at(i), elementBase, typeName);
        };
    }
    if (addressing.includes('name')) {
        spec.byName = function (name) {
            return createElementSpecifier(`${uri}/${encodeURIComponent(name)}`, jxaCollection.byName(name), elementBase, typeName);
        };
    }
    if (addressing.includes('id')) {
        spec.byId = function (id) {
            return createElementSpecifier(`${uri}/${id}`, jxaCollection.byId(id), elementBase, typeName);
        };
    }
    // Add whose filtering
    spec.whose = function (filter) {
        const filteredUri = `${uri}?${encodeFilter(filter)}`;
        // Build JXA whose clause
        const jxaFilter = {};
        for (const [key, predicate] of Object.entries(filter)) {
            const descriptor = elementBase[key];
            if (!descriptor || !('_jxaName' in descriptor)) {
                throw new Error(`Unknown property: ${key}`);
            }
            const jxaName = descriptor._jxaName;
            const pred = predicate;
            if ('equals' in pred) {
                jxaFilter[jxaName] = pred.equals;
            }
            else if ('contains' in pred) {
                jxaFilter[jxaName] = { _contains: pred.contains };
            }
            else if ('startsWith' in pred) {
                jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
            }
            else if ('greaterThan' in pred) {
                jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
            }
            else if ('lessThan' in pred) {
                jxaFilter[jxaName] = { _lessThan: pred.lessThan };
            }
        }
        // Try JXA whose first, fall back to JS filter
        try {
            const filteredJXA = jxaCollection.whose(jxaFilter);
            // Test if it works by accessing length (triggers evaluation)
            void filteredJXA.length;
            return createCollectionSpecifier(filteredUri, filteredJXA, elementBase, addressing, typeName, sortSpec, undefined, pagination, expand);
        }
        catch {
            // JXA filter failed, use JS post-filter
            return createCollectionSpecifier(filteredUri, jxaCollection, elementBase, addressing, typeName, sortSpec, filter, pagination, expand);
        }
    };
    // Add sortBy
    spec.sortBy = function (newSortSpec) {
        const sep = uri.includes('?') ? '&' : '?';
        const sortedUri = `${uri}${sep}sort=${String(newSortSpec.by)}.${newSortSpec.direction || 'asc'}`;
        return createCollectionSpecifier(sortedUri, jxaCollection, elementBase, addressing, typeName, newSortSpec, jsFilter, pagination, expand);
    };
    // Add paginate
    spec.paginate = function (newPagination) {
        const parts = [];
        if (newPagination.limit !== undefined)
            parts.push(`limit=${newPagination.limit}`);
        if (newPagination.offset !== undefined)
            parts.push(`offset=${newPagination.offset}`);
        const sep = uri.includes('?') ? '&' : '?';
        const paginatedUri = parts.length > 0 ? `${uri}${sep}${parts.join('&')}` : uri;
        return createCollectionSpecifier(paginatedUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, newPagination, expand);
    };
    // Add expand
    spec.expand = function (newExpand) {
        const sep = uri.includes('?') ? '&' : '?';
        const expandUri = `${uri}${sep}expand=${newExpand.join(',')}`;
        return createCollectionSpecifier(expandUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, pagination, newExpand);
    };
    return spec;
}
// ============================================================================
// Filter Encoding/Decoding
// ============================================================================
function encodeFilter(filter) {
    const parts = [];
    for (const [key, predicate] of Object.entries(filter)) {
        const pred = predicate;
        if ('equals' in pred) {
            parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
        }
        else if ('contains' in pred) {
            parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
        }
        else if ('startsWith' in pred) {
            parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
        }
        else if ('greaterThan' in pred) {
            parts.push(`${key}.gt=${pred.greaterThan}`);
        }
        else if ('lessThan' in pred) {
            parts.push(`${key}.lt=${pred.lessThan}`);
        }
    }
    return parts.join('&');
}
function parseQuery(query) {
    const result = { filter: {} };
    for (const part of query.split('&')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = part.slice(0, eqIdx);
        const value = part.slice(eqIdx + 1);
        // Handle sort parameter
        if (key === 'sort') {
            const [by, direction] = value.split('.');
            result.sort = { by, direction: direction || 'asc' };
            continue;
        }
        // Handle pagination parameters
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
        // Handle expand parameter (comma-separated list of properties)
        if (key === 'expand') {
            result.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
            continue;
        }
        // Handle filter parameters
        const dotIdx = key.lastIndexOf('.');
        if (dotIdx === -1) {
            result.filter[key] = { equals: decodeURIComponent(value) };
        }
        else {
            const prop = key.slice(0, dotIdx);
            const op = key.slice(dotIdx + 1);
            if (op === 'contains') {
                result.filter[prop] = { contains: decodeURIComponent(value) };
            }
            else if (op === 'startsWith') {
                result.filter[prop] = { startsWith: decodeURIComponent(value) };
            }
            else if (op === 'gt') {
                result.filter[prop] = { greaterThan: Number(value) };
            }
            else if (op === 'lt') {
                result.filter[prop] = { lessThan: Number(value) };
            }
        }
    }
    return result;
}
// Get completions for a partial URI - purely by inspecting live specifier objects
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
        if (isCollection(child)) {
            return getCollectionCompletions(child, '');
        }
        // If it's a navigable specifier, suggest its properties
        if (child._isSpecifier) {
            return getPropertyCompletions(child, '');
        }
    }
    // Check if parent is a collection - suggest addressing
    if (isCollection(parent)) {
        return getCollectionCompletions(parent, partialSegment);
    }
    // Otherwise suggest properties matching partial
    return getPropertyCompletions(parent, partialSegment);
}
function isCollection(obj) {
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
        if (isCollection(value)) {
            completions.push({ value: `${key}/`, label: key, description: 'Collection' });
        }
        else if (value && value._isSpecifier && hasNavigableChildren(value)) {
            // Only mark as navigable if it has child properties beyond uri/resolve
            completions.push({ value: `${key}/`, label: key, description: 'Navigable' });
        }
        else {
            completions.push({ value: key, label: key, description: 'Property' });
        }
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
function getQueryCompletions(scheme, basePath, query) {
    const completions = [];
    // Resolve to get the collection and a sample element
    const spec = specifierFromURI(`${scheme}://${basePath}`);
    if (!spec.ok || !isCollection(spec.value))
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
            if (typeof val !== 'function' && !isCollection(val) && !(val && val._isSpecifier)) {
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
                if (typeof val !== 'function' && !isCollection(val) && key.startsWith(sortVal)) {
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
function parseEmailAddress(raw) {
    if (!raw)
        return { name: '', address: '' };
    // Format: "Name" <email@domain.com> or Name <email@domain.com> or just email@domain.com
    const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
    if (match) {
        const name = (match[1] || '').trim();
        const address = (match[2] || '').trim();
        // If no name but we have something that looks like an email, check if address has a name component
        if (!name && address.includes('@')) {
            return { name: '', address };
        }
        // If the "address" doesn't have @, it might just be a name
        if (!address.includes('@')) {
            return { name: address, address: '' };
        }
        return { name, address };
    }
    // Fallback: treat the whole thing as the address
    return { name: '', address: raw.trim() };
}
// ============================================================================
// Apple Mail Schema Definitions
// ============================================================================
const RecipientBase = {
    name: accessor('name'),
    address: accessor('address'),
};
const AttachmentBase = {
    id: accessor('id'),
    name: accessor('name'),
    fileSize: accessor('fileSize'),
};
const MessageBase = {
    id: accessor('id'),
    messageId: accessor('messageId'),
    subject: accessor('subject'),
    sender: computed((jxa) => parseEmailAddress(str(jxa.sender()))),
    replyTo: computed((jxa) => parseEmailAddress(str(jxa.replyTo()))),
    dateSent: accessor('dateSent'),
    dateReceived: accessor('dateReceived'),
    content: lazyAccessor('content'), // lazy - expensive to fetch
    readStatus: accessor('readStatus'),
    flaggedStatus: accessor('flaggedStatus'),
    junkMailStatus: accessor('junkMailStatus'),
    messageSize: accessor('messageSize'),
    toRecipients: collection('toRecipients', RecipientBase, ['name', 'index']),
    ccRecipients: collection('ccRecipients', RecipientBase, ['name', 'index']),
    bccRecipients: collection('bccRecipients', RecipientBase, ['name', 'index']),
    attachments: collection('mailAttachments', AttachmentBase, ['name', 'index', 'id']),
};
const MailboxBase = {
    name: accessor('name'),
    unreadCount: accessor('unreadCount'),
    messages: collection('messages', MessageBase, ['index', 'id'])
};
// Self-referential: mailboxes contain mailboxes
MailboxBase.mailboxes = collection('mailboxes', MailboxBase, ['name', 'index']);
const AccountBase = {
    id: accessor('id'),
    name: accessor('name'),
    fullName: accessor('fullName'),
    emailAddresses: accessor('emailAddresses'),
    mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'])
};
// Standard mailbox schemas (same structure as Mailbox but different accessors)
const StandardMailboxBase = {
    name: accessor('name'),
    unreadCount: accessor('unreadCount'),
    messages: collection('messages', MessageBase, ['index', 'id'])
};
const MailAppBase = {
    accounts: collection('accounts', AccountBase, ['name', 'index', 'id']),
    // Standard mailboxes (aggregate across all accounts)
    inbox: { _standardMailbox: true, _jxaName: 'inbox' },
    drafts: { _standardMailbox: true, _jxaName: 'draftsMailbox' },
    junk: { _standardMailbox: true, _jxaName: 'junkMailbox' },
    outbox: { _standardMailbox: true, _jxaName: 'outbox' },
    sent: { _standardMailbox: true, _jxaName: 'sentMailbox' },
    trash: { _standardMailbox: true, _jxaName: 'trashMailbox' }
};
// ============================================================================
// Create Derived Types
// ============================================================================
const Recipient = createDerived(RecipientBase, 'Recipient');
const Attachment = createDerived(AttachmentBase, 'Attachment');
const Message = createDerived(MessageBase, 'Message');
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');
// ============================================================================
// Entry Point
// ============================================================================
const MailApp = createDerived(MailAppBase, 'Mail');
// Create derived type for standard mailboxes
const StandardMailbox = createDerived(StandardMailboxBase, 'StandardMailbox');
// Helper to create standard mailbox specifier
function createStandardMailboxSpecifier(uri, jxaMailbox) {
    const spec = {
        _isSpecifier: true,
        uri,
        resolve() {
            return tryResolve(() => StandardMailbox.fromJXA(jxaMailbox, uri), uri);
        }
    };
    // Add properties from StandardMailboxBase
    for (const [key, descriptor] of Object.entries(StandardMailboxBase)) {
        if ('_accessor' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const jxaName = descriptor._jxaName;
                    return scalarSpecifier(`${uri}/${key}`, () => {
                        const value = jxaMailbox[jxaName]();
                        return value == null ? '' : value;
                    });
                },
                enumerable: true
            });
        }
        else if ('_collection' in descriptor) {
            Object.defineProperty(spec, key, {
                get() {
                    const desc = descriptor;
                    return createCollectionSpecifier(`${uri}/${key}`, jxaMailbox[desc._jxaName], desc._elementBase, desc._addressing, 'StandardMailbox_' + key);
                },
                enumerable: true
            });
        }
    }
    return spec;
}
// Lazily initialized app specifier
let _mailApp = null;
function getMailApp() {
    if (!_mailApp) {
        const jxa = Application('Mail');
        const app = MailApp.fromJXA(jxa, 'mail://');
        // Add specifier-like properties
        app.uri = 'mail://';
        app._isSpecifier = true;
        app.resolve = () => ({ ok: true, value: app });
        // Add standard mailbox specifiers
        const standardMailboxes = [
            { name: 'inbox', jxaName: 'inbox' },
            { name: 'drafts', jxaName: 'draftsMailbox' },
            { name: 'junk', jxaName: 'junkMailbox' },
            { name: 'outbox', jxaName: 'outbox' },
            { name: 'sent', jxaName: 'sentMailbox' },
            { name: 'trash', jxaName: 'trashMailbox' }
        ];
        for (const { name, jxaName } of standardMailboxes) {
            Object.defineProperty(app, name, {
                get() {
                    return createStandardMailboxSpecifier(`mail://${name}`, jxa[jxaName]);
                },
                enumerable: true
            });
        }
        _mailApp = app;
    }
    return _mailApp;
}
// Register mail:// scheme
registerScheme('mail', getMailApp);
// Export for JXA
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
    return { mimeType: 'application/json', text: result.value };
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
        { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' }
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
    }
];
// Export for JXA
globalThis.readResource = readResource;
globalThis.listResources = listResources;
globalThis.resourceTemplates = resourceTemplates;
