// src/framework/schematic.ts - Schema DSL & Type Composition
//
// The core typing system for schema definitions. Types and proto implementations
// live together - the DSL specifies the schema by building the proto.

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

// Mark schema types
//declare const SchematicBrand: unique symbol;
//interface Schematic { [SchematicBrand]: void; }

// ─────────────────────────────────────────────────────────────────────────────
// Type-level utilities
// ─────────────────────────────────────────────────────────────────────────────

type Specifier = { uri: URL };

// Collection resolve returns array of specifiers - either bare {uri} or enriched with extra fields
type CollectionResolveResult = { uri: URL }[] | { uri: URL; [key: string]: any }[];

type Lazy<T> = T & { readonly [LazyBrand]: true };

type ScalarType<T> = { readonly [ScalarBrand]: T };
//type EagerScalarType<T> = ScalarType<T> & { readonly [EagerBrand]: true };
//type LazyScalarType<T> = ScalarType<T> & { readonly [LazyBrand]: true };

type CollectionType<Item> = { readonly [CollectionBrand]: Item };
//type EagerCollectionType<Item> = CollectionType<Item> & { readonly [EagerBrand]: true };
//type LazyCollectionType<Item> = CollectionType<Item> & { readonly [LazyBrand]: true };

type ExtractScalar<T> = T extends { readonly [ScalarBrand]: infer S } ? S : never;
type ExtractItem<T> = T extends { readonly [CollectionBrand]: infer I } ? I : never;
type IsLazy<T> = T extends { readonly [LazyBrand]: true } ? true : false;

// ─────────────────────────────────────────────────────────────────────────────
// Base Prototype Types
// ─────────────────────────────────────────────────────────────────────────────

// Base proto interface - common methods for all protos
interface BaseProtoType<T = any> {
  exists(): boolean;
  specifier(): Specifier;
  resolve(): T;
}

// Scalar proto: has ScalarBrand for discrimination
type ScalarProto<T> = BaseProtoType<T> & {
   readonly [ScalarBrand]: T;
};

// Accessor types for collections
type IndexAccessor<Item = any> = { byIndex(n: number): Res<Item> };
type NameAccessor<Item = any> = { byName(name: string): Res<Item> };
type IdAccessor<Item = any> = { byId(id: string | number): Res<Item> };

// Collection proto with at least one accessor
type CollectionProto<T = any> = BaseProtoType<CollectionResolveResult> & {
  readonly [CollectionBrand]: T;
} & (IndexAccessor<T> | NameAccessor<T> | IdAccessor<T>);

