// src/framework/res.ts - Res Type & Proxy
//
// The proxy wrapper that makes protos usable.

// ─────────────────────────────────────────────────────────────────────────────
// Res Type
// ─────────────────────────────────────────────────────────────────────────────

type Res<P> = P & { _delegate: Delegate; _isLazy?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Res Factory
// ─────────────────────────────────────────────────────────────────────────────

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
