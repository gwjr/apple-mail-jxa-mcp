// Test the plugboard v4 model with JXA - including URI resolution
// Compile: npx tsc scratch/test-plugboard-v4.ts --outFile scratch/test-plugboard-v4.js --target ES2020 --module None --lib ES2020 --strict
// Run: osascript -l JavaScript scratch/test-plugboard-v4.js

declare function Application(name: string): any;
declare var console: { log(...args: any[]): void };

// ─────────────────────────────────────────────────────────────────────────────
// Brands (compile-time only)
// ─────────────────────────────────────────────────────────────────────────────

declare const LazyBrand: unique symbol;
declare const SettableBrand: unique symbol;
declare const ByIndexBrand: unique symbol;
declare const ByNameBrand: unique symbol;
declare const ByIdBrand: unique symbol;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Filter Operators - each operator conforms to FilterOperator interface
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

type Predicate = {
  operator: FilterOperator<any>;
  value: any;
};

// Convenience constructors for predicates
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

interface Delegate {
  _jxa(): any;
  prop(key: string): Delegate;
  byIndex(n: number): Delegate;
  byName(name: string): Delegate;
  byId(id: string | number): Delegate;
  uri(): string;
  set(value: any): void;
  // Query state
  withFilter(filter: WhoseFilter): Delegate;
  withSort(sort: SortSpec<any>): Delegate;
  withPagination(pagination: PaginationSpec): Delegate;
  withExpand(fields: string[]): Delegate;
  queryState(): QueryState;
}

type Res<P> = P & { _delegate: Delegate };

// ─────────────────────────────────────────────────────────────────────────────
// createRes
// ─────────────────────────────────────────────────────────────────────────────

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
          return createRes(t._delegate.prop(prop as string), value);
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

// Collection accessors - close over itemProto and register for URI resolution
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

// Query methods interface - extends BaseProtoType so chained results have specifier()
interface QueryableProto<T> extends BaseProtoType {
  whose(filter: WhoseFilter): Res<QueryableProto<T> & BaseProtoType>;
  sortBy(spec: SortSpec<T>): Res<QueryableProto<T> & BaseProtoType>;
  paginate(spec: PaginationSpec): Res<QueryableProto<T> & BaseProtoType>;
  expand(fields: string[]): Res<QueryableProto<T> & BaseProtoType>;
}

// Apply query state to resolved array
function applyQueryState<T>(items: T[], query: QueryState): T[] {
  let results = items;

  // Apply filter
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

  // Apply sort
  if (query.sort) {
    const { by, direction = 'asc' } = query.sort;
    results = [...results].sort((a: any, b: any) => {
      const aVal = a[by];
      const bVal = b[by];
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return direction === 'desc' ? -cmp : cmp;
    });
  }

  // Apply pagination
  if (query.pagination) {
    const { offset = 0, limit } = query.pagination;
    results = limit !== undefined ? results.slice(offset, offset + limit) : results.slice(offset);
  }

  return results;
}

// Queryable collection composer
function withQuery<P extends BaseProtoType>(proto: P): P & QueryableProto<any> {
  return {
    ...proto,

    // Override resolve to apply query state
    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      const query = this._delegate.queryState();
      return applyQueryState(raw, query);
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
// JXA Delegate
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

// Build query string from QueryState
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

class JXADelegate implements Delegate {
  constructor(
    private _jxaRef: any,
    private _path: PathSegment[],
    private _parent?: any,
    private _key?: string,
    private _query: QueryState = {}
  ) {}

  _jxa(): any {
    if (this._parent && this._key) {
      return this._parent[this._key]();
    }
    if (typeof this._jxaRef === 'function') {
      return this._jxaRef();
    }
    return this._jxaRef;
  }

  prop(key: string): JXADelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    return new JXADelegate(this._jxaRef[key], newPath, this._jxaRef, key);
  }

  byIndex(n: number): JXADelegate {
    const newPath = [...this._path, { kind: 'index' as const, value: n }];
    return new JXADelegate(this._jxaRef[n], newPath);
  }

  byName(name: string): JXADelegate {
    const newPath = [...this._path, { kind: 'name' as const, value: name }];
    return new JXADelegate(this._jxaRef.byName(name), newPath);
  }

  byId(id: string | number): JXADelegate {
    const newPath = [...this._path, { kind: 'id' as const, value: id }];
    return new JXADelegate(this._jxaRef.byId(id), newPath);
  }

  uri(): string {
    const base = buildURI(this._path);
    const queryStr = buildQueryString(this._query);
    return queryStr ? `${base}?${queryStr}` : base;
  }

  set(value: any): void {
    if (this._parent && this._key) {
      this._parent[this._key] = value;
    } else {
      throw new Error('Cannot set on root object');
    }
  }

  // Query state methods - merge filters, don't replace
  withFilter(filter: WhoseFilter): JXADelegate {
    const mergedFilter = { ...this._query.filter, ...filter };
    const newQuery = { ...this._query, filter: mergedFilter };
    return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
  }

  withSort(sort: SortSpec<any>): JXADelegate {
    const newQuery = { ...this._query, sort };
    return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
  }

  withPagination(pagination: PaginationSpec): JXADelegate {
    const newQuery = { ...this._query, pagination };
    return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
  }

  withExpand(fields: string[]): JXADelegate {
    const existing = this._query.expand || [];
    const merged = [...new Set([...existing, ...fields])];
    const newQuery = { ...this._query, expand: merged };
    return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
  }

  queryState(): QueryState {
    return this._query;
  }
}

function createJXADelegate(app: any, scheme: string = 'mail'): JXADelegate {
  return new JXADelegate(app, [{ kind: 'root', scheme }]);
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

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s);
}

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

    // Filter params: field=value or field.op=value
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

