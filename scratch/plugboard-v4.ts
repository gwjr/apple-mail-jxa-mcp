// scratch/plugboard-v4.ts - Plugboard v4: Prototype Composition
//
// Design principles:
// 1. Brands are compile-time only - `declare const X: unique symbol`, never instantiated
// 2. No magic strings - no `kind: 'scalar'`, `_type: 'collection'`
// 3. Prototypes are plain objects with methods - nothing to inspect
// 4. Composition via spread - `makeLazy(proto)` spreads and overrides
// 5. Closures, not properties - `itemProto` closed over, not stored as `_itemProto`
// 6. Type system enforces constraints - collection has accessors, proto matches schema, etc.

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

// ─────────────────────────────────────────────────────────────────────────────
// Type-level utilities
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: string };

// Type-level marker for lazy values
type Lazy<T> = T & { readonly [LazyBrand]: true };

// Type-level markers for scalars
type ScalarType<T> = { readonly [ScalarBrand]: T };
type EagerScalarType<T> = ScalarType<T> & { readonly [EagerBrand]: true };
type LazyScalarType<T> = ScalarType<T> & { readonly [LazyBrand]: true };

// Type-level markers for collections
type CollectionType<Item> = { readonly [CollectionBrand]: Item };
type EagerCollectionType<Item> = CollectionType<Item> & { readonly [EagerBrand]: true };
type LazyCollectionType<Item> = CollectionType<Item> & { readonly [LazyBrand]: true };

// Extract inner type from scalar
type ExtractScalar<T> = T extends { readonly [ScalarBrand]: infer S } ? S : never;

// Extract item type from collection
type ExtractItem<T> = T extends { readonly [CollectionBrand]: infer I } ? I : never;

// Check if lazy
type IsLazy<T> = T extends { readonly [LazyBrand]: true } ? true : false;

// ─────────────────────────────────────────────────────────────────────────────
// Query Types
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Filter Operators - each operator conforms to FilterOperator interface
// ─────────────────────────────────────────────────────────────────────────────

