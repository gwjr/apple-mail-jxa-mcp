/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />

// ============================================================================
// Runtime Implementation
// ============================================================================

function str(value: unknown): string {
  return value == null ? '' : '' + value;
}

function tryResolve<T>(fn: () => T, context: string): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: `${context}: ${error}` };
  }
}

function scalarSpec<T>(uri: string, getter: () => T): Specifier<T> {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve: () => tryResolve(getter, uri),
    fix: () => ({ ok: true, value: spec })
  };
  return spec;
}

function mutableSpec<T>(uri: string, getter: () => T, setter: (value: T) => void): MutableSpecifier<T> {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve: () => tryResolve(getter, uri),
    fix: () => ({ ok: true, value: spec }),
    set: (value: T) => tryResolve(() => { setter(value); }, `${uri}:set`)
  };
  return spec;
}

// ============================================================================
// Descriptor Helpers
// ============================================================================

function isScalar(desc: Descriptor): desc is ScalarDescriptor {
  return desc.dimension === 'scalar';
}

function isCollection(desc: Descriptor): desc is CollectionDescriptor {
  return Array.isArray(desc.dimension);
}

function isPrimitive(type: any): type is PrimitiveType {
  return type === String || type === Number || type === Boolean || type === Date;
}

function getJxaName(desc: Descriptor | undefined, key: string): string {
  return desc?.jxaName ?? key;
}

// ============================================================================
// createDerived - builds runtime class from schema
// ============================================================================

function createDerived<S extends Schema>(schema: S, typeName: string) {
  return class {
    private _jxa: any;
    private _uri?: string;

    constructor(jxa: any, uri?: string) {
      this._jxa = jxa;
      this._uri = uri;

      for (const [key, desc] of Object.entries(schema) as [string, Descriptor][]) {
        const jxaName = getJxaName(desc, key);

        if (isScalar(desc)) {
          if (desc.computed) {
            // Computed property
            Object.defineProperty(this, key, {
              get: () => desc.computed!(this._jxa),
              enumerable: true
            });
          } else if (isPrimitive(desc.type)) {
            // Primitive scalar
            const self = this;
            if (desc.lazy) {
              Object.defineProperty(this, key, {
                get() {
                  const propUri = self._uri ? `${self._uri}/${key}` : `${typeName.toLowerCase()}://.../${key}`;
                  if (desc.set === 'default') {
                    return mutableSpec(propUri, () => convert(self._jxa[jxaName]()), (value) => self._jxa[jxaName].set(value));
                  }
                  return scalarSpec(propUri, () => convert(self._jxa[jxaName]()));
                },
                enumerable: true
              });
            } else {
              Object.defineProperty(this, key, {
                get() { return convert(this._jxa[jxaName]()); },
                enumerable: true
              });
            }
          }
          // Nested schema scalars are handled at navigation time, not here
        } else if (isCollection(desc)) {
          const self = this;
          Object.defineProperty(this, key, {
            get() {
              const base = self._uri || `${typeName.toLowerCase()}://`;
              const collUri = base.endsWith('://') ? `${base}${key}` : `${base}/${key}`;
              return createCollSpec(
                collUri,
                self._jxa[jxaName],
                desc.type,
                desc.dimension,
                `${typeName}_${key}`,
                desc.make,
                desc.take
              );
            },
            enumerable: true
          });
        }
      }
    }

    static fromJXA(jxa: any, uri?: string) {
      return new this(jxa, uri);
    }
  };

  function convert(value: any): any {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(convert);
    return value;
  }
}

// ============================================================================
// Element Specifier
// ============================================================================

function createElemSpec<S extends Schema>(
  uri: string,
  jxa: any,
  schema: S,
  addressing: AddressingMode[],
  typeName: string
): Specifier<any> {
  const DerivedClass = createDerived(schema, typeName);
  const baseMatch = uri.match(/^(.+?)(?:\/[^\/\[]+|\[\d+\])$/);
  const baseUri = baseMatch ? baseMatch[1] : uri;

  const spec: any = {
    _isSpecifier: true,
    _jxa: jxa,
    uri,
    resolve: () => tryResolve(() => DerivedClass.fromJXA(jxa, uri), uri),
    fix(): Result<any> {
      return tryResolve(() => {
        let fixedBase = baseUri;
        if (baseUri.includes('[')) {
          const parentResult = specifierFromURI(baseUri);
          if (parentResult.ok) {
            const fixed = parentResult.value.fix();
            if (fixed.ok) fixedBase = fixed.value.uri;
          }
        }
        if (!addressing.length) {
          if (fixedBase !== baseUri) {
            return createElemSpec(fixedBase + uri.slice(baseUri.length), jxa, schema, addressing, typeName);
          }
          return spec;
        }
        for (const mode of ['id', 'name'] as const) {
          if (!addressing.includes(mode)) continue;
          try {
            const value = jxa[mode]();
            if (value != null && value !== '') {
              return createElemSpec(`${fixedBase}/${encodeURIComponent(String(value))}`, jxa, schema, addressing, typeName);
            }
          } catch {}
        }
        if (fixedBase !== baseUri) {
          return createElemSpec(fixedBase + uri.slice(baseUri.length), jxa, schema, addressing, typeName);
        }
        return spec;
      }, uri);
    }
  };

  for (const [key, desc] of Object.entries(schema) as [string, Descriptor][]) {
    const jxaName = getJxaName(desc, key);

    if (isScalar(desc) && isPrimitive(desc.type)) {
      Object.defineProperty(spec, key, {
        get() {
          if (desc.set === 'default') {
            return mutableSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '', (value) => jxa[jxaName].set(value));
          }
          return scalarSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? '');
        },
        enumerable: true
      });
    } else if (isCollection(desc)) {
      Object.defineProperty(spec, key, {
        get() {
          return createCollSpec(
            `${uri}/${key}`,
            jxa[jxaName],
            desc.type,
            desc.dimension,
            `${typeName}_${key}`,
            desc.make,
            desc.take
          );
        },
        enumerable: true
      });
    }
  }
  return spec;
}

