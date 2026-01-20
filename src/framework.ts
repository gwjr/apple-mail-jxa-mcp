/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />

// ============================================================================
// Declarative JXA Schema Framework
// ============================================================================

// ============================================================================
// Helpers
// ============================================================================

function str(val: unknown): string {
  return val == null ? '' : '' + val;
}

function tryResolve<T>(fn: () => T, context: string): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: `${context}: ${e}` };
  }
}

// Registry of root specifier factories by scheme
const schemeRoots: Record<string, () => any> = {};

function registerScheme(scheme: string, root: () => any): void {
  schemeRoots[scheme] = root;
}

// Guard against recursive completion calls during error handling
let _inErrorSuggestion = false;

// Helper to format completion suggestions for error messages
function suggestCompletions(partial: string, max: number = 5): string {
  if (_inErrorSuggestion) return '';
  _inErrorSuggestion = true;
  try {
    const completions = getCompletions(partial);
    if (completions.length === 0) return '';
    const suggestions = completions.slice(0, max).map(c => c.label || c.value);
    return ` Did you mean: ${suggestions.join(', ')}?`;
  } finally {
    _inErrorSuggestion = false;
  }
}

// Deserialize a URI into a specifier
function specifierFromURI(uri: string): Result<{ _isSpecifier: true; uri: string; resolve(): Result<any> }> {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    const suggestions = suggestCompletions(uri);
    return { ok: false, error: `Invalid URI (no scheme): ${uri}.${suggestions}` };
  }

  const scheme = uri.slice(0, schemeEnd);
  let rest = uri.slice(schemeEnd + 3);

  // Separate query string
  let query: string | undefined;
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

  let current: any = rootFactory();
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
      } else if (current.byName) {
        current = current.byName(decodeURIComponent(name));
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
      } else if (current.byId) {
        current = current.byId(decodeURIComponent(name));
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
      } else {
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
    } catch (e) {
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
    } catch (e) {
      return { ok: false, error: `Failed to apply query: ${e} (resolved: ${resolved})` };
    }
  }

  return { ok: true, value: current };
}

// ============================================================================
// Core Type Descriptors
// ============================================================================

type JXAAccessor<T, JXAName extends string> = {
  readonly _accessor: true;
  readonly _type: T;
  readonly _jxaName: JXAName;
};

type JXALazyAccessor<T, JXAName extends string> = {
  readonly _lazyAccessor: true;
  readonly _type: T;
  readonly _jxaName: JXAName;
};

type JXACollection<ElementBase, JXAName extends string, Addressing extends readonly AddressingMode[]> = {
  readonly _collection: true;
  readonly _elementBase: ElementBase;
  readonly _jxaName: JXAName;
  readonly _addressing: Addressing;
};

type JXAComputed<T> = {
  readonly _computed: true;
  readonly _type: T;
  readonly _compute: (jxa: any) => T;
};

type AddressingMode = 'name' | 'index' | 'id';

// ============================================================================
// Helper Functions for Schema Definition
// ============================================================================

function accessor<T, JXAName extends string>(
  jxaName: JXAName
): JXAAccessor<T, JXAName> {
  return {
    _accessor: true,
    _type: undefined as any as T,
    _jxaName: jxaName
  };
}

function lazyAccessor<T, JXAName extends string>(
  jxaName: JXAName
): JXALazyAccessor<T, JXAName> {
  return {
    _lazyAccessor: true,
    _type: undefined as any as T,
    _jxaName: jxaName
  };
}

function collection<ElementBase, JXAName extends string, Addressing extends readonly AddressingMode[]>(
  jxaName: JXAName,
  elementBase: ElementBase,
  addressing: Addressing
): JXACollection<ElementBase, JXAName, Addressing> {
  return {
    _collection: true,
    _elementBase: elementBase,
    _jxaName: jxaName,
    _addressing: addressing
  };
}

function computed<T>(
  compute: (jxa: any) => T
): JXAComputed<T> {
  return {
    _computed: true,
    _type: undefined as any as T,
    _compute: compute
  };
}

// ============================================================================
// Type-Level Transformations
// ============================================================================

