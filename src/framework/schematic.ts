// src/framework/schematic.ts - Schema DSL & Type Composition
//
// The core typing system for schema definitions. Types and proto implementations
// live together - the DSL specifies the schema by building the proto.

// ─────────────────────────────────────────────────────────────────────────────
// Brands (compile-time only)
// ─────────────────────────────────────────────────────────────────────────────

// Proto brand - marks types that exist in the JXA object graph
// Used to constrain Specifier<P> to only accept JXA-world types
declare const ProtoBrand: unique symbol;
type Proto = { readonly [ProtoBrand]: void };

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
declare const NamespaceBrand: unique symbol;
declare const ComputedNavBrand: unique symbol;

// ─────────────────────────────────────────────────────────────────────────────
// Resolution & Navigation Strategies
// ─────────────────────────────────────────────────────────────────────────────

// Resolution strategy: how to get the value when resolve() is called directly
// Returns unknown because return type varies by proto kind:
// - Scalar: T (the primitive value)
// - Collection: CollectionResolveResult (array of URIs)
// - Object: { [key]: resolved child value }
type ResolutionStrategy = (delegate: Delegate, proto: any, res: any) => unknown;

// How to resolve when my parent is resolving me as one of its properties.
// By default, same as resolutionStrategy (eager). Lazy protos override to return Specifier.
type ResolveFromParentStrategy = (delegate: Delegate, proto: any, res: any) => unknown;

// Navigation strategy: how to navigate to a child property
// Returns the delegate for the child, or undefined for no navigation (namespace)
type NavigationStrategy = (delegate: Delegate, key: string, childProto: any) => Delegate;

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Constants
// ─────────────────────────────────────────────────────────────────────────────

// Base keys to skip during object property enumeration
const BASE_KEYS = new Set(['resolve', 'exists', 'uri', '_delegate', 'resolutionStrategy', 'resolveFromParent', 'navigationStrategy']);

function isBaseKey(key: string): boolean {
  return BASE_KEYS.has(key);
}

// Scalar strategy: just call _jxa() and return the raw value
const scalarStrategy: ResolutionStrategy = (delegate) => delegate._jxa();

// Object strategy: gather properties recursively
const objectStrategy: ResolutionStrategy = (_delegate, proto, res) => {
  const result: Record<string, any> = {};

  // Get the target proto for property lookup (handles namespace case)
  const targetProto = proto._namespaceTarget || proto;

  for (const key of Object.keys(targetProto)) {
    if (isBaseKey(key)) continue;
    const childProto = targetProto[key];
    if (childProto && typeof childProto === 'object' && 'resolutionStrategy' in childProto) {
      try {
        // Access the child through the Res proxy to get proper navigation
        const childRes = res[key];
        if (childRes && typeof childRes === 'object' && '_delegate' in childRes) {
          // Use resolveFromParent if defined, otherwise fall back to resolutionStrategy
          const resolveFromParent = childProto.resolveFromParent || childProto.resolutionStrategy;
          const childValue = resolveFromParent(childRes._delegate, childProto, childRes);
          if (childValue !== undefined) {
            result[key] = childValue;
          }
        }
      } catch {
        // Skip properties that fail to resolve
      }
    }
  }
  return result;
};

// Collection strategy: return array of URIs for each item
const collectionStrategy: ResolutionStrategy = (delegate) => {
  const raw = delegate._jxa();
  if (!Array.isArray(raw)) {
    throw new TypeError(`Collection expected array, got ${typeof raw}`);
  }
  return raw.map((_item: unknown, i: number) => {
    const itemDelegate = delegate.byIndex(i);
    return { uri: itemDelegate.uri() };
  });
};

// Lazy resolve-from-parent: return Specifier instead of resolving
const lazyResolveFromParent: ResolveFromParentStrategy = (delegate, proto) => {
  return {
    uri: delegate.uri(),
    resolve: () => createRes(delegate, proto),
    toJSON: () => ({ uri: delegate.uri().href }),
  };
};

// Default navigation: navigate by property name
const defaultNavigation: NavigationStrategy = (delegate, key) => delegate.prop(key);

// Namespace navigation: add URI segment but don't navigate JXA
const namespaceNavigation: NavigationStrategy = (delegate, key) => delegate.namespace(key);

// ─────────────────────────────────────────────────────────────────────────────
// Specifier Type
// ─────────────────────────────────────────────────────────────────────────────

// Specifier - typed reference to a JXA object specifier
// P = the proto (must be a JXA-world type marked with ProtoBrand)
// Returned by collection accessors (byIndex, byName, byId)
// toJSON() returns just the URI for MCP serialization
type Specifier<P extends Proto> = {
  uri: URL;
  resolve(): Res<P>;
  toJSON(): { uri: string };
};

