// scratch/jxa-backing.ts - JXA Delegate implementation
//
// This file is only included in JXA builds (osascript -l JavaScript)
// Contains the JXADelegate class and JXA-specific utilities

// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec

// ─────────────────────────────────────────────────────────────────────────────
// JXA Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────

class JXADelegate implements Delegate {
  constructor(
    private _jxaRef: any,
    private _path: PathSegment[],
    private _parent?: any,
    private _key?: string,
    private _query: QueryState = {}
  ) {}

  _jxa(): any {
    // If we have a parent and key, call as property getter
    if (this._parent && this._key) {
      return this._parent[this._key]();
    }
    // Otherwise try to call directly (may be a specifier or function)
    if (typeof this._jxaRef === 'function') {
      return this._jxaRef();
    }
    return this._jxaRef;
  }

  prop(key: string): JXADelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    return new JXADelegate(this._jxaRef[key], newPath, this._jxaRef, key);
  }

  propWithAlias(jxaName: string, uriName: string): JXADelegate {
    // Navigate JXA using jxaName, but track uriName in path
    const newPath = [...this._path, { kind: 'prop' as const, name: uriName }];
    return new JXADelegate(this._jxaRef[jxaName], newPath, this._jxaRef, jxaName);
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
    // Try JXA whose() first
    try {
      const jxaFilter = toJxaFilter(filter);
      const filtered = this._jxaRef.whose(jxaFilter);
      return new JXADelegate(filtered, this._path, undefined, undefined, newQuery);
    } catch {
      // JXA whose() failed - keep original ref, apply filter in JS at resolve time
      return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
    }
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
    // Merge with existing expand fields
    const existing = this._query.expand || [];
    const merged = [...new Set([...existing, ...fields])];
    const newQuery = { ...this._query, expand: merged };
    return new JXADelegate(this._jxaRef, this._path, this._parent, this._key, newQuery);
  }

  queryState(): QueryState {
    return this._query;
  }
}

// Convert WhoseFilter to JXA filter format
function toJxaFilter(filter: WhoseFilter): Record<string, any> {
  const jxaFilter: Record<string, any> = {};
  for (const [field, pred] of Object.entries(filter)) {
    jxaFilter[field] = pred.operator.toJxa(pred.value);
  }
  return jxaFilter;
}

// Create a JXA delegate from an Application reference
function createJXADelegate(app: any, scheme: string = 'mail'): JXADelegate {
  return new JXADelegate(app, [{ kind: 'root', scheme }]);
}
