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
declare const MoveableBrand: unique symbol;
declare const DeleteableBrand: unique symbol;
declare const CreateableBrand: unique symbol;

// ─────────────────────────────────────────────────────────────────────────────
// Root Marker (for parent navigation)
// ─────────────────────────────────────────────────────────────────────────────

// Explicit unique symbol type - used directly in type literal (no typeof needed)
const RootBrand: unique symbol = Symbol('RootBrand');
type RootMarker = { readonly [RootBrand]: true };
const ROOT: RootMarker = { [RootBrand]: true } as RootMarker;

function isRoot(d: Delegate | RootMarker): d is RootMarker {
  return RootBrand in d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-level utilities
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: URL };

// Collection resolve returns array of specifiers - either bare {uri} or enriched with extra fields
type CollectionResolveResult = { uri: URL }[] | { uri: URL; [key: string]: any }[];

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
  propWithAlias(jxaName: string, uriName: string): Delegate;
  byIndex(n: number): Delegate;
  byName(name: string): Delegate;
  byId(id: string | number): Delegate;
  uri(): URL;
  set(value: any): void;
  namespace(name: string): Delegate;

  // Parent navigation - returns RootMarker at top
  parent(): Delegate | RootMarker;

  // Mutation operations - return URL
  moveTo(destination: Delegate): Result<URL>;
  delete(): Result<URL>;
  create(properties: Record<string, any>): Result<URL>;

  withFilter(filter: WhoseFilter): Delegate;
  withSort(sort: SortSpec<any>): Delegate;
  withPagination(pagination: PaginationSpec): Delegate;
  withExpand(fields: string[]): Delegate;
  queryState(): QueryState;

  // Create a delegate from arbitrary JXA ref with explicit path
  // Used for computed navigations that can't be expressed as delegate operations
  fromJxa?(jxaRef: any, path: PathSegment[]): Delegate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Res type
// ─────────────────────────────────────────────────────────────────────────────

type Res<P> = P & { _delegate: Delegate; _isLazy?: boolean };

function createRes<P extends object>(delegate: Delegate, proto: P): Res<P> {
  // For namespace protos, get the target proto for property lookup
  const targetProto = getNamespaceNav(proto) || proto;
  // Check if this proto is marked as lazy (specifierFor)
  const isLazy = lazyProtos.has(proto);

  const handler: ProxyHandler<{ _delegate: Delegate; _isLazy?: boolean }> = {
    get(t, prop: string | symbol, receiver) {
      if (prop === '_delegate') return t._delegate;
      if (prop === '_isLazy') return isLazy;

      // First check the main proto for methods (resolve, exists, etc.)
      if (prop in proto) {
        const value = (proto as any)[prop];
        if (typeof value === 'function') {
          return value.bind(receiver);
        }
      }

      // Then check targetProto for properties (works for both namespaces and regular protos)
      if (prop in targetProto) {
        const value = (targetProto as any)[prop];
        if (typeof value === 'function') {
          return value.bind(receiver);
        }
        if (typeof value === 'object' && value !== null) {
          // Check for namespace navigation first
          const innerNamespaceProto = getNamespaceNav(value);
          if (innerNamespaceProto) {
            return createRes(t._delegate.namespace(prop as string), value);
          }
          // Check for computed navigation
          const navInfo = getComputedNav(value);
          if (navInfo) {
            const targetDelegate = navInfo.navigate(t._delegate);
            return createRes(targetDelegate, navInfo.targetProto);
          }
          // Normal property navigation - use jxaName if defined, otherwise use the property name
          const jxaName = getJxaName(value);
          const schemaName = prop as string;
          if (jxaName) {
            // Navigate with JXA name but track schema name for URI
            return createRes(t._delegate.propWithAlias(jxaName, schemaName), value);
          } else {
            return createRes(t._delegate.prop(schemaName), value);
          }
        }
        return value;
      }

      return undefined;
    },
    has(t, prop: string | symbol) {
      if (prop === '_delegate' || prop === '_isLazy') return true;
      return prop in proto || prop in targetProto;
    },
    ownKeys(t) {
      // Combine keys from proto and targetProto, plus _delegate (but not _isLazy - it's internal)
      const keys = new Set<string | symbol>(['_delegate']);
      for (const key of Object.keys(proto)) keys.add(key);
      for (const key of Object.keys(targetProto)) keys.add(key);
      return [...keys];
    },
    getOwnPropertyDescriptor(t, prop) {
      // Make properties enumerable for Object.keys() to work
      if (prop === '_delegate' || prop === '_isLazy' || prop in proto || prop in targetProto) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    }
  };

  return new Proxy({ _delegate: delegate } as any, handler);
}