interface FilterOperator<T> {
  readonly name: string;                          // URI param name
  parseUri(s: string): T;                         // Parse URI string value
  toJxa(v: T): any;                               // Convert to JXA filter format
  test(itemVal: any, predVal: T): boolean;        // JS runtime test (itemVal from JXA)
  toUri(v: T): string;                            // Serialize to URI format
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

// All operators - used for URI parsing boundary
const filterOperators = [equalsOp, containsOp, startsWithOp, gtOp, ltOp] as const;

// Lookup by name (only needed at URI parsing boundary)
function getOperatorByName(name: string): FilterOperator<any> | undefined {
  return filterOperators.find(op => op.name === name);
}

// A predicate pairs an operator with a value
type PredicateValue<Op extends FilterOperator<any>> = {
  operator: Op;
  value: Op extends FilterOperator<infer T> ? T : never;
};

// Runtime predicate (operator + value)
type Predicate = PredicateValue<FilterOperator<any>>;

// Convenience constructors for predicates
const equals = (value: any): Predicate => ({ operator: equalsOp, value });
const contains = (value: string): Predicate => ({ operator: containsOp, value });
const startsWith = (value: string): Predicate => ({ operator: startsWithOp, value });
const gt = (value: number): Predicate => ({ operator: gtOp, value });
const lt = (value: number): Predicate => ({ operator: ltOp, value });

// WhoseFilter maps field names to predicates
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
// Delegate interface (JXA or other backing)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Res type - the runtime wrapper
// ─────────────────────────────────────────────────────────────────────────────

type Res<P> = P & { _delegate: Delegate };

// ─────────────────────────────────────────────────────────────────────────────
// createRes - minimal, just wires delegate to proto
// ─────────────────────────────────────────────────────────────────────────────

function createRes<P extends object>(delegate: Delegate, proto: P): Res<P> {
  // The proxy itself is the `this` context - it exposes both _delegate and proto methods
  const handler: ProxyHandler<{ _delegate: Delegate }> = {
    get(t, prop: string | symbol, receiver) {
      if (prop === '_delegate') return t._delegate;

      if (prop in proto) {
        const value = (proto as any)[prop];
        if (typeof value === 'function') {
          // Bind to receiver (the proxy) so that this.resolve() etc. works
          return value.bind(receiver);
        }
        // Property is a child proto - create child Res
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

// Interface without explicit `this` - allows proper type inference at call sites
interface BaseProtoType {
  resolve(): any;
  resolve_eager(): any;
  exists(): boolean;
  specifier(): Specifier;
}

// Implementation with internal this typing (cast at the end)
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
    // Resolve all items (JXA array resolution)
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

// ─────────────────────────────────────────────────────────────────────────────
// Composers - add/override behavior via spread
// ─────────────────────────────────────────────────────────────────────────────

// Laziness - resolve_eager returns specifier instead of resolving
function makeLazy<P extends BaseProtoType>(proto: P): P & { readonly [LazyBrand]: true } {
  return {
    ...proto,
    resolve_eager(this: { specifier(): Specifier }): Specifier {
      return this.specifier();
    },
  } as P & { readonly [LazyBrand]: true };
}

// Settable - adds set() method
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

// Collection accessors - close over itemProto and register for URI resolution

// Store item proto for URI resolution (allows resolveURI to navigate collections)
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

  // Apply JS filter (for when JXA whose() failed or wasn't applicable)
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

// Queryable collection - adds whose/sortBy/paginate and applies query on resolve
function withQuery<P extends BaseProtoType>(proto: P): P & QueryableProto<any> {
  // Get the item proto from the original collection proto
  const itemProto = collectionItemProtos.get(proto);

  return {
    ...proto,

    // Override resolve to apply query state including expand
    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      const query = this._delegate.queryState();
      let results = applyQueryState(raw, query);

      // Apply expand - eagerly resolve specified fields on each item
      if (query.expand && query.expand.length > 0 && itemProto) {
        results = results.map((item: any, idx: number) => {
          const expanded = { ...item };
          for (const field of query.expand!) {
            // Check if the field is lazy in the item proto
            const fieldProto = (itemProto as any)[field];
            if (fieldProto && typeof fieldProto === 'object' && 'resolve' in fieldProto) {
              // Field exists in proto - try to resolve it from the JXA item
              try {
                // JXA items may have the property directly or need explicit access
                if (field in item && typeof item[field] === 'function') {
                  expanded[field] = item[field]();
                } else if (field in item) {
                  expanded[field] = item[field];
                }
              } catch {
                // Leave as-is if resolution fails
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

// Collection must have at least one accessor
type HasAccessor<P> = P extends { byIndex: any } | { byName: any } | { byId: any }
  ? P
  : never;

// Proto's resolve_eager must match schema laziness
type ProtoMatchesLaziness<IsLazyFlag extends boolean, P> =
  IsLazyFlag extends true
    ? P extends { resolve_eager(): Specifier } ? P : never
    : P;

// Constraint: collection proto must have accessor
type ValidCollectionProto<P> = HasAccessor<P>;

// ─────────────────────────────────────────────────────────────────────────────
// Path and URI utilities (used by all Delegate implementations)
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
      // 'equals' is the default, so we use field=value; others use field.op=value
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
// Helper: compose multiple withAccessor functions
// ─────────────────────────────────────────────────────────────────────────────

// Utility for cleaner composition
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
// Mail Schema - prototype composition
//
// The schema IS the prototype map. Each property is either:
// - A scalar proto (baseScalar, makeLazy(baseScalar), withSet(baseScalar))
// - A collection proto (with accessors composed in)
// - A nested object (compound type with child protos)
// ─────────────────────────────────────────────────────────────────────────────

// Eager scalar - convenience alias
const eagerScalar = baseScalar;

// Forward declarations for recursive types
// TypeScript needs help with mutually recursive object types
interface AttachmentProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  size: typeof eagerScalar;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
}

const AttachmentProto: AttachmentProtoType = {
  ...baseScalar, // Compound objects inherit base methods
  name: eagerScalar,
  size: eagerScalar,
  content: makeLazy(baseScalar),
};

// Message proto - lazy content, settable isRead
interface MessageProtoType extends BaseProtoType {
  subject: typeof eagerScalar;
  sender: typeof eagerScalar;
  dateSent: typeof eagerScalar;
  isRead: ReturnType<typeof withSet<typeof baseScalar>>;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
  attachments: BaseProtoType & ByIndexProto<typeof AttachmentProto>;
}

const MessageProto: MessageProtoType = {
  ...baseScalar,
  subject: eagerScalar,
  sender: eagerScalar,
  dateSent: eagerScalar,
  isRead: withSet(baseScalar),
  content: makeLazy(baseScalar),
  attachments: pipe(baseCollection, withByIndex(AttachmentProto)),
};

// Lazy message proto - for collection items
const LazyMessageProto = makeLazy(MessageProto);

// Mailbox proto - recursive (contains mailboxes)
// Need to use a function to handle the recursion
interface MailboxProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  unreadCount: typeof eagerScalar;
  messages: BaseProtoType & ByIndexProto<typeof LazyMessageProto> & ByIdProto<typeof LazyMessageProto>;
  mailboxes: BaseProtoType & ByIndexProto<MailboxProtoType> & ByNameProto<MailboxProtoType>;
}

// Create the mailbox proto with recursive reference
// We use a mutable object and assign the recursive property after
const MailboxProto: MailboxProtoType = {
  ...baseScalar,
  name: eagerScalar,
  unreadCount: eagerScalar,
  messages: pipe2(baseCollection, withByIndex(LazyMessageProto), withById(LazyMessageProto)),
  // Placeholder - will be replaced below
  mailboxes: null as any,
};

// Now create the mailboxes collection with recursive MailboxProto reference
MailboxProto.mailboxes = pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto));

// Account proto
interface AccountProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  email: typeof eagerScalar;
  mailboxes: BaseProtoType & ByIndexProto<typeof MailboxProto> & ByNameProto<typeof MailboxProto>;
}

const AccountProto: AccountProtoType = {
  ...baseScalar,
  name: eagerScalar,
  email: eagerScalar,
  mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
};

// Application proto (root)
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
// Entry point - create Mail app Res from a delegate
// ─────────────────────────────────────────────────────────────────────────────

function getMailApp(delegate: Delegate): Res<typeof ApplicationProto> {
  return createRes(delegate, ApplicationProto);
}

// Type aliases for convenience
type MailApplication = Res<typeof ApplicationProto>;
type MailAccount = Res<typeof AccountProto>;
type MailMailbox = Res<typeof MailboxProto>;
type MailMessage = Res<typeof MessageProto>;
type MailAttachment = Res<typeof AttachmentProto>;

// ─────────────────────────────────────────────────────────────────────────────
// URI Lexer - Pure structural parsing
// ─────────────────────────────────────────────────────────────────────────────

type FilterOp = 'equals' | 'contains' | 'startsWith' | 'gt' | 'lt';

type Filter = {
  field: string;
  op: FilterOp;
  value: string;
};

// SortDirection already defined above in Query Types section

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

    // Parse qualifier if present
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
// URI Resolution - Navigate proto tree
// ─────────────────────────────────────────────────────────────────────────────

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

// Check if a proto has a specific accessor
function hasByIndex(proto: object): proto is { byIndex: (n: number) => unknown } {
  return 'byIndex' in proto && typeof (proto as any).byIndex === 'function';
}

function hasByName(proto: object): proto is { byName: (name: string) => unknown } {
  return 'byName' in proto && typeof (proto as any).byName === 'function';
}

function hasById(proto: object): proto is { byId: (id: string | number) => unknown } {
  return 'byId' in proto && typeof (proto as any).byId === 'function';
}

// Check if a proto property is a child proto (object with resolve method)
function isChildProto(value: unknown): value is BaseProtoType {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof (value as any).resolve === 'function';
}

// Get item proto for a collection proto
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

  // Walk segments
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const { head, qualifier } = segment;

    // Look up head in current proto
    const childProto = proto[head];

    if (childProto !== undefined && isChildProto(childProto)) {
      // Navigate to child property
      delegate = delegate.prop(head);
      proto = childProto;

      // Apply qualifier if present
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
      // Not in proto schema, but we have name/id accessors - treat as name addressing
      const itemProto = getItemProto(proto);

      if (hasByName(proto)) {
        delegate = delegate.byName(head);
        proto = itemProto || baseScalar;
      } else if (hasById(proto)) {
        delegate = delegate.byId(head);
        proto = itemProto || baseScalar;
      }

      // Apply qualifier if present (for chained access like accounts/Exchange[0])
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

// ─────────────────────────────────────────────────────────────────────────────
// Note: This file is designed for --outFile concatenation (JXA builds)
// All types and functions are in global scope when compiled with --module None
// ─────────────────────────────────────────────────────────────────────────────
