// scratch/jxa-backing.ts - JXA Delegate implementation
//
// This file is only included in JXA builds (osascript -l JavaScript)
// Contains the JXADelegate class and JXA-specific utilities

// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec, RootMarker, ROOT

// ─────────────────────────────────────────────────────────────────────────────
// JXA Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────

class JXADelegate implements Delegate {
  constructor(
    private _jxaRef: any,
    private _path: PathSegment[],
    private _jxaParent?: any,       // Parent JXA object
    private _key?: string,           // Property key in parent
    private _parentDelegate?: JXADelegate,  // Parent delegate for navigation
    private _query: QueryState = {}
  ) {}

  _jxa(): any {
    // If we have a parent and key, call as property getter
    if (this._jxaParent && this._key) {
      return this._jxaParent[this._key]();
    }
    // Otherwise try to call directly (may be a specifier or function)
    if (typeof this._jxaRef === 'function') {
      return this._jxaRef();
    }
    return this._jxaRef;
  }

  prop(key: string): JXADelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    return new JXADelegate(this._jxaRef[key], newPath, this._jxaRef, key, this);
  }

  propWithAlias(jxaName: string, uriName: string): JXADelegate {
    // Navigate JXA using jxaName, but track uriName in path
    const newPath = [...this._path, { kind: 'prop' as const, name: uriName }];
    return new JXADelegate(this._jxaRef[jxaName], newPath, this._jxaRef, jxaName, this);
  }

  namespace(name: string): JXADelegate {
    // A namespace adds a URI segment but keeps the same JXA ref (no navigation)
    const newPath = [...this._path, { kind: 'prop' as const, name }];
    return new JXADelegate(this._jxaRef, newPath, this._jxaParent, this._key, this);  // Same ref!
  }

  byIndex(n: number): JXADelegate {
    const newPath = [...this._path, { kind: 'index' as const, value: n }];
    return new JXADelegate(this._jxaRef[n], newPath, this._jxaRef, undefined, this);
  }

  byName(name: string): JXADelegate {
    const newPath = [...this._path, { kind: 'name' as const, value: name }];
    return new JXADelegate(this._jxaRef.byName(name), newPath, this._jxaRef, undefined, this);
  }

  byId(id: string | number): JXADelegate {
    const newPath = [...this._path, { kind: 'id' as const, value: id }];
    return new JXADelegate(this._jxaRef.byId(id), newPath, this._jxaRef, undefined, this);
  }

  uri(): URL {
    const base = buildURI(this._path);
    const queryStr = buildQueryString(this._query);
    if (queryStr) {
      return new URL(`${base.href}?${queryStr}`);
    }
    return base;
  }

  set(value: any): void {
    if (this._jxaParent && this._key) {
      this._jxaParent[this._key] = value;
    } else {
      throw new Error('Cannot set on root object');
    }
  }

  // Parent navigation
  parent(): Delegate | RootMarker {
    if (this._parentDelegate) {
      return this._parentDelegate;
    }
    return ROOT;
  }

  // Mutation: move this item to a destination collection
  // Generic JXA implementation - domain handlers may override
  moveTo(destination: Delegate): Result<URL> {
    try {
      const destJxa = (destination as JXADelegate)._jxaRef;
      // JXA move pattern: item.move({ to: destination })
      this._jxaRef.move({ to: destJxa });
      // Return the new URI (item is now in destination)
      const destUri = destination.uri();
      // Try to construct a URI based on item's id or name
      try {
        const id = this._jxaRef.id();
        return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(String(id))}`) };
      } catch {
        try {
          const name = this._jxaRef.name();
          return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(name)}`) };
        } catch {
          // Fall back to destination URI (can't determine specific item URI)
          return { ok: true, value: destUri };
        }
      }
    } catch (e: any) {
      return { ok: false, error: `JXA move failed: ${e.message || e}` };
    }
  }

  // Mutation: delete this item
  delete(): Result<URL> {
    try {
      const uri = this.uri();
      this._jxaRef.delete();
      return { ok: true, value: uri };
    } catch (e: any) {
      return { ok: false, error: `JXA delete failed: ${e.message || e}` };
    }
  }

  // Mutation: create a new item in this collection
  create(properties: Record<string, any>): Result<URL> {
    try {
      // JXA create pattern: Application.make({ new: 'type', withProperties: {...} })
      // For collections, we typically use collection.push() or make()
      // This generic implementation tries the push pattern
      const newItem = this._jxaRef.push(properties);
      // Return URI to new item
      const baseUri = this.uri();
      try {
        const id = newItem.id();
        return { ok: true, value: new URL(`${baseUri.href}/${encodeURIComponent(String(id))}`) };
      } catch {
        try {
          const name = newItem.name();
          return { ok: true, value: new URL(`${baseUri.href}/${encodeURIComponent(name)}`) };
        } catch {
          return { ok: true, value: baseUri };
        }
      }
    } catch (e: any) {
      return { ok: false, error: `JXA create failed: ${e.message || e}` };
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
      return new JXADelegate(filtered, this._path, undefined, undefined, this._parentDelegate, newQuery);
    } catch {
      // JXA whose() failed - keep original ref, apply filter in JS at resolve time
      return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
    }
  }

  withSort(sort: SortSpec<any>): JXADelegate {
    const newQuery = { ...this._query, sort };
    return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
  }

  withPagination(pagination: PaginationSpec): JXADelegate {
    const newQuery = { ...this._query, pagination };
    return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
  }

  withExpand(fields: string[]): JXADelegate {
    // Merge with existing expand fields
    const existing = this._query.expand || [];
    const merged = [...new Set([...existing, ...fields])];
    const newQuery = { ...this._query, expand: merged };
    return new JXADelegate(this._jxaRef, this._path, this._jxaParent, this._key, this._parentDelegate, newQuery);
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
  return new JXADelegate(app, [{ kind: 'root', scheme }], undefined, undefined, undefined);
}