function parseSegments(path: string): URISegment[] {
  if (!path) return [];

  const segments: URISegment[] = [];
  let remaining = path;

  while (remaining) {
    if (remaining.startsWith('/')) {
      remaining = remaining.slice(1);
      if (!remaining) break;
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

    const segment: URISegment = { head };

    // Parse index qualifier [n]
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

    // Parse query qualifier ?key=value&...
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
    return { ok: false, error: 'Invalid URI: missing scheme' };
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
// Scheme Registry & URI Resolution
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

// Convert URI Filter[] to WhoseFilter
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

// Convert URI sort to SortSpec
function sortToSortSpec(sort: { field: string; direction: SortDirection }): SortSpec<any> {
  return { by: sort.field, direction: sort.direction };
}

// Apply QueryQualifier to delegate and proto
function applyQueryQualifier(
  delegate: Delegate,
  proto: any,
  qualifier: QueryQualifier
): { delegate: Delegate; proto: any } {
  let newDelegate = delegate;

  // Apply filters
  if (qualifier.filters.length > 0) {
    const whoseFilter = filtersToWhoseFilter(qualifier.filters);
    newDelegate = newDelegate.withFilter(whoseFilter);
  }

  // Apply sort
  if (qualifier.sort) {
    const sortSpec = sortToSortSpec(qualifier.sort);
    newDelegate = newDelegate.withSort(sortSpec);
  }

  // Apply pagination
  if (qualifier.limit !== undefined || qualifier.offset !== undefined) {
    newDelegate = newDelegate.withPagination({
      limit: qualifier.limit,
      offset: qualifier.offset,
    });
  }

  // Apply expand
  if (qualifier.expand && qualifier.expand.length > 0) {
    newDelegate = newDelegate.withExpand(qualifier.expand);
  }

  // Wrap proto with query methods so result is queryable
  const queryableProto = withQuery(proto);

  return { delegate: newDelegate, proto: queryableProto };
}

function hasByIndex(proto: any): proto is { byIndex: (n: number) => any } {
  return typeof proto.byIndex === 'function';
}

function hasByName(proto: any): proto is { byName: (name: string) => any } {
  return typeof proto.byName === 'function';
}

function hasById(proto: any): proto is { byId: (id: string | number) => any } {
  return typeof proto.byId === 'function';
}

function isChildProto(value: any): value is BaseProtoType {
  return typeof value === 'object' && value !== null && typeof value.resolve === 'function';
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
          // Apply query qualifier (filter, sort, pagination)
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
    } else {
      const available = Object.keys(proto).filter(k => isChildProto(proto[k]));
      return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
    }
  }

  return { ok: true, value: createRes(delegate, proto) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function pipe<A, B>(a: A, f: (a: A) => B): B {
  return f(a);
}

function pipe2<A, B, C>(a: A, f: (a: A) => B, g: (b: B) => C): C {
  return g(f(a));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail Schema
// ─────────────────────────────────────────────────────────────────────────────

interface MailboxProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  unreadCount: typeof eagerScalar;
  mailboxes: BaseProtoType & ByIndexProto<MailboxProtoType> & ByNameProto<MailboxProtoType>;
}

const MailboxProto: MailboxProtoType = {
  ...baseScalar,
  name: eagerScalar,
  unreadCount: eagerScalar,
  mailboxes: null as any,
};

MailboxProto.mailboxes = pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto));

interface AccountProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  mailboxes: BaseProtoType & ByIndexProto<typeof MailboxProto> & ByNameProto<typeof MailboxProto>;
}