// ─────────────────────────────────────────────────────────────────────────────
// Base Prototypes
// ─────────────────────────────────────────────────────────────────────────────

interface BaseProtoType<T = any> {
  resolve(): T;
  exists(): boolean;
  specifier(): Specifier;
}

// Scalar proto: BaseProtoType<T> + ScalarBrand for discrimination
type ScalarProto<T> = BaseProtoType<T> & { readonly [ScalarBrand]: T };

// Collection proto: distinct from BaseProtoType because resolve() returns specifiers, not items
interface CollectionProtoType {
  resolve(): CollectionResolveResult;
  exists(): boolean;
  specifier(): Specifier;
}

type CollectionProto<Item> = CollectionProtoType & { readonly [CollectionBrand]: Item };

// Shared implementation for base proto methods
const _baseProtoImpl = {
  resolve(this: { _delegate: Delegate }) {
    return this._delegate._jxa();
  },
  exists(this: { _delegate: Delegate }) {
    try {
      const result = this._delegate._jxa();
      return result !== undefined && result !== null;
    } catch {
      return false;
    }
  },
  specifier(this: { _delegate: Delegate }): Specifier {
    return { uri: this._delegate.uri() };
  },
};

// Object proto implementation - gathers properties on resolve instead of returning JXA specifier
// Use this for complex objects (mailboxes, messages, etc.) that have child properties
const _objectProtoImpl = {
  resolve(this: Res<any>): any {
    // First try to get the proto from the Res proxy by getting a known property
    // We iterate over all enumerable properties and resolve them
    const result: Record<string, any> = {};
    const baseKeys = new Set(['resolve', 'exists', 'specifier', '_delegate', '_isLazy']);

    // Get the proto by accessing it through the handler
    // We use Object.keys which will trigger the 'has' trap, giving us the keys
    for (const key of Object.keys(this)) {
      if (baseKeys.has(key)) continue;
      try {
        const propRes = (this as any)[key];
        if (propRes && typeof propRes === 'object' && '_delegate' in propRes) {
          // It's a Res - check if it's lazy (should return specifier instead of value)
          if (propRes._isLazy) {
            result[key] = propRes.specifier();
          } else {
            const resolved = propRes.resolve();
            if (resolved !== undefined) {
              result[key] = resolved;
            }
          }
        } else if (propRes !== undefined) {
          result[key] = propRes;
        }
      } catch {
        // Skip properties that fail to resolve
      }
    }
    return result;
  },
  exists(this: { _delegate: Delegate }) {
    try {
      const result = this._delegate._jxa();
      return result !== undefined && result !== null;
    } catch {
      return false;
    }
  },
  specifier(this: { _delegate: Delegate }): Specifier {
    return { uri: this._delegate.uri() };
  },
};

// Base object for complex types that need property gathering
const baseObject = { ..._objectProtoImpl } as BaseProtoType<any>;

// Typed scalar factory
function scalar<T>(): ScalarProto<T> {
  return { ..._baseProtoImpl } as ScalarProto<T>;
}

// Typed collection factory
function collection<Item = any>(): CollectionProto<Item> {
  return { ..._baseProtoImpl } as CollectionProto<Item>;
}

// Primitive type scalars
const t = {
  string: scalar<string>(),
  number: scalar<number>(),
  boolean: scalar<boolean>(),
  date: scalar<Date>(),
  any: scalar<any>(),
};

// Legacy aliases (untyped, for backwards compatibility)
const baseScalar = scalar<any>();
const baseCollection = collection();

// Convenience alias
const eagerScalar = baseScalar;

// ─────────────────────────────────────────────────────────────────────────────
// Composers
// ─────────────────────────────────────────────────────────────────────────────

// Track lazy protos for parent object resolution
const lazyProtos = new WeakSet<object>();

// specifierFor: marks a property as "lazy" - when resolved as part of a parent object,
// returns a specifier (URL) instead of the actual value. Direct resolution returns the value.
function specifierFor<P extends BaseProtoType>(proto: P): P & { readonly [LazyBrand]: true } {
  const lazyProto = { ...proto } as P & { readonly [LazyBrand]: true };
  lazyProtos.add(lazyProto);
  return lazyProto;
}

function isLazyProto(proto: object): boolean {
  return lazyProtos.has(proto);
}

interface SettableProto<T> {
  set(value: T): void;
}

// Extract the type from a proto - works with ScalarProto<T> via the brand
type ExtractProtoType<P> = P extends { readonly [ScalarBrand]: infer T } ? T : any;