// Lower accessor/collection to concrete type
type Lower<A> =
  A extends JXAAccessor<infer T, any> ? T :
  A extends JXALazyAccessor<infer T, any> ? Specifier<T> :  // lazy stays as specifier
  A extends JXACollection<infer ElementBase, any, any> ? CollectionSpecifier<Derived<ElementBase>> :
  A extends JXAComputed<infer T> ? T :
  A;

// Lower all properties
type LowerAll<Base> = {
  [K in keyof Base]: Lower<Base[K]>;
};

// Derived type = lowered properties
type Derived<Base> = LowerAll<Base>;

// Derived constructor
type DerivedConstructor<Base extends Record<string, any>> = {
  new(_jxa: any, _uri?: string): LowerAll<Base>;
  fromJXA(_jxa: any, _uri?: string): LowerAll<Base>;
};

// ============================================================================
// Specifier Types
// ============================================================================

// Lift: scalar → Specifier<scalar>, Specifier<X> → Specifier<X>
type Lift<T> = T extends { readonly _isSpecifier: true }
  ? T
  : Specifier<T>;

// Specifier: wraps T, exposes lifted properties, has resolve()
type Specifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T>;
} & {
  readonly [K in keyof T]: Lift<T[K]>;
};

// Addressing capabilities
type NameAddressable<T> = { byName(name: string): Specifier<T> };
type IdAddressable<T> = { byId(id: string | number): Specifier<T> };
type IndexAddressable<T> = { byIndex(i: number): Specifier<T> };

// Build addressing type from mode list
type AddressingFromModes<T, Modes> =
  Modes extends readonly ['name', 'index', 'id'] ? NameAddressable<T> & IndexAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['name', 'index'] ? NameAddressable<T> & IndexAddressable<T> :
  Modes extends readonly ['name', 'id'] ? NameAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['index', 'id'] ? IndexAddressable<T> & IdAddressable<T> :
  Modes extends readonly ['name'] ? NameAddressable<T> :
  Modes extends readonly ['index'] ? IndexAddressable<T> :
  Modes extends readonly ['id'] ? IdAddressable<T> :
  IndexAddressable<T>; // Default fallback

// ============================================================================
// Whose Filter System
// ============================================================================

// Predicates for property filtering
type Predicate<T> =
  | { equals: T }
  | { contains: T extends string ? string : never }
  | { startsWith: T extends string ? string : never }
  | { greaterThan: T extends number ? number : never }
  | { lessThan: T extends number ? number : never };

// Filter spec: map of property names to predicates
type WhoseFilter<T> = {
  [K in keyof T]?: Predicate<T[K]>;
};

// Sort specification
type SortDirection = 'asc' | 'desc';
type SortSpec<T> = {
  by: keyof T;
  direction?: SortDirection;
};

// Pagination specification
type PaginationSpec = {
  limit?: number;
  offset?: number;
};

// Expand specification - list of properties to resolve inline
type ExpandSpec = string[];

// Collection specifier with whose, sortBy, pagination, and expand capabilities
type CollectionSpecifier<T, A = IndexAddressable<T>> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T[]>;
  whose(filter: WhoseFilter<T>): CollectionSpecifier<T, A>;
  sortBy(spec: SortSpec<T>): CollectionSpecifier<T, A>;
  paginate(spec: PaginationSpec): CollectionSpecifier<T, A>;
  expand(props: ExpandSpec): CollectionSpecifier<T, A>;
} & A;

// ============================================================================
// Runtime Implementation Factory
// ============================================================================