const AccountProto: AccountProtoType = {
  ...baseScalar,
  name: eagerScalar,
  mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
};

interface ApplicationProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  version: typeof eagerScalar;
  accounts: BaseProtoType & ByIndexProto<typeof AccountProto> & ByNameProto<typeof AccountProto>;
}

const ApplicationProto: ApplicationProtoType = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe2(baseCollection, withByIndex(AccountProto), withByName(AccountProto)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

type MailApplication = Res<typeof ApplicationProto>;

function getMailApp(): MailApplication {
  const jxaApp = Application('Mail');
  const delegate = createJXADelegate(jxaApp, 'mail');
  return createRes(delegate, ApplicationProto);
}

// Register mail scheme for URI resolution
function initMailScheme(): void {
  const jxaApp = Application('Mail');
  registerScheme('mail', () => createJXADelegate(jxaApp, 'mail'), ApplicationProto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────────────────────────────────

function run() {
  console.log('=== Plugboard v4 Test ===\n');

  // Initialize mail scheme for URI resolution
  initMailScheme();

  const mail = getMailApp();

  // Test app-level specifier
  console.log('App specifier:', mail.specifier().uri);
  console.log('App name:', mail.name.resolve());
  console.log('App version:', mail.version.resolve());

  console.log('\n--- URI Generation Tests ---');

  const account0 = mail.accounts.byIndex(0);
  console.log('accounts[0] specifier:', account0.specifier().uri);
  console.log('accounts[0] name:', account0.name.resolve());

  const mailbox0 = account0.mailboxes.byIndex(0);
  console.log('accounts[0]/mailboxes[0] specifier:', mailbox0.specifier().uri);
  console.log('  mailbox name:', mailbox0.name.resolve());

  // ─────────────────────────────────────────────────────────────────────────
  // URI Resolution Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- URI Resolution Tests ---');

  // Test resolving root
  const rootResult = resolveURI('mail://');
  if (rootResult.ok) {
    console.log('Resolve mail:// -> specifier:', rootResult.value.specifier().uri);
    console.log('  name:', rootResult.value.name.resolve());
  } else {
    console.log('ERROR resolving mail://:', rootResult.error);
  }

  // Test resolving accounts collection
  const accountsResult = resolveURI('mail://accounts');
  if (accountsResult.ok) {
    console.log('Resolve mail://accounts -> specifier:', accountsResult.value.specifier().uri);
  } else {
    console.log('ERROR resolving mail://accounts:', accountsResult.error);
  }

  // Test resolving accounts[0]
  const account0Result = resolveURI('mail://accounts[0]');
  if (account0Result.ok) {
    console.log('Resolve mail://accounts[0] -> specifier:', account0Result.value.specifier().uri);
    console.log('  name:', account0Result.value.name.resolve());
  } else {
    console.log('ERROR resolving mail://accounts[0]:', account0Result.error);
  }

  // Test resolving accounts[0]/mailboxes
  const mailboxesResult = resolveURI('mail://accounts[0]/mailboxes');
  if (mailboxesResult.ok) {
    console.log('Resolve mail://accounts[0]/mailboxes -> specifier:', mailboxesResult.value.specifier().uri);
  } else {
    console.log('ERROR resolving mail://accounts[0]/mailboxes:', mailboxesResult.error);
  }

  // Test resolving accounts[0]/mailboxes[0]
  const mailbox0Result = resolveURI('mail://accounts[0]/mailboxes[0]');
  if (mailbox0Result.ok) {
    console.log('Resolve mail://accounts[0]/mailboxes[0] -> specifier:', mailbox0Result.value.specifier().uri);
    console.log('  name:', mailbox0Result.value.name.resolve());
  } else {
    console.log('ERROR resolving mail://accounts[0]/mailboxes[0]:', mailbox0Result.error);
  }

  // Test resolving by name - accounts/Exchange
  const accountName = account0.name.resolve();
  const byNameResult = resolveURI(`mail://accounts/${accountName}`);
  if (byNameResult.ok) {
    console.log(`Resolve mail://accounts/${accountName} -> specifier:`, byNameResult.value.specifier().uri);
    console.log('  name:', byNameResult.value.name.resolve());
  } else {
    console.log(`ERROR resolving mail://accounts/${accountName}:`, byNameResult.error);
  }

  // Test resolving nested path: accounts/Exchange/mailboxes[0]
  const nestedResult = resolveURI(`mail://accounts/${accountName}/mailboxes[0]`);
  if (nestedResult.ok) {
    console.log(`Resolve mail://accounts/${accountName}/mailboxes[0] -> specifier:`, nestedResult.value.specifier().uri);
    console.log('  name:', nestedResult.value.name.resolve());
  } else {
    console.log(`ERROR resolving mail://accounts/${accountName}/mailboxes[0]:`, nestedResult.error);
  }

  // Test error case - unknown segment
  const errorResult = resolveURI('mail://foobar');
  if (errorResult.ok) {
    console.log('Resolve mail://foobar -> unexpectedly succeeded');
  } else {
    console.log('Resolve mail://foobar -> ERROR (expected):', errorResult.error);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Query Tests (In-Memory) ---');

  // Test with in-memory data to demonstrate query functionality
  const testData = [
    { name: 'Alice', age: 30, email: 'alice@example.com' },
    { name: 'Bob', age: 25, email: 'bob@example.com' },
    { name: 'Charlie', age: 35, email: 'charlie@example.com' },
    { name: 'Diana', age: 28, email: 'diana@example.com' },
  ];

  // Test applyQueryState directly
  console.log('Original data count:', testData.length);

  // Filter: age > 27
  const filtered = applyQueryState(testData, {
    filter: { age: gt(27) }
  });
  console.log('Filter age > 27:', filtered.map(x => x.name).join(', '));

  // Filter: name contains 'a'
  const containsA = applyQueryState(testData, {
    filter: { name: contains('a') }
  });
  console.log('Filter name contains "a":', containsA.map(x => x.name).join(', '));

  // Sort by age descending
  const sortedDesc = applyQueryState(testData, {
    sort: { by: 'age', direction: 'desc' }
  });
  console.log('Sort by age desc:', sortedDesc.map(x => `${x.name}(${x.age})`).join(', '));

  // Paginate: limit 2, offset 1
  const paginated = applyQueryState(testData, {
    pagination: { limit: 2, offset: 1 }
  });
  console.log('Paginate limit=2 offset=1:', paginated.map(x => x.name).join(', '));

  // Combined: filter + sort + paginate
  const combined = applyQueryState(testData, {
    filter: { age: gt(25) },
    sort: { by: 'name', direction: 'asc' },
    pagination: { limit: 2 }
  });
  console.log('Combined (age>25, sort name asc, limit 2):', combined.map(x => x.name).join(', '));

  // ─────────────────────────────────────────────────────────────────────────
  // Query URI Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Query URI Generation ---');

  // Create a queryable collection proto for demonstration
  const queryableAccountsProto = pipe(
    pipe2(baseCollection, withByIndex(AccountProto), withByName(AccountProto)),
    withQuery
  );

  // Manually test URI generation with query state
  const delegateWithQuery = createJXADelegate(Application('Mail'), 'mail')
    .prop('accounts')
    .withFilter({ name: contains('Exchange') })
    .withSort({ by: 'name', direction: 'asc' })
    .withPagination({ limit: 10 });

  console.log('Query URI:', delegateWithQuery.uri());

  // Test chained query building
  const queryRes = createRes(
    createJXADelegate(Application('Mail'), 'mail').prop('accounts'),
    queryableAccountsProto
  ) as Res<typeof queryableAccountsProto> & QueryableProto<any>;

  const filtered2 = queryRes.whose({ name: contains('Ex') });
  console.log('Chained whose() URI:', filtered2.specifier().uri);

  const sorted2 = queryRes.sortBy({ by: 'name', direction: 'desc' });
  console.log('Chained sortBy() URI:', sorted2.specifier().uri);

  const paginated2 = queryRes.paginate({ limit: 5, offset: 2 });
  console.log('Chained paginate() URI:', paginated2.specifier().uri);

  // Chain multiple query operations
  const chained = queryRes
    .whose({ name: startsWith('Ex') })
    .sortBy({ by: 'name', direction: 'asc' })
    .paginate({ limit: 10 });
  console.log('Multiple chained operations URI:', chained.specifier().uri);

  // ─────────────────────────────────────────────────────────────────────────
  // URI Query Resolution Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- URI Query Resolution Tests ---');

  // Test resolving URI with filter
  const filterResult = resolveURI('mail://accounts?name.contains=Ex');
  if (filterResult.ok) {
    console.log('Resolve mail://accounts?name.contains=Ex');
    console.log('  specifier:', filterResult.value.specifier().uri);
    console.log('  has whose():', typeof (filterResult.value as any).whose === 'function');
  } else {
    console.log('ERROR:', filterResult.error);
  }

  // Test resolving URI with sort
  const sortResult = resolveURI('mail://accounts?sort=name.desc');
  if (sortResult.ok) {
    console.log('Resolve mail://accounts?sort=name.desc');
    console.log('  specifier:', sortResult.value.specifier().uri);
  } else {
    console.log('ERROR:', sortResult.error);
  }

  // Test resolving URI with pagination
  const pageResult = resolveURI('mail://accounts?limit=5&offset=2');
  if (pageResult.ok) {
    console.log('Resolve mail://accounts?limit=5&offset=2');
    console.log('  specifier:', pageResult.value.specifier().uri);
  } else {
    console.log('ERROR:', pageResult.error);
  }

  // Test resolving URI with combined query params
  const combinedResult = resolveURI('mail://accounts?name.startsWith=Ex&sort=name.asc&limit=10');
  if (combinedResult.ok) {
    console.log('Resolve mail://accounts?name.startsWith=Ex&sort=name.asc&limit=10');
    console.log('  specifier:', combinedResult.value.specifier().uri);
  } else {
    console.log('ERROR:', combinedResult.error);
  }

  // Test resolving nested path with query
  const nestedQueryResult = resolveURI('mail://accounts[0]/mailboxes?name.contains=Inbox');
  if (nestedQueryResult.ok) {
    console.log('Resolve mail://accounts[0]/mailboxes?name.contains=Inbox');
    console.log('  specifier:', nestedQueryResult.value.specifier().uri);
    // The result should be queryable - we can chain more queries
    // Filters should MERGE, not replace
    const furtherFiltered = (nestedQueryResult.value as any).whose({ unreadCount: gt(0) });
    console.log('  chained whose() specifier:', furtherFiltered.specifier().uri);
    console.log('  (should have BOTH name.contains and unreadCount.gt)');
  } else {
    console.log('ERROR:', nestedQueryResult.error);
  }

  // Test filter merging explicitly
  console.log('\n--- Filter Merge Test ---');
  const mergeTest = resolveURI('mail://accounts?name.contains=Ex');
  if (mergeTest.ok) {
    const step1 = (mergeTest.value as any).whose({ email: contains('@') });
    const step2 = step1.sortBy({ by: 'name', direction: 'asc' });
    const step3 = step2.whose({ id: gt(0) });
    console.log('After 3 chained operations:');
    console.log('  URI:', step3.specifier().uri);
    console.log('  (should have name.contains, email.contains, id.gt, and sort)');
  }

  // Test round-trip: generate URI with query -> parse -> resolve -> check query state preserved
  console.log('\n--- Round-trip Test ---');
  const originalUri = 'mail://accounts?name.contains=Exchange&sort=name.desc&limit=5&offset=1';
  const rtResult = resolveURI(originalUri);
  if (rtResult.ok) {
    const regeneratedUri = rtResult.value.specifier().uri;
    console.log('Original URI:    ', originalUri);
    console.log('Regenerated URI: ', regeneratedUri);
    console.log('Match:', originalUri === regeneratedUri ? 'YES' : 'NO (expected - order may differ)');
  } else {
    console.log('ERROR:', rtResult.error);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expand Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Expand Tests ---');

  // Test expand via URI
  const expandResult = resolveURI('mail://accounts?expand=content,attachments');
  if (expandResult.ok) {
    console.log('Resolve mail://accounts?expand=content,attachments');
    console.log('  specifier:', expandResult.value.specifier().uri);
    // Check query state
    const qs = expandResult.value._delegate.queryState();
    console.log('  expand fields:', qs.expand?.join(', ') || '(none)');
  } else {
    console.log('ERROR:', expandResult.error);
  }

  // Test expand via chained method
  const expandChained = queryRes.expand(['content', 'subject']);
  console.log('Chained expand() URI:', expandChained.specifier().uri);

  // Test expand merging (expand should accumulate like filters)
  const expandMerge = queryRes
    .expand(['content'])
    .expand(['attachments']);
  console.log('Merged expand() URI:', expandMerge.specifier().uri);
  const mergedQs = expandMerge._delegate.queryState();
  console.log('  expand fields:', mergedQs.expand?.join(', ') || '(none)');

  // Test combined query with expand
  const combinedWithExpand = resolveURI('mail://accounts?name.contains=Ex&expand=content&limit=10');
  if (combinedWithExpand.ok) {
    console.log('Resolve mail://accounts?name.contains=Ex&expand=content&limit=10');
    console.log('  specifier:', combinedWithExpand.value.specifier().uri);
  } else {
    console.log('ERROR:', combinedWithExpand.error);
  }

  console.log('\n=== Test Complete ===');
}

run();