// ============================================================================
// Collection Specifier
// ============================================================================

function createCollSpec<S extends Schema>(
  uri: string,
  jxaColl: any,
  schema: S,
  addressing: AddressingMode[],
  typeName: string,
  makeOp: OperationBehaviour = 'default',
  takeOp: OperationBehaviour = 'default',
  sortSpec?: SortSpec<any>,
  jsFilter?: WhoseFilter<any>,
  pagination?: PaginationSpec,
  expand?: ExpandSpec
): CollectionSpecifier<any> {
  const DerivedClass = createDerived(schema, typeName);
  const baseUri = uri.split('?')[0];

  const spec: any = {
    _isSpecifier: true,
    uri,

    fix(): Result<any> {
      let fixedBase = baseUri;
      if (fixedBase.includes('[')) {
        const lastSlash = fixedBase.lastIndexOf('/');
        const schemeEnd = fixedBase.indexOf('://') + 3;
        if (lastSlash > schemeEnd) {
          const parentResult = specifierFromURI(fixedBase.slice(0, lastSlash));
          if (parentResult.ok) {
            const fixed = parentResult.value.fix();
            if (fixed.ok) fixedBase = fixed.value.uri + '/' + fixedBase.slice(lastSlash + 1);
          }
        }
      }
      if (fixedBase === uri) {
        return { ok: true, value: spec };
      }
      return { ok: true, value: createCollSpec(fixedBase, jxaColl, schema, addressing, typeName, makeOp, takeOp) };
    },

    resolve(): Result<any[]> {
      return tryResolve(() => {
        const array = typeof jxaColl === 'function' ? jxaColl() : jxaColl;
        let results = array.map((jxaItem: any, index: number) => {
          const itemUri = `${baseUri}[${index}]`;
          const elemSpec = createElemSpec(itemUri, jxaItem, schema, addressing, typeName);
          const resolved = elemSpec.resolve();
          if (!resolved.ok) return DerivedClass.fromJXA(jxaItem, itemUri);
          const fixed = elemSpec.fix();
          if (fixed.ok && fixed.value.uri !== itemUri) {
            (resolved.value as any)._ref = fixed.value.uri;
          }
          return resolved.value;
        });

        if (jsFilter && Object.keys(jsFilter).length) {
          results = results.filter((item: any) => {
            for (const [key, predicate] of Object.entries(jsFilter)) {
              const value = item[key];
              const pred = predicate as any;
              if ('contains' in pred && typeof value === 'string' && !value.includes(pred.contains)) return false;
              if ('startsWith' in pred && typeof value === 'string' && !value.startsWith(pred.startsWith)) return false;
              if ('greaterThan' in pred && !(value > pred.greaterThan)) return false;
              if ('lessThan' in pred && !(value < pred.lessThan)) return false;
              if ('equals' in pred && value !== pred.equals) return false;
            }
            return true;
          });
        }

        if (sortSpec) {
          results.sort((a: any, b: any) => {
            const aVal = a[sortSpec.by];
            const bVal = b[sortSpec.by];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortSpec.direction === 'desc' ? -comparison : comparison;
          });
        }

        if (pagination) {
          const start = pagination.offset || 0;
          const end = pagination.limit !== undefined ? start + pagination.limit : undefined;
          results = results.slice(start, end);
        }

        if (expand?.length) {
          results = results.map((item: any) => {
            const expanded: any = {};
            for (const key of Object.keys(item)) {
              const value = item[key];
              if (expand.includes(key) && value?._isSpecifier && typeof value.resolve === 'function') {
                const resolved = value.resolve();
                expanded[key] = resolved.ok ? resolved.value : value;
              } else {
                expanded[key] = value;
              }
            }
            return expanded;
          });
        }

        return results;
      }, uri);
    }
  };

  // Addressing methods
  if (addressing.includes('index')) {
    spec.byIndex = (index: number) => createElemSpec(`${baseUri}[${index}]`, jxaColl.at(index), schema, addressing, typeName);
  }
  if (addressing.includes('name')) {
    spec.byName = (name: string) => createElemSpec(`${baseUri}/${encodeURIComponent(name)}`, jxaColl.byName(name), schema, addressing, typeName);
  }
  if (addressing.includes('id')) {
    spec.byId = (id: any) => createElemSpec(`${baseUri}/${id}`, jxaColl.byId(id), schema, addressing, typeName);
  }

  // Query methods
  spec.whose = (filter: WhoseFilter<any>) => {
    const filterUri = `${uri}?${encodeFilter(filter)}`;
    const jxaFilter: any = {};
    for (const [key, predicate] of Object.entries(filter)) {
      const jxaName = getJxaName(schema[key] as Descriptor, key);
      const pred = predicate as any;
      if ('equals' in pred) jxaFilter[jxaName] = pred.equals;
      else if ('contains' in pred) jxaFilter[jxaName] = { _contains: pred.contains };
      else if ('startsWith' in pred) jxaFilter[jxaName] = { _beginsWith: pred.startsWith };
      else if ('greaterThan' in pred) jxaFilter[jxaName] = { _greaterThan: pred.greaterThan };
      else if ('lessThan' in pred) jxaFilter[jxaName] = { _lessThan: pred.lessThan };
    }
    try {
      const filtered = jxaColl.whose(jxaFilter);
      void filtered.length;
      return createCollSpec(filterUri, filtered, schema, addressing, typeName, makeOp, takeOp, sortSpec, undefined, pagination, expand);
    } catch {
      return createCollSpec(filterUri, jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, filter, pagination, expand);
    }
  };

  spec.sortBy = (sort: SortSpec<any>) => {
    const sep = uri.includes('?') ? '&' : '?';
    return createCollSpec(
      `${uri}${sep}sort=${String(sort.by)}.${sort.direction || 'asc'}`,
      jxaColl, schema, addressing, typeName, makeOp, takeOp, sort, jsFilter, pagination, expand
    );
  };

  spec.paginate = (page: PaginationSpec) => {
    const parts: string[] = [];
    if (page.limit !== undefined) parts.push(`limit=${page.limit}`);
    if (page.offset !== undefined) parts.push(`offset=${page.offset}`);
    const sep = uri.includes('?') ? '&' : '?';
    const newUri = parts.length ? `${uri}${sep}${parts.join('&')}` : uri;
    return createCollSpec(newUri, jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, jsFilter, page, expand);
  };

  spec.expand = (expandProps: ExpandSpec) => {
    const sep = uri.includes('?') ? '&' : '?';
    return createCollSpec(
      `${uri}${sep}expand=${expandProps.join(',')}`,
      jxaColl, schema, addressing, typeName, makeOp, takeOp, sortSpec, jsFilter, pagination, expandProps
    );
  };

  // CRUD operations based on make/take behaviours
  if (makeOp !== 'unavailable') {
    spec.create = (props: any) => {
      if (typeof makeOp === 'function') {
        return makeOp(jxaColl, props);
      }
      return tryResolve(() => {
        const jxaProps: any = {};
        for (const [key, value] of Object.entries(props)) {
          jxaProps[getJxaName(schema[key] as Descriptor, key)] = value;
        }
        const newItem = jxaColl.make({
          new: typeName.split('_').pop()?.toLowerCase() || typeName.toLowerCase(),
          withProperties: jxaProps
        });
        let newUri: string;
        try {
          const id = newItem.id();
          newUri = id ? `${baseUri}/${id}` : (() => { throw 0; })();
        } catch {
          try {
            const name = newItem.name();
            newUri = name ? `${baseUri}/${encodeURIComponent(name)}` : (() => { throw 0; })();
          } catch {
            newUri = `${baseUri}[${(typeof jxaColl === 'function' ? jxaColl() : jxaColl).length - 1}]`;
          }
        }
        return { uri: newUri };
      }, `${uri}:create`);
    };
  }

  if (takeOp !== 'unavailable') {
    spec.deleteItem = (itemUri: string) => {
      if (typeof takeOp === 'function') {
        const itemResult = specifierFromURI(itemUri);
        if (!itemResult.ok) return { ok: false, error: itemResult.error };
        return takeOp((itemResult.value as any)._jxa);
      }
      return tryResolve(() => {
        const itemSpec = specifierFromURI(itemUri);
        if (!itemSpec.ok) throw new Error(itemSpec.error);
        if ((itemSpec.value as any)._jxa) {
          (itemSpec.value as any)._jxa.delete();
        } else {
          throw new Error(`Cannot delete: ${itemUri}`);
        }
        return { deleted: true as const };
      }, `${itemUri}:delete`);
    };
  }

  return spec;
}

// ============================================================================
// Filter Encoding (for URI construction)
// ============================================================================

function encodeFilter(filter: WhoseFilter<any>): string {
  const parts: string[] = [];
  for (const [key, predicate] of Object.entries(filter)) {
    const pred = predicate as any;
    if ('equals' in pred) parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
    else if ('contains' in pred) parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
    else if ('startsWith' in pred) parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
    else if ('greaterThan' in pred) parts.push(`${key}.gt=${pred.greaterThan}`);
    else if ('lessThan' in pred) parts.push(`${key}.lt=${pred.lessThan}`);
  }
  return parts.join('&');
}