function createDerived<Base extends Record<string, any>>(
  schema: Base,
  typeName: string
): DerivedConstructor<Base> {

  class DerivedClass {
    private _jxa: any;
    private _uri?: string;

    constructor(_jxa: any, _uri?: string) {
      this._jxa = _jxa;
      this._uri = _uri;
      this._initializeProperties();
    }

    static fromJXA(_jxa: any, _uri?: string): LowerAll<Base> {
      return new DerivedClass(_jxa, _uri) as any;
    }

    private _initializeProperties() {
      for (const [key, descriptor] of Object.entries(schema)) {
        if (this._isAccessor(descriptor)) {
          this._defineAccessorProperty(key, descriptor);
        } else if (this._isLazyAccessor(descriptor)) {
          this._defineLazyAccessorProperty(key, descriptor);
        } else if (this._isCollection(descriptor)) {
          this._defineCollectionProperty(key, descriptor);
        } else if (this._isComputed(descriptor)) {
          this._defineComputedProperty(key, descriptor);
        }
      }
    }

    private _isAccessor(desc: any): desc is JXAAccessor<any, any> {
      return desc && desc._accessor === true;
    }

    private _isLazyAccessor(desc: any): desc is JXALazyAccessor<any, any> {
      return desc && desc._lazyAccessor === true;
    }

    private _isCollection(desc: any): desc is JXACollection<any, any, any> {
      return desc && desc._collection === true;
    }

    private _isComputed(desc: any): desc is JXAComputed<any> {
      return desc && desc._computed === true;
    }

    private _defineAccessorProperty(key: string, descriptor: JXAAccessor<any, any>) {
      Object.defineProperty(this, key, {
        get() {
          const value = this._jxa[descriptor._jxaName]();
          return this._convertValue(value);
        },
        enumerable: true
      });
    }

    private _defineLazyAccessorProperty(key: string, descriptor: JXALazyAccessor<any, any>) {
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

    private _defineCollectionProperty(key: string, descriptor: JXACollection<any, any, any>) {
      const self = this;
      Object.defineProperty(this, key, {
        get() {
          const jxaCollection = self._jxa[descriptor._jxaName];
          const base = self._uri || `${typeName.toLowerCase()}://`;
          const uri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
          return createCollectionSpecifier(
            uri,
            jxaCollection,
            descriptor._elementBase,
            descriptor._addressing,
            typeName + '_' + key
          );
        },
        enumerable: true
      });
    }

    private _defineComputedProperty(key: string, descriptor: JXAComputed<any>) {
      const self = this;
      Object.defineProperty(this, key, {
        get() {
          return descriptor._compute(self._jxa);
        },
        enumerable: true
      });
    }

    private _convertValue(value: any): any {
      if (value == null) return '';
      if (Array.isArray(value)) return value.map(v => this._convertValue(v));
      return value;
    }
  }

  return DerivedClass as any as DerivedConstructor<Base>;
}

// ============================================================================
// Specifier Factories
// ============================================================================

// Helper for scalar specifiers
function scalarSpecifier<T>(uri: string, getValue: () => T): Specifier<T> {
  return {
    _isSpecifier: true as const,
    uri,
    resolve(): Result<T> {
      return tryResolve(getValue, uri);
    }
  } as Specifier<T>;
}

// Element specifier factory
function createElementSpecifier<Base extends Record<string, any>>(
  uri: string,
  jxa: any,
  schema: Base,
  typeName: string
): Specifier<Derived<Base>> {

  const ElementClass = createDerived(schema, typeName);

  const spec: any = {
    _isSpecifier: true as const,
    uri,

    resolve(): Result<Derived<Base>> {
      return tryResolve(() => ElementClass.fromJXA(jxa, uri), uri);
    }
  };

  // Add lifted property specifiers
  for (const [key, descriptor] of Object.entries(schema)) {
    if ('_accessor' in (descriptor as any) || '_lazyAccessor' in (descriptor as any)) {
      // Both accessor and lazyAccessor lift to Specifier<T> on a Specifier
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxa[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    } else if ('_collection' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const desc = descriptor as JXACollection<any, any, any>;
          return createCollectionSpecifier(
            `${uri}/${key}`,
            jxa[desc._jxaName],
            desc._elementBase,
            desc._addressing,
            typeName + '_' + key
          );
        },
        enumerable: true
      });
    }
  }

  return spec as Specifier<Derived<Base>>;
}

// Collection specifier factory
function createCollectionSpecifier<
  ElementBase extends Record<string, any>,
  Modes extends readonly AddressingMode[]