// ─────────────────────────────────────────────────────────────────────────────
// Proto Implementation Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Shared implementation for base proto methods (scalar resolve)
const _baseProtoImpl = {
  exists(this: { _delegate: Delegate }): boolean {
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
  resolve(this: { _delegate: Delegate }): any {
    return this._delegate._jxa();
  },
};

// Object proto implementation - gathers properties on resolve instead of returning JXA specifier
// Use this for complex objects (mailboxes, messages, etc.) that have child properties
const _objectProtoImpl = {
  resolve(this: Res<any>): any {
    // Iterate over all enumerable properties and resolve them
    const result: Record<string, any> = {};
    const baseKeys = new Set(['resolve', 'exists', 'specifier', '_delegate', '_isLazy']);

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
  exists(this: { _delegate: Delegate }): boolean {
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

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

type Validator<T> = (raw: unknown) => T;

// Primitive validators
const isString: Validator<string> = (v: unknown): string => {
  if (typeof v !== 'string') throw new TypeError(`Expected string, got ${typeof v}`);
  return v;
};

const isNumber: Validator<number> = (v: unknown): number => {
  if (typeof v !== 'number') throw new TypeError(`Expected number, got ${typeof v}`);
  return v;
};

const isBoolean: Validator<boolean> = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new TypeError(`Expected boolean, got ${typeof v}`);
  return v;
};

const isDate: Validator<Date> = (v: unknown): Date => {
  if (v instanceof Date) return v;
  // Also accept ISO date strings
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  throw new TypeError(`Expected Date, got ${typeof v}`);
};

// Passthrough validator - no validation, explicit unknown type
const isAny: Validator<unknown> = (v: unknown): unknown => v;

// Array validators
const isStringArray: Validator<string[]> = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new TypeError(`Expected array, got ${typeof v}`);
  return v.map(isString);
};

// Optional wrapper - allows null/undefined
function optional<T>(validator: Validator<T>): Validator<T | null> {
  return (v: unknown): T | null => {
    if (v === null || v === undefined) return null;
    return validator(v);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scalar Factories
// ─────────────────────────────────────────────────────────────────────────────

// Typed scalar factory with runtime validation
function scalar<T>(validate: Validator<T>): ScalarProto<T> {
  return {
    exists(this: { _delegate: Delegate }): boolean {
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
    resolve(this: { _delegate: Delegate }): T {
      const raw = this._delegate._jxa();
      return validate(raw);
    },
  } as ScalarProto<T>;
}

// Passthrough scalar - no validation, for untyped content
const passthrough = scalar(isAny);

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
const baseObject: BaseProtoType<any> = { ..._objectProtoImpl };


// ─────────────────────────────────────────────────────────────────────────────
// Lazy Proto Tracking
// ─────────────────────────────────────────────────────────────────────────────

// Track lazy protos for parent object resolution
const lazyProtos = new WeakSet<object>();

// lazy: marks a property as "lazy" - when resolved as part of a parent object,
// returns a specifier (URL) instead of the actual value. Direct resolution returns the value.
function lazy<P extends BaseProtoType<any>>(proto: P): P & { readonly [LazyBrand]: true } {
  const lazyProto = { ...proto } as P & { readonly [LazyBrand]: true };
  lazyProtos.add(lazyProto);
  // Copy over collection item proto if this is a collection
  // (since spread creates new object that won't be in the WeakMap)
  const itemProto = collectionItemProtos.get(proto);
  if (itemProto) {
    collectionItemProtos.set(lazyProto, itemProto);
  }
  return lazyProto;
}

function isLazyProto(proto: object): boolean {
  return lazyProtos.has(proto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Item Proto Tracking
// ─────────────────────────────────────────────────────────────────────────────

const collectionItemProtos = new WeakMap<object, object>();

function getItemProto(collectionProto: object): object | undefined {
  return collectionItemProtos.get(collectionProto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Factory with Accessor Config
// ─────────────────────────────────────────────────────────────────────────────

// Accessor configuration for collection factory
type CollectionAccessors<Item> = {
  byIndex?: Item;
  byName?: Item;
  byId?: Item;
};

// Build collection result type based on which accessors are provided
type CollectionWithAccessors<Item, A extends CollectionAccessors<Item>> =
  BaseProtoType<CollectionResolveResult> &
  { readonly [CollectionBrand]: Item } &
  (A extends { byIndex: any } ? IndexAccessor<Item> : {}) &
  (A extends { byName: any } ? NameAccessor<Item> : {}) &
  (A extends { byId: any } ? IdAccessor<Item> : {});

// Collection factory that takes accessor config
function collection<Item extends object, A extends CollectionAccessors<Item>>(
  accessors: A & (
    { byIndex: Item } | { byName: Item } | { byId: Item }
  )
): CollectionWithAccessors<Item, A> {
  const itemProto = accessors.byIndex || accessors.byName || accessors.byId;

  const proto: any = {
    exists(this: { _delegate: Delegate }): boolean {
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
    // resolve() returns specifiers for each item
    resolve(this: { _delegate: Delegate }): CollectionResolveResult {
      const raw = this._delegate._jxa();
      if (!Array.isArray(raw)) {
        throw new TypeError(`Collection expected array, got ${typeof raw}`);
      }
      return raw.map((_item: unknown, i: number) => {
        const itemDelegate = this._delegate.byIndex(i);
        return { uri: itemDelegate.uri() };
      });
    },
  };

  if (accessors.byIndex) {
    proto.byIndex = function(this: { _delegate: Delegate }, n: number): Res<Item> {
      return createRes(this._delegate.byIndex(n), itemProto!);
    };
  }

  if (accessors.byName) {
    proto.byName = function(this: { _delegate: Delegate }, name: string): Res<Item> {
      return createRes(this._delegate.byName(name), itemProto!);
    };
  }

  if (accessors.byId) {
    proto.byId = function(this: { _delegate: Delegate }, id: string | number): Res<Item> {
      return createRes(this._delegate.byId(id), itemProto!);
    };
  }

  collectionItemProtos.set(proto, itemProto!);
  return proto as CollectionWithAccessors<Item, A>;
}


// ─────────────────────────────────────────────────────────────────────────────
// Settable Composer
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Composers (move, delete, create)
// ─────────────────────────────────────────────────────────────────────────────

// Operation handler types - return URL, composer wraps in Res
type MoveHandler = (item: Delegate, destCollection: Delegate) => Result<URL>;
type DeleteHandler = (item: Delegate) => Result<URL>;
type CreateHandler = (collection: Delegate, properties: Record<string, any>) => Result<URL>;

// Moveable proto interface
interface MoveableProto<Item> {
  move<C extends CollectionProto<Item>>(to: Res<C>): Result<Res<Item>>;
}

// Composer: adds move() with optional custom handler
function withMove<Item extends object>(itemProto: Item, handler?: MoveHandler) {
  return function<P extends BaseProtoType<any>>(proto: P): P & MoveableProto<Item> & { readonly [MoveableBrand]: true } {
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
  return function<P extends BaseProtoType<any>>(proto: P): P & DeleteableProto & { readonly [DeleteableBrand]: true } {
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
  return function<P extends BaseProtoType<any>>(proto: P): P & CreateableProto<Item> & { readonly [CreateableBrand]: true } {
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
function computed<T>(transform: (raw: any) => T): BaseProtoType<T> {
  return {
    resolve(this: { _delegate: Delegate }): T {
      const raw = this._delegate._jxa();
      return transform(raw);
    },
    exists(this: { _delegate: Delegate }): boolean {
      try {
        this._delegate._jxa();
        return true;
      } catch {
        return false;
      }
    },
    specifier(this: { _delegate: Delegate }): Specifier {
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
    exists(this: { _delegate: Delegate }): boolean {
      try {
        navigate(this._delegate)._jxa();
        return true;
      } catch {
        return false;
      }
    },
    specifier(this: { _delegate: Delegate }): Specifier {
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

// ─────────────────────────────────────────────────────────────────────────────
// Query Composer
// ─────────────────────────────────────────────────────────────────────────────

interface QueryableProto<T> extends BaseProtoType<any> {
  whose(filter: WhoseFilter): Res<QueryableProto<T> & BaseProtoType<any>>;
  sortBy(spec: SortSpec<T>): Res<QueryableProto<T> & BaseProtoType<any>>;
  paginate(spec: PaginationSpec): Res<QueryableProto<T> & BaseProtoType<any>>;
  expand(fields: string[]): Res<QueryableProto<T> & BaseProtoType<any>>;
}

function withQuery<P extends BaseProtoType<any>>(proto: P): P & QueryableProto<any> {
  const itemProto = collectionItemProtos.get(proto);

  return {
    ...proto,

    resolve(this: { _delegate: Delegate }) {
      const raw = this._delegate._jxa();
      if (!Array.isArray(raw)) {
        throw new TypeError(`Query expected array, got ${typeof raw}`);
      }
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
// Proto Guards
// ─────────────────────────────────────────────────────────────────────────────

function hasByIndex(proto: object): proto is { byIndex: (n: number) => unknown } {
  return 'byIndex' in proto && typeof (proto as any).byIndex === 'function';
}

function hasByName(proto: object): proto is { byName: (name: string) => unknown } {
  return 'byName' in proto && typeof (proto as any).byName === 'function';
}

function hasById(proto: object): proto is { byId: (id: string | number) => unknown } {
  return 'byId' in proto && typeof (proto as any).byId === 'function';
}

function isChildProto(value: unknown): value is BaseProtoType<any> {
  return typeof value === 'object' && value !== null && 'resolve' in value && typeof (value as any).resolve === 'function';
}
