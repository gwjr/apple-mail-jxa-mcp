// src/framework/specifier.ts - Specifier Type & Proxy
//
// The proxy wrapper that makes protos usable. Specifier is the unified type
// for all navigable references - both lazy references from collection accessors
// and fully-resolved proxy objects.

// ─────────────────────────────────────────────────────────────────────────────
// Specifier Type
// ─────────────────────────────────────────────────────────────────────────────

type Specifier<P> = P & {
  _delegate: Delegate;
  uri: URL;
  resolve(): unknown;  // Return type varies by proto kind
  toJSON(): { uri: string };
};

// ─────────────────────────────────────────────────────────────────────────────
// Specifier Factory
// ─────────────────────────────────────────────────────────────────────────────

function createSpecifier<P extends object>(delegate: Delegate, proto: P): Specifier<P> {
  // For namespace protos, get the target proto for property lookup
  const targetProto = getNamespaceNav(proto) || proto;

  const handler: ProxyHandler<{ _delegate: Delegate }> = {
    get(t, prop: string | symbol, receiver) {
      if (prop === '_delegate') return t._delegate;
      if (prop === 'uri') return t._delegate.uri();

      // Intercept toJSON for MCP serialization
      if (prop === 'toJSON') {
        return () => ({ uri: t._delegate.uri().href });
      }

      // Intercept resolve to use the proto's resolutionStrategy
      if (prop === 'resolve') {
        return () => {
          if ('resolutionStrategy' in proto && typeof (proto as any).resolutionStrategy === 'function') {
            return (proto as any).resolutionStrategy(t._delegate, proto, receiver);
          }
          // Fallback to proto's resolve method
          const resolveMethod = (proto as any).resolve;
          if (typeof resolveMethod === 'function') {
            return resolveMethod.call(receiver);
          }
          throw new Error('Proto has no resolutionStrategy or resolve method');
        };
      }

      // First check the main proto for methods (exists, etc.)
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
          // Check for namespace navigation - use navigationStrategy
          const innerNamespaceProto = getNamespaceNav(value);
          if (innerNamespaceProto) {
            return createSpecifier(t._delegate.namespace(prop as string), value);
          }
          // Check for computed navigation - use _computedNav data
          const navInfo = getComputedNav(value);
          if (navInfo) {
            const targetDelegate = navInfo.navigate(t._delegate);
            return createSpecifier(targetDelegate, value);
          }
          // Normal property navigation - use jxaName if defined, otherwise use the property name
          const jxaName = getJxaName(value);
          const schemaName = prop as string;
          if (jxaName) {
            // Navigate with JXA name but track schema name for URI
            return createSpecifier(t._delegate.propWithAlias(jxaName, schemaName), value);
          } else {
            return createSpecifier(t._delegate.prop(schemaName), value);
          }
        }
        return value;
      }

      return undefined;
    },
    has(t, prop: string | symbol) {
      if (prop === '_delegate' || prop === 'uri' || prop === 'toJSON') return true;
      return prop in proto || prop in targetProto;
    },
    ownKeys(t) {
      // Combine keys from proto and targetProto, plus _delegate, uri, and toJSON
      const keys = new Set<string | symbol>(['_delegate', 'uri', 'toJSON']);
      for (const key of Object.keys(proto)) keys.add(key);
      for (const key of Object.keys(targetProto)) keys.add(key);
      return [...keys];
    },
    getOwnPropertyDescriptor(t, prop) {
      // Make properties enumerable for Object.keys() to work
      if (prop === '_delegate' || prop === 'uri' || prop === 'toJSON' || prop in proto || prop in targetProto) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    }
  };

  return new Proxy({ _delegate: delegate } as any, handler);
}
