// scratch/framework.ts - Plugboard v4 Framework
//
// Core types, proto system, URI parsing - no app-specific code.
// App schemas (mail.ts, notes.ts) use these building blocks.

// ─────────────────────────────────────────────────────────────────────────────
// Brands (compile-time only)
// ─────────────────────────────────────────────────────────────────────────────

declare const ScalarBrand: unique symbol;
declare const CollectionBrand: unique symbol;
declare const LazyBrand: unique symbol;
declare const EagerBrand: unique symbol;
declare const SettableBrand: unique symbol;
declare const ByIndexBrand: unique symbol;
declare const ByNameBrand: unique symbol;
declare const ByIdBrand: unique symbol;
declare const JxaNameBrand: unique symbol;

// ─────────────────────────────────────────────────────────────────────────────
// Type-level utilities
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: string };

type Lazy<T> = T & { readonly [LazyBrand]: true };

type ScalarType<T> = { readonly [ScalarBrand]: T };
type EagerScalarType<T> = ScalarType<T> & { readonly [EagerBrand]: true };
type LazyScalarType<T> = ScalarType<T> & { readonly [LazyBrand]: true };

type CollectionType<Item> = { readonly [CollectionBrand]: Item };
type EagerCollectionType<Item> = CollectionType<Item> & { readonly [EagerBrand]: true };
type LazyCollectionType<Item> = CollectionType<Item> & { readonly [LazyBrand]: true };

type ExtractScalar<T> = T extends { readonly [ScalarBrand]: infer S } ? S : never;
type ExtractItem<T> = T extends { readonly [CollectionBrand]: infer I } ? I : never;
type IsLazy<T> = T extends { readonly [LazyBrand]: true } ? true : false;

// ─────────────────────────────────────────────────────────────────────────────
// Filter Operators
// ─────────────────────────────────────────────────────────────────────────────

interface FilterOperator<T> {
  readonly name: string;
  parseUri(s: string): T;
  toJxa(v: T): any;
  test(itemVal: any, predVal: T): boolean;
  toUri(v: T): string;
}

const equalsOp: FilterOperator<any> = {
  name: 'equals',
  parseUri: (s) => s,
  toJxa: (v) => v,
  test: (a, b) => a === b,
  toUri: (v) => encodeURIComponent(String(v)),
};

const containsOp: FilterOperator<string> = {
  name: 'contains',
  parseUri: (s) => s,
  toJxa: (v) => ({ _contains: v }),
  test: (a, b) => typeof a === 'string' && a.includes(b),
  toUri: (v) => encodeURIComponent(v),
};

const startsWithOp: FilterOperator<string> = {
  name: 'startsWith',
  parseUri: (s) => s,
  toJxa: (v) => ({ _beginsWith: v }),
  test: (a, b) => typeof a === 'string' && a.startsWith(b),
  toUri: (v) => encodeURIComponent(v),
};

const gtOp: FilterOperator<number> = {
  name: 'gt',
  parseUri: parseFloat,
  toJxa: (v) => ({ _greaterThan: v }),
  test: (a, b) => a > b,
  toUri: (v) => String(v),
};

const ltOp: FilterOperator<number> = {
  name: 'lt',
  parseUri: parseFloat,
  toJxa: (v) => ({ _lessThan: v }),
  test: (a, b) => a < b,
  toUri: (v) => String(v),
};

const filterOperators = [equalsOp, containsOp, startsWithOp, gtOp, ltOp] as const;

function getOperatorByName(name: string): FilterOperator<any> | undefined {
  return filterOperators.find(op => op.name === name);
}

type PredicateValue<Op extends FilterOperator<any>> = {
  operator: Op;
  value: Op extends FilterOperator<infer T> ? T : never;
};

type Predicate = PredicateValue<FilterOperator<any>>;

const equals = (value: any): Predicate => ({ operator: equalsOp, value });
const contains = (value: string): Predicate => ({ operator: containsOp, value });
const startsWith = (value: string): Predicate => ({ operator: startsWithOp, value });
const gt = (value: number): Predicate => ({ operator: gtOp, value });
const lt = (value: number): Predicate => ({ operator: ltOp, value });

type WhoseFilter = Record<string, Predicate>;
type SortDirection = 'asc' | 'desc';
type SortSpec<T> = { by: keyof T; direction?: SortDirection };
type PaginationSpec = { limit?: number; offset?: number };

