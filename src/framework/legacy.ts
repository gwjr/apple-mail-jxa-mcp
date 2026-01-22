// src/framework/legacy.ts - Backwards Compatibility Shims
//
// Legacy composers and factories for backwards compatibility with existing schemas.
// New code should use the unified collection() factory instead.

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Base Collection (no accessors)
// ─────────────────────────────────────────────────────────────────────────────

// Base collection for use with legacy composers - returns raw array, no accessors
const baseCollection: BaseProtoType<any[]> = {
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
  resolve(this: { _delegate: Delegate }): any[] {
    return this._delegate._jxa();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Collection Composers
// ─────────────────────────────────────────────────────────────────────────────

interface ByIndexProto<Item> {
  byIndex(n: number): Res<Item>;
}

function withByIndex<Item extends object>(itemProto: Item) {
  return function<P extends BaseProtoType<any>>(proto: P): P & ByIndexProto<Item> & { readonly [ByIndexBrand]: true; resolve(): CollectionResolveResult } {
    const result = {
      ...proto,
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
  return function<P extends BaseProtoType<any>>(proto: P): P & ByNameProto<Item> & { readonly [ByNameBrand]: true } {
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
  return function<P extends BaseProtoType<any>>(proto: P): P & ByIdProto<Item> & { readonly [ByIdBrand]: true } {
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
// Composition Utilities
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