function withSet<P extends BaseProtoType<any>>(proto: P): P & SettableProto<ExtractProtoType<P>> & { readonly [SettableBrand]: true } {
  return {
    ...proto,
    set(this: { _delegate: Delegate }, value: ExtractProtoType<P>) {
      this._delegate.set(value);
    },
  } as P & SettableProto<ExtractProtoType<P>> & { readonly [SettableBrand]: true };
}

const collectionItemProtos = new WeakMap<object, object>();

interface ByIndexProto<Item> {
  byIndex(n: number): Res<Item>;
}

function withByIndex<Item extends object>(itemProto: Item) {
  return function<P extends BaseProtoType>(proto: P): P & ByIndexProto<Item> & { readonly [ByIndexBrand]: true; resolve(): CollectionResolveResult } {
    const result = {
      ...proto,
      // resolve() returns specifiers for each item - just {uri: URL}
      // We don't extract id/name here because in JXA that would require calling
      // methods on each item, which is slow for large collections
      resolve(this: { _delegate: Delegate }): CollectionResolveResult {
        const raw = this._delegate._jxa();
        if (!Array.isArray(raw)) return raw;
        return raw.map((_item: any, i: number) => {
          const itemDelegate = this._delegate.byIndex(i);
          return { uri: itemDelegate.uri() };
        });
      },
      byIndex(this: { _delegate: Delegate }, n: number): Res<Item> {
        return createRes(this._delegate.byIndex(n), itemProto);
      },
    } as P & ByIndexProto<Item> & { readonly [ByIndexBrand]: true; resolve(): CollectionResolveResult };
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
// Mutation Composers (move, delete, create)
// ─────────────────────────────────────────────────────────────────────────────

// Operation handler types - return URL, composer wraps in Res
type MoveHandler = (item: Delegate, destCollection: Delegate) => Result<URL>;
type DeleteHandler = (item: Delegate) => Result<URL>;
type CreateHandler = (collection: Delegate, properties: Record<string, any>) => Result<URL>;

// Moveable proto interface - generic constraint makes error messages clearer
interface MoveableProto<Item> {
  move<C extends CollectionProto<Item>>(to: Res<C>): Result<Res<Item>>;
}

// Composer: adds move() with optional custom handler
// Type parameter Item constrains what collections this can move to
function withMove<Item extends object>(itemProto: Item, handler?: MoveHandler) {
  return function<P extends BaseProtoType>(proto: P): P & MoveableProto<Item> & { readonly [MoveableBrand]: true } {
    const result = {
      ...proto,
      move<C extends CollectionProto<Item>>(this: { _delegate: Delegate }, to: Res<C>): Result<Res<Item>> {
        const urlResult = handler
          ? handler(this._delegate, to._delegate)
          : this._delegate.moveTo(to._delegate);

        if (!urlResult.ok) return urlResult;
        // Resolve URL to Res for caller
        const resolveResult = resolveURI(urlResult.value.href);
        if (!resolveResult.ok) return resolveResult;
        return { ok: true, value: resolveResult.value as Res<Item> };
      },
    };
    return result as P & MoveableProto<Item> & { readonly [MoveableBrand]: true };
  };
}

// Deleteable proto interface
interface DeleteableProto {
  delete(): Result<URL>;
}

// Composer: adds delete() with optional custom handler
function withDelete(handler?: DeleteHandler) {
  return function<P extends BaseProtoType>(proto: P): P & DeleteableProto & { readonly [DeleteableBrand]: true } {
    return {
      ...proto,
      delete(this: { _delegate: Delegate }): Result<URL> {
        return handler
          ? handler(this._delegate)
          : this._delegate.delete();
      },
    } as P & DeleteableProto & { readonly [DeleteableBrand]: true };
  };
}

// Createable proto interface (for collections)
interface CreateableProto<Item> {
  create(properties: Partial<Item>): Result<Res<Item>>;
}

// Composer: adds create() with optional custom handler
function withCreate<Item extends object>(itemProto: Item, handler?: CreateHandler) {
  return function<P extends BaseProtoType>(proto: P): P & CreateableProto<Item> & { readonly [CreateableBrand]: true } {
    return {
      ...proto,
      create(this: { _delegate: Delegate }, properties: Partial<Item>): Result<Res<Item>> {
        const urlResult = handler
          ? handler(this._delegate, properties as Record<string, any>)
          : this._delegate.create(properties as Record<string, any>);

        if (!urlResult.ok) return urlResult;
        const resolveResult = resolveURI(urlResult.value.href);
        if (!resolveResult.ok) return resolveResult;
        return { ok: true, value: resolveResult.value as Res<Item> };
      },
    } as P & CreateableProto<Item> & { readonly [CreateableBrand]: true };
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

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Navigation
// ─────────────────────────────────────────────────────────────────────────────

// A namespace is a virtual grouping that:
// 1. Shares its parent's delegate (no JXA navigation)
// 2. Adds a segment to the URI path for schema clarity
// 3. Has its own proto with the grouped properties
// When resolved, a namespace gathers all its properties and returns them as an object

declare const NamespaceBrand: unique symbol;
const namespaceNavMap = new WeakMap<object, object>();

type NamespaceProto<P> = P & { readonly [NamespaceBrand]: true };

function namespaceNav<P extends object>(targetProto: P): NamespaceProto<P> {
  // Custom resolve that gathers all properties from the target proto
  const navProto = {
    resolve(this: Res<any>): any {
      const result: Record<string, any> = {};
      // Get all property names from the target proto (excluding base methods)
      const baseKeys = new Set(['resolve', 'exists', 'specifier', '_delegate']);
      for (const key of Object.keys(targetProto)) {
        if (baseKeys.has(key)) continue;
        try {
          // Navigate to the property and resolve it
          const propRes = (this as any)[key];
          if (propRes && typeof propRes.resolve === 'function') {
            result[key] = propRes.resolve();
          }
        } catch {
          // Skip properties that fail to resolve
        }
      }
      return result;
    },
    exists(this: Res<any>): boolean {
      return true; // Namespaces always exist
    },
    specifier(this: Res<any>): Specifier {
      return { uri: this._delegate.uri() };
    },
  } as unknown as NamespaceProto<P>;
  namespaceNavMap.set(navProto, targetProto);
  return navProto;
}

function getNamespaceNav(proto: object): object | undefined {
  return namespaceNavMap.get(proto);
}

interface QueryableProto<T> extends BaseProtoType {
  whose(filter: WhoseFilter): Res<QueryableProto<T> & BaseProtoType>;
  sortBy(spec: SortSpec<T>): Res<QueryableProto<T> & BaseProtoType>;
  paginate(spec: PaginationSpec): Res<QueryableProto<T> & BaseProtoType>;
  expand(fields: string[]): Res<QueryableProto<T> & BaseProtoType>;
}

// Helper to get a property value, handling JXA specifiers (functions)
function getPropValue(item: any, field: string): any {
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

function applyQueryState<T>(items: T[], query: QueryState): T[] {
  let results = items;

  if (query.filter && Object.keys(query.filter).length > 0) {
    results = results.filter((item: any) => {
      for (const [field, pred] of Object.entries(query.filter!)) {
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
    results = [...results].sort((a: any, b: any) => {
      const aVal = getPropValue(a, by as string);
      const bVal = getPropValue(b, by as string);
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

function buildURIString(segments: PathSegment[]): string {
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
        uri += `%5B${seg.value}%5D`;  // URL-encoded [ and ]
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

function buildURI(segments: PathSegment[]): URL {
  return new URL(buildURIString(segments));
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

    const segment: URISegment = { head };

    // Check for literal [ or URL-encoded %5B
    if (remaining.startsWith('[') || remaining.toUpperCase().startsWith('%5B')) {
      const isEncoded = remaining.toUpperCase().startsWith('%5B');
      const openLen = isEncoded ? 3 : 1;  // '%5B' vs '['
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

    // For namespace protos, look up properties in the target proto
    const lookupProto = getNamespaceNav(proto) || proto;
    const childProto = lookupProto[head];

    // Check for namespaceNav first (virtual grouping, no JXA navigation)
    const namespaceTargetProto = childProto ? getNamespaceNav(childProto) : undefined;
    if (namespaceTargetProto) {
      delegate = delegate.namespace(head);
      // Keep the navProto (childProto) which has the custom resolve, not the inner targetProto
      proto = childProto!;
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
        } else if (qualifier.kind === 'id') {
          if (!hasById(proto)) {
            return { ok: false, error: `computedNav target '${head}' does not support id addressing` };
          }
          delegate = delegate.byId(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'query') {
          const applied = applyQueryQualifier(delegate, proto, qualifier);
          delegate = applied.delegate;
          proto = applied.proto;
        }
      }
    } else if (childProto !== undefined && isChildProto(childProto)) {
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
      const available = Object.keys(lookupProto).filter(k => {
        const v = lookupProto[k];
        return isChildProto(v);
      });
      return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
    }
  }

  return { ok: true, value: createRes(delegate, proto) };
}