type QueryState = {
  filter?: WhoseFilter;
  sort?: SortSpec<any>;
  pagination?: PaginationSpec;
  expand?: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Delegate interface
// ─────────────────────────────────────────────────────────────────────────────

interface Delegate {
  _jxa(): any;
  prop(key: string): Delegate;
  byIndex(n: number): Delegate;
  byName(name: string): Delegate;
  byId(id: string | number): Delegate;
  uri(): string;
  set(value: any): void;

  withFilter(filter: WhoseFilter): Delegate;
  withSort(sort: SortSpec<any>): Delegate;
  withPagination(pagination: PaginationSpec): Delegate;
  withExpand(fields: string[]): Delegate;
  queryState(): QueryState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Res type
// ─────────────────────────────────────────────────────────────────────────────

type Res<P> = P & { _delegate: Delegate };

function createRes<P extends object>(delegate: Delegate, proto: P): Res<P> {
  const handler: ProxyHandler<{ _delegate: Delegate }> = {
    get(t, prop: string | symbol, receiver) {
      if (prop === '_delegate') return t._delegate;

      if (prop in proto) {
        const value = (proto as any)[prop];
        if (typeof value === 'function') {
          return value.bind(receiver);
        }
        if (typeof value === 'object' && value !== null) {
          // Check for computed navigation first
          const navInfo = getComputedNav(value);
          if (navInfo) {
            const targetDelegate = navInfo.navigate(t._delegate);
            return createRes(targetDelegate, navInfo.targetProto);
          }
          // Normal property navigation - use jxaName if defined, otherwise use the property name
          const jxaName = getJxaName(value) || (prop as string);
          return createRes(t._delegate.prop(jxaName), value);
        }
        return value;
      }

      return undefined;
    }
  };

  return new Proxy({ _delegate: delegate } as any, handler);
}

// ─────────────────────────────────────────────────────────────────────────────
// Base Prototypes
// ─────────────────────────────────────────────────────────────────────────────

interface BaseProtoType {
  resolve(): any;
  resolve_eager(): any;
  exists(): boolean;
  specifier(): Specifier;
}

const baseScalar = {
  resolve(this: { _delegate: Delegate }) {
    return this._delegate._jxa();
  },
  resolve_eager(this: { _delegate: Delegate; resolve(): any }) {
    return this.resolve();
  },
  exists(this: { _delegate: Delegate }) {
    try {
      this._delegate._jxa();
      return true;
    } catch {
      return false;
    }
  },
  specifier(this: { _delegate: Delegate }) {
    return { uri: this._delegate.uri() };
  },
} as BaseProtoType;

const baseCollection = {
  resolve(this: { _delegate: Delegate }) {
    return this._delegate._jxa();
  },
  resolve_eager(this: { _delegate: Delegate; resolve(): any }) {
    return this.resolve();
  },
  exists(this: { _delegate: Delegate }) {
    try {
      this._delegate._jxa();
      return true;
    } catch {
      return false;
    }
  },
  specifier(this: { _delegate: Delegate }) {
    return { uri: this._delegate.uri() };
  },
} as BaseProtoType;

// Convenience alias
const eagerScalar = baseScalar;

// ─────────────────────────────────────────────────────────────────────────────
// Composers
// ─────────────────────────────────────────────────────────────────────────────

function makeLazy<P extends BaseProtoType>(proto: P): P & { readonly [LazyBrand]: true } {
  return {
    ...proto,
    resolve_eager(this: { specifier(): Specifier }): Specifier {
      return this.specifier();
    },
  } as P & { readonly [LazyBrand]: true };
}

interface SettableProto {
  set(value: any): void;
}

function withSet<P extends BaseProtoType>(proto: P): P & SettableProto & { readonly [SettableBrand]: true } {
  return {
    ...proto,
    set(this: { _delegate: Delegate }, value: any) {
      this._delegate.set(value);
    },
  } as P & SettableProto & { readonly [SettableBrand]: true };
}

const collectionItemProtos = new WeakMap<object, object>();

interface ByIndexProto<Item> {
  byIndex(n: number): Res<Item>;
}

function withByIndex<Item extends object>(itemProto: Item) {
  return function<P extends BaseProtoType>(proto: P): P & ByIndexProto<Item> & { readonly [ByIndexBrand]: true } {
    const result = {
      ...proto,
      byIndex(this: { _delegate: Delegate }, n: number): Res<Item> {
        return createRes(this._delegate.byIndex(n), itemProto);
      },
    } as P & ByIndexProto<Item> & { readonly [ByIndexBrand]: true };
    collectionItemProtos.set(result, itemProto);
    return result;
  };
}

interface ByNameProto<Item> {
  byName(name: string): Res<Item>;
}

function withByName<Item extends object>(itemProto: Item) {
  return function<P extends BaseProtoType>(proto: P): P & ByNameProto<Item> & { readonly [ByNameBrand]: true } {
    const result = {
      ...proto,
      byName(this: { _delegate: Delegate }, name: string): Res<Item> {
        return createRes(this._delegate.byName(name), itemProto);
      },
    } as P & ByNameProto<Item> & { readonly [ByNameBrand]: true };
    collectionItemProtos.set(result, itemProto);
    return result;
  };
}

interface ByIdProto<Item> {
  byId(id: string | number): Res<Item>;
}

function withById<Item extends object>(itemProto: Item) {
  return function<P extends BaseProtoType>(proto: P): P & ByIdProto<Item> & { readonly [ByIdBrand]: true } {
    const result = {
      ...proto,
      byId(this: { _delegate: Delegate }, id: string | number): Res<Item> {
        return createRes(this._delegate.byId(id), itemProto);
      },
    } as P & ByIdProto<Item> & { readonly [ByIdBrand]: true };
    collectionItemProtos.set(result, itemProto);
    return result;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JXA Name Mapping
// ─────────────────────────────────────────────────────────────────────────────

// Store jxaName mapping (proto -> jxaName)
const jxaNameMap = new WeakMap<object, string>();

type JxaNamedProto<P> = P & { readonly [JxaNameBrand]: string };

function withJxaName<P extends object>(proto: P, jxaName: string): JxaNamedProto<P> {
  // Create a new object that inherits from proto
  const named = Object.assign(Object.create(null), proto) as JxaNamedProto<P>;
  jxaNameMap.set(named, jxaName);
  // Also copy over the item proto if this is a collection
  const itemProto = collectionItemProtos.get(proto);
  if (itemProto) {
    collectionItemProtos.set(named, itemProto);
  }
  return named;
}

function getJxaName(proto: object): string | undefined {
  return jxaNameMap.get(proto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed Properties
// ─────────────────────────────────────────────────────────────────────────────

// A computed property transforms the raw value from the delegate
function computed<T>(transform: (raw: any) => T): BaseProtoType {
  return {
    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      return transform(raw);
    },
    resolve_eager(this: { resolve(): T }) {
      return this.resolve();
    },
    exists(this: { _delegate: Delegate }) {
      try {
        this._delegate._jxa();
        return true;
      } catch {
        return false;
      }
    },
    specifier(this: { _delegate: Delegate }) {
      return { uri: this._delegate.uri() };
    },
  };
}

// Lazy computed - resolve_eager returns specifier instead of value
function lazyComputed<T>(transform: (raw: any) => T): BaseProtoType & { readonly [LazyBrand]: true } {
  return makeLazy(computed(transform));
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed Navigation
// ─────────────────────────────────────────────────────────────────────────────

// computedNav is for properties that require multiple delegate operations to navigate.
// For simple property navigation (including jxaName mapping), use withJxaName instead.

declare const ComputedNavBrand: unique symbol;

type NavigationFn = (d: Delegate) => Delegate;

const computedNavMap = new WeakMap<object, { navigate: NavigationFn; targetProto: object }>();

type ComputedNavProto<P> = P & { readonly [ComputedNavBrand]: true };

function computedNav<P extends object>(
  navigate: NavigationFn,
  targetProto: P
): ComputedNavProto<P> {
  // Create a proto that has the base methods (resolve, exists, specifier) using the navigated delegate
  const navProto = {
    resolve(this: { _delegate: Delegate }) {
      return navigate(this._delegate)._jxa();
    },
    resolve_eager(this: { resolve(): any }) {
      return this.resolve();
    },
    exists(this: { _delegate: Delegate }) {
      try {
        navigate(this._delegate)._jxa();
        return true;
      } catch {
        return false;
      }
    },
    specifier(this: { _delegate: Delegate }) {
      return { uri: navigate(this._delegate).uri() };
    },
  } as unknown as ComputedNavProto<P>;

  computedNavMap.set(navProto, { navigate, targetProto });
  return navProto;
}

function getComputedNav(proto: object): { navigate: NavigationFn; targetProto: object } | undefined {
  return computedNavMap.get(proto);
}

interface QueryableProto<T> extends BaseProtoType {
  whose(filter: WhoseFilter): Res<QueryableProto<T> & BaseProtoType>;
  sortBy(spec: SortSpec<T>): Res<QueryableProto<T> & BaseProtoType>;
  paginate(spec: PaginationSpec): Res<QueryableProto<T> & BaseProtoType>;
  expand(fields: string[]): Res<QueryableProto<T> & BaseProtoType>;
}

function applyQueryState<T>(items: T[], query: QueryState): T[] {
  let results = items;

  if (query.filter && Object.keys(query.filter).length > 0) {
    results = results.filter((item: any) => {
      for (const [field, pred] of Object.entries(query.filter!)) {
        if (!pred.operator.test(item[field], pred.value)) {
          return false;
        }
      }
      return true;
    });
  }

  if (query.sort) {
    const { by, direction = 'asc' } = query.sort;
    results = [...results].sort((a: any, b: any) => {
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

function withQuery<P extends BaseProtoType>(proto: P): P & QueryableProto<any> {
  const itemProto = collectionItemProtos.get(proto);

  return {
    ...proto,

    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      const query = this._delegate.queryState();
      let results = applyQueryState(raw, query);

      if (query.expand && query.expand.length > 0 && itemProto) {
        results = results.map((item: any, idx: number) => {
          const expanded = { ...item };
          for (const field of query.expand!) {
            const fieldProto = (itemProto as any)[field];
            if (fieldProto && typeof fieldProto === 'object' && 'resolve' in fieldProto) {
              try {
                if (field in item && typeof item[field] === 'function') {
                  expanded[field] = item[field]();
                } else if (field in item) {
                  expanded[field] = item[field];
                }
              } catch {
              }
            }
          }
          return expanded;
        });
      }

      return results;
    },

    whose(this: { _delegate: Delegate }, filter: WhoseFilter) {
      const newDelegate = this._delegate.withFilter(filter);
      return createRes(newDelegate, withQuery(proto));
    },

    sortBy(this: { _delegate: Delegate }, spec: SortSpec<any>) {
      const newDelegate = this._delegate.withSort(spec);
      return createRes(newDelegate, withQuery(proto));
    },

    paginate(this: { _delegate: Delegate }, spec: PaginationSpec) {
      const newDelegate = this._delegate.withPagination(spec);
      return createRes(newDelegate, withQuery(proto));
    },

    expand(this: { _delegate: Delegate }, fields: string[]) {
      const newDelegate = this._delegate.withExpand(fields);
      return createRes(newDelegate, withQuery(proto));
    },
  } as P & QueryableProto<any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-level enforcement
// ─────────────────────────────────────────────────────────────────────────────

type HasAccessor<P> = P extends { byIndex: any } | { byName: any } | { byId: any }
  ? P
  : never;

type ProtoMatchesLaziness<IsLazyFlag extends boolean, P> =
  IsLazyFlag extends true
    ? P extends { resolve_eager(): Specifier } ? P : never
    : P;

type ValidCollectionProto<P> = HasAccessor<P>;

// ─────────────────────────────────────────────────────────────────────────────
// Path and URI utilities
// ─────────────────────────────────────────────────────────────────────────────

type PathSegment =
  | { kind: 'root'; scheme: string }
  | { kind: 'prop'; name: string }
  | { kind: 'index'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'id'; value: string | number };

function buildURI(segments: PathSegment[]): string {
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

function buildQueryString(query: QueryState): string {
  const parts: string[] = [];

  if (query.filter) {
    for (const [field, pred] of Object.entries(query.filter)) {
      const opName = pred.operator.name;
      const value = pred.operator.toUri(pred.value);
      if (opName === 'equals') {
        parts.push(`${field}=${value}`);
      } else {
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

function pipe<A, B>(a: A, f: (a: A) => B): B {
  return f(a);
}

function pipe2<A, B, C>(a: A, f: (a: A) => B, g: (b: B) => C): C {
  return g(f(a));
}

function pipe3<A, B, C, D>(a: A, f: (a: A) => B, g: (b: B) => C, h: (c: C) => D): D {
  return h(g(f(a)));
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Lexer
// ─────────────────────────────────────────────────────────────────────────────

type FilterOp = 'equals' | 'contains' | 'startsWith' | 'gt' | 'lt';

type Filter = {
  field: string;
  op: FilterOp;
  value: string;
};

type IndexQualifier = { kind: 'index'; value: number };
type IdQualifier = { kind: 'id'; value: number };
type QueryQualifier = {
  kind: 'query';
  filters: Filter[];
  sort?: { field: string; direction: SortDirection };
  limit?: number;
  offset?: number;
  expand?: string[];
};

type Qualifier = IndexQualifier | IdQualifier | QueryQualifier;

type URISegment = {
  head: string;
  qualifier?: Qualifier;
};

type ParsedURI = {
  scheme: string;
  segments: URISegment[];
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseFilterOp(op: string): FilterOp {
  switch (op) {
    case 'contains': return 'contains';
    case 'startsWith': return 'startsWith';
    case 'gt': return 'gt';
    case 'lt': return 'lt';
    default: return 'equals';
  }
}

function parseQueryQualifier(query: string): QueryQualifier {
  const result: QueryQualifier = { kind: 'query', filters: [] };

  for (const part of query.split('&')) {
    if (!part) continue;

    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;

    const key = part.slice(0, eqIdx);
    const value = decodeURIComponent(part.slice(eqIdx + 1));

    if (key === 'sort') {
      const dotIdx = value.lastIndexOf('.');
      if (dotIdx !== -1) {
        const field = value.slice(0, dotIdx);
        const dir = value.slice(dotIdx + 1);
        result.sort = { field, direction: dir === 'desc' ? 'desc' : 'asc' };
      } else {
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
    } else {
      const field = key.slice(0, dotIdx);
      const opStr = key.slice(dotIdx + 1);
      const op = parseFilterOp(opStr);
      result.filters.push({ field, op, value });
    }
  }

  return result;
}

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s);
}

function parseSegments(path: string): URISegment[] {
  if (!path) return [];

  const segments: URISegment[] = [];
  let remaining = path;

  while (remaining) {
    if (remaining.startsWith('/')) {
      remaining = remaining.slice(1);
      if (!remaining) break;
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

    const segment: URISegment = { head };

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

function lexURI(uri: string): Result<ParsedURI> {
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

// ─────────────────────────────────────────────────────────────────────────────
// Scheme Registry
// ─────────────────────────────────────────────────────────────────────────────

type SchemeRegistration<P extends object> = {
  createRoot: () => Delegate;
  proto: P;
};

const schemeRegistry: Record<string, SchemeRegistration<any>> = {};

function registerScheme<P extends object>(
  scheme: string,
  createRoot: () => Delegate,
  proto: P
): void {
  schemeRegistry[scheme] = { createRoot, proto };
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Resolution
// ─────────────────────────────────────────────────────────────────────────────

function filtersToWhoseFilter(filters: Filter[]): WhoseFilter {
  const result: WhoseFilter = {};
  for (const { field, op, value } of filters) {
    const operator = getOperatorByName(op);
    if (operator) {
      result[field] = { operator, value: operator.parseUri(value) };
    }
  }
  return result;
}

function sortToSortSpec(sort: { field: string; direction: SortDirection }): SortSpec<any> {
  return { by: sort.field, direction: sort.direction };
}

function applyQueryQualifier(
  delegate: Delegate,
  proto: any,
  qualifier: QueryQualifier
): { delegate: Delegate; proto: any } {
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

function hasByIndex(proto: object): proto is { byIndex: (n: number) => unknown } {
  return 'byIndex' in proto && typeof (proto as any).byIndex === 'function';
}

function hasByName(proto: object): proto is { byName: (name: string) => unknown } {
  return 'byName' in proto && typeof (proto as any).byName === 'function';
}

function hasById(proto: object): proto is { byId: (id: string | number) => unknown } {
  return 'byId' in proto && typeof (proto as any).byId === 'function';
}

function isChildProto(value: unknown): value is BaseProtoType {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof (value as any).resolve === 'function';
}

function getItemProto(collectionProto: object): object | undefined {
  return collectionItemProtos.get(collectionProto);
}

function resolveURI(uri: string): Result<Res<any>> {
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
  let proto: any = registration.proto;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const { head, qualifier } = segment;

    const childProto = proto[head];

    if (childProto !== undefined && isChildProto(childProto)) {
      delegate = delegate.prop(head);
      proto = childProto;

      if (qualifier) {
        const itemProto = getItemProto(proto);

        if (qualifier.kind === 'index') {
          if (!hasByIndex(proto)) {
            return { ok: false, error: `Collection '${head}' does not support index addressing` };
          }
          delegate = delegate.byIndex(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'id') {
          if (!hasById(proto)) {
            return { ok: false, error: `Collection '${head}' does not support id addressing` };
          }
          delegate = delegate.byId(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'query') {
          const applied = applyQueryQualifier(delegate, proto, qualifier);
          delegate = applied.delegate;
          proto = applied.proto;
        }
      }
    } else if (hasByName(proto) || hasById(proto)) {
      const itemProto = getItemProto(proto);

      if (hasByName(proto)) {
        delegate = delegate.byName(head);
        proto = itemProto || baseScalar;
      } else if (hasById(proto)) {
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
    } else {
      const available = Object.keys(proto).filter(k => {
        const v = proto[k];
        return isChildProto(v);
      });
      return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
    }
  }

  return { ok: true, value: createRes(delegate, proto) };
}