// ─────────────────────────────────────────────────────────────────────────────
// Type-level utilities
// ─────────────────────────────────────────────────────────────────────────────

// Collection resolve returns array of URIs (possibly enriched with extra fields)
type CollectionResolveResult = { uri: URL }[] | { uri: URL; [key: string]: any }[];

type Lazy<T> = T & { readonly [LazyBrand]: true };

type ScalarType<T> = { readonly [ScalarBrand]: T };
type CollectionType<Item> = { readonly [CollectionBrand]: Item };

type ExtractScalar<T> = T extends { readonly [ScalarBrand]: infer S } ? S : never;
type ExtractItem<T> = T extends { readonly [CollectionBrand]: infer I } ? I : never;
type IsLazy<T> = T extends { readonly [LazyBrand]: true } ? true : false;

// ─────────────────────────────────────────────────────────────────────────────
// Base Prototype Types
// ─────────────────────────────────────────────────────────────────────────────

// Base proto interface - common methods for all protos
// Includes Proto brand to mark as JXA-world type
interface BaseProtoType<T> extends Proto {
  exists(): boolean;
  resolve(): T;
  resolutionStrategy: ResolutionStrategy;
  navigationStrategy?: NavigationStrategy;
}

// Scalar proto: has ScalarBrand for discrimination
type ScalarProto<T> = BaseProtoType<T> & {
   readonly [ScalarBrand]: T;
};

// Accessor interfaces for collections - return Specifier for deferred resolution
// Item = the proto of elements in the collection (what accessors yield)
interface IndexAccessor<Item extends Proto> {
  byIndex(n: number): Specifier<Item>;
}

interface NameAccessor<Item extends Proto> {
  byName(name: string): Specifier<Item>;
}

interface IdAccessor<Item extends Proto> {
  byId(id: string | number): Specifier<Item>;
}

// Collection proto with at least one accessor
// Item = the element proto (what you get when you access by index/name/id)
type CollectionProto<Item extends Proto> = BaseProtoType<CollectionResolveResult> & {
  readonly [CollectionBrand]: Item;
} & (IndexAccessor<Item> | NameAccessor<Item> | IdAccessor<Item>);

// ─────────────────────────────────────────────────────────────────────────────
// Common exists() implementation
// ─────────────────────────────────────────────────────────────────────────────

function existsImpl(this: { _delegate: Delegate }): boolean {
  try {
    const result = this._delegate._jxa();
    return result !== undefined && result !== null;
  } catch {
    return false;
  }
}

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
  const validatingStrategy: ResolutionStrategy = (delegate) => {
    const raw = delegate._jxa();
    return validate(raw);
  };

  return {
    resolutionStrategy: validatingStrategy,
    exists: existsImpl,
    resolve(this: { _delegate: Delegate }): T {
      return validatingStrategy(this._delegate, null, null) as T;
    },
  } as ScalarProto<T>;  // Type assertion adds Proto brand
}

// Passthrough scalar - no validation, for untyped content
const passthrough: ScalarProto<unknown> = {
  resolutionStrategy: scalarStrategy,
  exists: existsImpl,
  resolve(this: { _delegate: Delegate }): unknown {
    return this._delegate._jxa();
  },
} as ScalarProto<unknown>;

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
const baseObject: BaseProtoType<any> = {
  resolutionStrategy: objectStrategy,
  exists: existsImpl,
  resolve(this: Res<any>): any {
    return objectStrategy(this._delegate, baseObject, this);
  },
} as BaseProtoType<any>;


// ─────────────────────────────────────────────────────────────────────────────
// Collection Item Proto Tracking
// ─────────────────────────────────────────────────────────────────────────────

const collectionItemProtos = new WeakMap<object, object>();