>(
  uri: string,
  jxaCollection: any,
  elementBase: ElementBase,
  addressing: Modes,
  typeName: string,
  sortSpec?: SortSpec<any>,
  jsFilter?: WhoseFilter<any>,
  pagination?: PaginationSpec,
  expand?: ExpandSpec
): CollectionSpecifier<Derived<ElementBase>, AddressingFromModes<Derived<ElementBase>, Modes>> {

  const ElementClass = createDerived(elementBase, typeName);

  const spec: any = {
    _isSpecifier: true as const,
    uri,

    resolve(): Result<Derived<ElementBase>[]> {
      return tryResolve(() => {
        const jxaArray = typeof jxaCollection === 'function' ? jxaCollection() : jxaCollection;
        let results = jxaArray.map((jxa: any, i: number) => ElementClass.fromJXA(jxa, `${uri}[${i}]`));

        // Apply JS filter if specified
        if (jsFilter && Object.keys(jsFilter).length > 0) {
          results = results.filter((item: any) => {
            for (const [key, predicate] of Object.entries(jsFilter)) {
              const val = item[key];
              const pred = predicate as any;
              if ('contains' in pred && typeof val === 'string' && !val.includes(pred.contains)) return false;
              if ('startsWith' in pred && typeof val === 'string' && !val.startsWith(pred.startsWith)) return false;
              if ('greaterThan' in pred && !(val > pred.greaterThan)) return false;
              if ('lessThan' in pred && !(val < pred.lessThan)) return false;
              if ('equals' in pred && val !== pred.equals) return false;
            }
            return true;
          });
        }

        // Apply sort if specified
        if (sortSpec) {
          results.sort((a: any, b: any) => {
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
          results = results.map((item: any) => {
            // Create a shallow copy with all values resolved
            const expanded: any = {};
            for (const key of Object.keys(item)) {
              const val = item[key];
              if (expand.includes(key) && val && val._isSpecifier && typeof val.resolve === 'function') {
                const resolved = val.resolve();
                expanded[key] = resolved.ok ? resolved.value : val;
              } else {
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
    spec.byIndex = function(i: number): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(`${uri}[${i}]`, jxaCollection.at(i), elementBase, typeName);
    };
  }

  if (addressing.includes('name')) {
    spec.byName = function(name: string): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(
        `${uri}/${encodeURIComponent(name)}`,
        jxaCollection.byName(name),
        elementBase,
        typeName
      );
    };
  }

  if (addressing.includes('id')) {
    spec.byId = function(id: string | number): Specifier<Derived<ElementBase>> {
      return createElementSpecifier(`${uri}/${id}`, jxaCollection.byId(id), elementBase, typeName);
    };
  }

  // Add whose filtering
  spec.whose = function(filter: WhoseFilter<Derived<ElementBase>>): CollectionSpecifier<Derived<ElementBase>, any> {
    const filteredUri = `${uri}?${encodeFilter(filter)}`;

    // Build JXA whose clause
    const jxaFilter: any = {};
    for (const [key, predicate] of Object.entries(filter)) {
      const descriptor = elementBase[key];
      if (!descriptor || !('_jxaName' in descriptor)) {
        throw new Error(`Unknown property: ${key}`);
      }
      const jxaName = descriptor._jxaName;
      const pred = predicate as any;

      if ('equals' in pred) {
        jxaFilter[jxaName] = pred.equals;
      } else if ('contains' in pred) {
        jxaFilter[jxaName] = { _contains: pred.contains };
      } else if ('startsWith' in pred) {
        jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
      } else if ('greaterThan' in pred) {
        jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
      } else if ('lessThan' in pred) {
        jxaFilter[jxaName] = { _lessThan: pred.lessThan };
      }
    }

    // Try JXA whose first, fall back to JS filter
    try {
      const filteredJXA = jxaCollection.whose(jxaFilter);
      // Test if it works by accessing length (triggers evaluation)
      void filteredJXA.length;
      return createCollectionSpecifier(filteredUri, filteredJXA, elementBase, addressing, typeName, sortSpec, undefined, pagination, expand);
    } catch {
      // JXA filter failed, use JS post-filter
      return createCollectionSpecifier(filteredUri, jxaCollection, elementBase, addressing, typeName, sortSpec, filter, pagination, expand);
    }
  };

  // Add sortBy
  spec.sortBy = function(newSortSpec: SortSpec<Derived<ElementBase>>): CollectionSpecifier<Derived<ElementBase>, any> {
    const sep = uri.includes('?') ? '&' : '?';
    const sortedUri = `${uri}${sep}sort=${String(newSortSpec.by)}.${newSortSpec.direction || 'asc'}`;
    return createCollectionSpecifier(sortedUri, jxaCollection, elementBase, addressing, typeName, newSortSpec, jsFilter, pagination, expand);
  };

  // Add paginate
  spec.paginate = function(newPagination: PaginationSpec): CollectionSpecifier<Derived<ElementBase>, any> {
    const parts: string[] = [];
    if (newPagination.limit !== undefined) parts.push(`limit=${newPagination.limit}`);
    if (newPagination.offset !== undefined) parts.push(`offset=${newPagination.offset}`);
    const sep = uri.includes('?') ? '&' : '?';
    const paginatedUri = parts.length > 0 ? `${uri}${sep}${parts.join('&')}` : uri;
    return createCollectionSpecifier(paginatedUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, newPagination, expand);
  };

  // Add expand
  spec.expand = function(newExpand: ExpandSpec): CollectionSpecifier<Derived<ElementBase>, any> {
    const sep = uri.includes('?') ? '&' : '?';
    const expandUri = `${uri}${sep}expand=${newExpand.join(',')}`;
    return createCollectionSpecifier(expandUri, jxaCollection, elementBase, addressing, typeName, sortSpec, jsFilter, pagination, newExpand);
  };

  return spec as CollectionSpecifier<Derived<ElementBase>, AddressingFromModes<Derived<ElementBase>, typeof addressing>>;
}

// ============================================================================
// Filter Encoding/Decoding
// ============================================================================

function encodeFilter(filter: WhoseFilter<any>): string {
  const parts: string[] = [];
  for (const [key, predicate] of Object.entries(filter)) {
    const pred = predicate as any;
    if ('equals' in pred) {
      parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
    } else if ('contains' in pred) {
      parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
    } else if ('startsWith' in pred) {
      parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
    } else if ('greaterThan' in pred) {
      parts.push(`${key}.gt=${pred.greaterThan}`);
    } else if ('lessThan' in pred) {
      parts.push(`${key}.lt=${pred.lessThan}`);
    }
  }
  return parts.join('&');
}

function parseQuery(query: string): { filter: WhoseFilter<any>; sort?: SortSpec<any>; pagination?: PaginationSpec; expand?: ExpandSpec } {
  const result: { filter: WhoseFilter<any>; sort?: SortSpec<any>; pagination?: PaginationSpec; expand?: ExpandSpec } = { filter: {} };

  for (const part of query.split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);

    // Handle sort parameter
    if (key === 'sort') {
      const [by, direction] = value.split('.');
      result.sort = { by, direction: (direction as SortDirection) || 'asc' };
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
    } else {
      const prop = key.slice(0, dotIdx);
      const op = key.slice(dotIdx + 1);
      if (op === 'contains') {
        result.filter[prop] = { contains: decodeURIComponent(value) };
      } else if (op === 'startsWith') {
        result.filter[prop] = { startsWith: decodeURIComponent(value) };
      } else if (op === 'gt') {
        result.filter[prop] = { greaterThan: Number(value) };
      } else if (op === 'lt') {
        result.filter[prop] = { lessThan: Number(value) };
      }
    }
  }
  return result;
}

// ============================================================================
// MCP Completions Support
// ============================================================================

type Completion = {
  value: string;
  label?: string;
  description?: string;
};

// Get completions for a partial URI - purely by inspecting live specifier objects
function getCompletions(partial: string): Completion[] {
  // Parse scheme
  const schemeMatch = partial.match(/^([^:]*)(:\/?\/?)?(.*)?$/);
  if (!schemeMatch) return [];

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

function getPathCompletions(scheme: string, path: string): Completion[] {
  const completions: Completion[] = [];

  // Split path and find the partial segment being typed
  const segments = path.split('/');
  const partialSegment = segments.pop() || '';
  const completePath = segments.join('/');

  // Resolve the parent specifier
  const parentUri = `${scheme}://${completePath}`;
  const parentResult = specifierFromURI(parentUri);
  if (!parentResult.ok) return [];

  const parent = parentResult.value as any;

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

function isCollection(obj: any): boolean {
  return obj && (typeof obj.byName === 'function' || typeof obj.byIndex === 'function' || typeof obj.byId === 'function');
}

function getCollectionCompletions(collection: any, partial: string): Completion[] {
  const completions: Completion[] = [];

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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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

function getPropertyCompletions(specifier: any, partial: string): Completion[] {
  const completions: Completion[] = [];

  // Get all enumerable properties
  for (const key of Object.keys(specifier)) {
    if (key.startsWith('_') || key === 'uri' || key === 'resolve') continue;
    if (!key.toLowerCase().startsWith(partial.toLowerCase())) continue;

    const value = specifier[key];
    if (typeof value === 'function') continue;

    if (isCollection(value)) {
      completions.push({ value: `${key}/`, label: key, description: 'Collection' });
    } else if (value && value._isSpecifier && hasNavigableChildren(value)) {
      // Only mark as navigable if it has child properties beyond uri/resolve
      completions.push({ value: `${key}/`, label: key, description: 'Navigable' });
    } else {
      completions.push({ value: key, label: key, description: 'Property' });
    }
  }

  return completions;
}

function hasNavigableChildren(specifier: any): boolean {
  for (const key of Object.keys(specifier)) {
    if (key.startsWith('_') || key === 'uri' || key === 'resolve') continue;
    if (typeof specifier[key] !== 'function') return true;
  }
  return false;
}

function getQueryCompletions(scheme: string, basePath: string, query: string): Completion[] {
  const completions: Completion[] = [];

  // Resolve to get the collection and a sample element
  const spec = specifierFromURI(`${scheme}://${basePath}`);
  if (!spec.ok || !isCollection(spec.value)) return [];

  const collection = spec.value;

  // Parse current query
  const params = query.split('&');
  const lastParam = params[params.length - 1] || '';

  // Standard query params
  if (!lastParam.includes('=') || lastParam === '') {
    if ('sort'.startsWith(lastParam)) completions.push({ value: 'sort=', label: 'sort', description: 'Sort results' });
    if ('limit'.startsWith(lastParam)) completions.push({ value: 'limit=', label: 'limit', description: 'Limit count' });
    if ('offset'.startsWith(lastParam)) completions.push({ value: 'offset=', label: 'offset', description: 'Skip N' });
    if ('expand'.startsWith(lastParam)) completions.push({ value: 'expand=', label: 'expand', description: 'Expand lazy props' });
  }

  // Get a sample element to find filterable properties
  let sampleElement: any = null;
  try {
    const resolved = collection.resolve();
    if (resolved.ok && resolved.value.length > 0) {
      sampleElement = resolved.value[0];
    }
  } catch { /* ignore */ }

  if (!sampleElement) return completions;

  // Property name completion for filters
  if (!lastParam.includes('=') && !lastParam.includes('.')) {
    for (const key of Object.keys(sampleElement)) {
      if (key.startsWith('_')) continue;
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
        if (key.startsWith('_')) continue;
        const val = sampleElement[key];
        if (typeof val !== 'function' && !isCollection(val) && key.startsWith(sortVal)) {
          completions.push({ value: `sort=${key}.`, label: key, description: `Sort by ${key}` });
        }
      }
    } else {
      const [prop] = sortVal.split('.');
      const dir = sortVal.split('.')[1] || '';
      if ('asc'.startsWith(dir)) completions.push({ value: `sort=${prop}.asc`, label: 'asc', description: 'Ascending' });
      if ('desc'.startsWith(dir)) completions.push({ value: `sort=${prop}.desc`, label: 'desc', description: 'Descending' });
    }
  }

  // Expand value completion - find lazy specifier properties
  if (lastParam.startsWith('expand=')) {
    const expandVal = lastParam.slice(7);
    for (const key of Object.keys(sampleElement)) {
      if (key.startsWith('_')) continue;
      const val = sampleElement[key];
      if (val && val._isSpecifier && key.startsWith(expandVal)) {
        completions.push({ value: `expand=${key}`, label: key, description: 'Expand lazy property' });
      }
    }
  }

  return completions;
}