function getItemProto(collectionProto: object): object | undefined {
  return collectionItemProtos.get(collectionProto);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy Composer
// ─────────────────────────────────────────────────────────────────────────────

// lazy: marks a property as "lazy" - when resolved as part of a parent object,
// returns a specifier (URL) instead of the actual value. Direct resolution returns the value.
function lazy<P extends BaseProtoType<any>>(proto: P): P & { readonly [LazyBrand]: true } {
  const lazyProto = {
    ...proto,
    resolveFromParent: lazyResolveFromParent,
  } as unknown as P & { readonly [LazyBrand]: true };

  // Copy over collection item proto if this is a collection
  const itemProto = collectionItemProtos.get(proto);
  if (itemProto) {
    collectionItemProtos.set(lazyProto, itemProto);
  }
  return lazyProto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection Factory
// ─────────────────────────────────────────────────────────────────────────────

// Accessor kinds that a collection can support
enum Accessor {
  Index,
  Name,
  Id
}

// Map accessor kind to the corresponding interface
type AccessorFor<K, Item extends Proto> =
  K extends Accessor.Index ? IndexAccessor<Item> :
  K extends Accessor.Name ? NameAccessor<Item> :
  K extends Accessor.Id ? IdAccessor<Item> :
  never;

// Build intersection of accessors from a tuple of kinds
type AccessorsFor<Ks extends readonly Accessor[], Item extends Proto> =
  Ks extends readonly [infer First, ...infer Rest]
    ? AccessorFor<First, Item> & (Rest extends readonly Accessor[] ? AccessorsFor<Rest, Item> : {})
    : {};

// Base collection type (without accessors)
type BaseCollection<Item extends Proto> = BaseProtoType<CollectionResolveResult> & {
  readonly [CollectionBrand]: Item;
};

// Collection factory - accessors determined by the 'by' tuple
function collection<Item extends Proto, const K extends readonly Accessor[]>(
  itemProto: Item,
  by: K
): BaseCollection<Item> & AccessorsFor<K, Item> {

  const proto: any = {
    resolutionStrategy: collectionStrategy,
    exists: existsImpl,
    // resolve() returns URIs for each item
    resolve(this: { _delegate: Delegate }): CollectionResolveResult {
      return collectionStrategy(this._delegate, proto, this) as CollectionResolveResult;
    },
  };

  if (by.includes(Accessor.Index)) {
    proto.byIndex = function(this: { _delegate: Delegate }, n: number): Specifier<Item> {
      const itemDelegate = this._delegate.byIndex(n);
      return {
        uri: itemDelegate.uri(),
        resolve: () => createRes(itemDelegate, itemProto),
        toJSON: () => ({ uri: itemDelegate.uri().href }),
      };
    };
  }

  if (by.includes(Accessor.Name)) {
    proto.byName = function(this: { _delegate: Delegate }, name: string): Specifier<Item> {
      const itemDelegate = this._delegate.byName(name);
      return {
        uri: itemDelegate.uri(),
        resolve: () => createRes(itemDelegate, itemProto),
        toJSON: () => ({ uri: itemDelegate.uri().href }),
      };
    };
  }

  if (by.includes(Accessor.Id)) {
    proto.byId = function(this: { _delegate: Delegate }, id: string | number): Specifier<Item> {
      const itemDelegate = this._delegate.byId(id);
      return {
        uri: itemDelegate.uri(),
        resolve: () => createRes(itemDelegate, itemProto),
        toJSON: () => ({ uri: itemDelegate.uri().href }),
      };
    };
  }

  collectionItemProtos.set(proto, itemProto);
  return proto as BaseCollection<Item> & AccessorsFor<K, Item>;
}


// ─────────────────────────────────────────────────────────────────────────────
// Settable Composer
// ─────────────────────────────────────────────────────────────────────────────

interface SettableProto<T> {
  set(value: T): void;
}

// withSet works on scalar protos - adds a set() method for the scalar's value type
function withSet<T>(proto: ScalarProto<T>): ScalarProto<T> & SettableProto<T> & { readonly [SettableBrand]: true } {
  return {
    ...proto,
    set(this: { _delegate: Delegate }, value: T) {
      this._delegate.set(value);
    },
  } as ScalarProto<T> & SettableProto<T> & { readonly [SettableBrand]: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Composers (move, delete, create)
// ─────────────────────────────────────────────────────────────────────────────

// Operation handler types - return URL, composer wraps in Res
type MoveHandler = (item: Delegate, destCollection: Delegate) => Result<URL>;
type DeleteHandler = (item: Delegate) => Result<URL>;
type CreateHandler = (collection: Delegate, properties: Record<string, any>) => Result<URL>;

// Moveable proto interface
interface MoveableProto<Item extends Proto> {
  move<C extends CollectionProto<Item>>(to: Res<C>): Result<Res<Item>>;
}

// Composer: adds move() with optional custom handler
function withMove<Item extends Proto>(itemProto: Item, handler?: MoveHandler) {
  return function<P extends Proto>(proto: P): P & MoveableProto<Item> & { readonly [MoveableBrand]: true } {
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
  return function<P extends Proto>(proto: P): P & DeleteableProto & { readonly [DeleteableBrand]: true } {
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
interface CreateableProto<Item extends Proto> {
  create(properties: Partial<Item>): Result<Res<Item>>;
}

// Composer: adds create() with optional custom handler
function withCreate<Item extends Proto>(itemProto: Item, handler?: CreateHandler) {
  return function<P extends Proto>(proto: P): P & CreateableProto<Item> & { readonly [CreateableBrand]: true } {
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
  const computedStrategy: ResolutionStrategy = (delegate) => {
    const raw = delegate._jxa();
    return transform(raw);
  };

  return {
    resolutionStrategy: computedStrategy,
    exists: existsImpl,
    resolve(this: { _delegate: Delegate }): T {
      const raw = this._delegate._jxa();
      return transform(raw);
    },
  } as BaseProtoType<T>;  // Type assertion adds Proto brand
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed Navigation
// ─────────────────────────────────────────────────────────────────────────────

// computedNav is for properties that require multiple delegate operations to navigate.
// For simple property navigation (including jxaName mapping), use withJxaName instead.

type NavigationFn = (d: Delegate) => Delegate;

type ComputedNavProto<P> = P & { readonly [ComputedNavBrand]: true };

function computedNav<P extends BaseProtoType<any>>(
  navigate: NavigationFn,
  targetProto: P
): ComputedNavProto<P> {
  // Create a strategy that navigates first, then uses target's strategy
  const navStrategy: ResolutionStrategy = (delegate, proto, res) => {
    const targetDelegate = navigate(delegate);
    return targetProto.resolutionStrategy(targetDelegate, targetProto, res);
  };

  // Create a navigation strategy that applies the custom navigation
  const navNavigation: NavigationStrategy = (delegate) => navigate(delegate);

  const navProto = {
    ...targetProto,
    resolutionStrategy: navStrategy,
    navigationStrategy: navNavigation,
    _computedNav: { navigate, targetProto },  // Store for URI resolution
    resolve(this: { _delegate: Delegate }) {
      const targetDelegate = navigate(this._delegate);
      return targetProto.resolutionStrategy(targetDelegate, targetProto, this);
    },
    exists(this: { _delegate: Delegate }): boolean {
      try {
        navigate(this._delegate)._jxa();
        return true;
      } catch {
        return false;
      }
    },
  } as unknown as ComputedNavProto<P>;

  // Copy collection item proto if target is a collection
  const itemProto = collectionItemProtos.get(targetProto);
  if (itemProto) {
    collectionItemProtos.set(navProto, itemProto);
  }

  return navProto;
}

function getComputedNav(proto: object): { navigate: NavigationFn; targetProto: object } | undefined {
  return (proto as any)._computedNav;
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Navigation
// ─────────────────────────────────────────────────────────────────────────────

// A namespace is a virtual grouping that:
// 1. Shares its parent's delegate (no JXA navigation)
// 2. Adds a segment to the URI path for schema clarity
// 3. Has its own proto with the grouped properties
// When resolved, a namespace gathers all its properties and returns them as an object

type NamespaceProto<P> = P & { readonly [NamespaceBrand]: true };

function namespaceNav<P extends object>(targetProto: P): NamespaceProto<P> {
  // Custom strategy that gathers all properties from the target proto
  const namespaceStrategy: ResolutionStrategy = (delegate, proto, res) => {
    const result: Record<string, any> = {};
    // Get all property names from the target proto (excluding base methods)
    for (const key of Object.keys(targetProto)) {
      if (isBaseKey(key)) continue;
      try {
        // Navigate to the property and resolve it
        const propRes = (res as any)[key];
        if (propRes && typeof propRes.resolve === 'function') {
          result[key] = propRes.resolve();
        }
      } catch {
        // Skip properties that fail to resolve
      }
    }
    return result;
  };

  const navProto = {
    resolutionStrategy: namespaceStrategy,
    navigationStrategy: namespaceNavigation,
    _namespaceTarget: targetProto,  // Store for property lookup
    resolve(this: Res<any>): any {
      return namespaceStrategy(this._delegate, navProto, this);
    },
    exists(this: Res<any>): boolean {
      return true; // Namespaces always exist
    },
  } as unknown as NamespaceProto<P>;

  return navProto;
}

function getNamespaceNav(proto: object): object | undefined {
  return (proto as any)._namespaceTarget;
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

  const queryStrategy: ResolutionStrategy = (delegate) => {
    const raw = delegate._jxa();
    if (!Array.isArray(raw)) {
      throw new TypeError(`Query expected array, got ${typeof raw}`);
    }
    const query = delegate.queryState();
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
  };

  const queryProto = {
    ...proto,
    resolutionStrategy: queryStrategy,

    resolve(this: { _delegate: Delegate }) {
      return queryStrategy(this._delegate, queryProto, this);
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

  // Copy collection item proto
  if (itemProto) {
    collectionItemProtos.set(queryProto, itemProto);
  }

  return queryProto;
}


