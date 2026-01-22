// scratch/mock-backing.ts - Mock Delegate implementation
//
// This file is only included in Node builds (for testing)
// Contains the MockDelegate class that works against in-memory data

// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec, RootMarker, ROOT

// ─────────────────────────────────────────────────────────────────────────────
// Mock Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────

// ID counter for auto-generating IDs
let mockIdCounter = 1000;

class MockDelegate implements Delegate {
  constructor(
    private _data: any,           // Current node in mock data
    private _path: PathSegment[],
    private _root: any,           // Root data for navigation
    private _parentDelegate: MockDelegate | null,  // Parent delegate
    private _parentArray: any[] | null,  // Parent array (if this is an item in an array)
    private _indexInParent: number | null,  // Index in parent array
    private _query: QueryState = {}
  ) {}

  _jxa(): any {
    // Return raw data - query state is applied by the proto layer (withQuery.resolve())
    return this._data;
  }

  prop(key: string): MockDelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    const newData = this._data ? this._data[key] : undefined;
    return new MockDelegate(newData, newPath, this._root, this, null, null);
  }

  propWithAlias(jxaName: string, uriName: string): MockDelegate {
    // Navigate data using JXA name, but track URI name in path
    const newPath = [...this._path, { kind: 'prop' as const, name: uriName }];
    const newData = this._data ? this._data[jxaName] : undefined;
    return new MockDelegate(newData, newPath, this._root, this, null, null);
  }

  namespace(name: string): MockDelegate {
    // A namespace adds a URI segment but keeps the same data (no JXA navigation)
    const newPath = [...this._path, { kind: 'prop' as const, name }];
    return new MockDelegate(this._data, newPath, this._root, this, null, null);  // Same data!
  }

  byIndex(n: number): MockDelegate {
    const newPath = [...this._path, { kind: 'index' as const, value: n }];
    const newData = Array.isArray(this._data) ? this._data[n] : undefined;
    return new MockDelegate(newData, newPath, this._root, this, this._data, n);
  }

  byName(name: string): MockDelegate {
    const newPath = [...this._path, { kind: 'name' as const, value: name }];
    let item: any;
    let idx: number | null = null;
    if (Array.isArray(this._data)) {
      idx = this._data.findIndex((x: any) => x.name === name);
      item = idx >= 0 ? this._data[idx] : undefined;
      if (idx < 0) idx = null;
    }
    return new MockDelegate(item, newPath, this._root, this, this._data, idx);
  }

  byId(id: string | number): MockDelegate {
    const newPath = [...this._path, { kind: 'id' as const, value: id }];
    let item: any;
    let idx: number | null = null;
    if (Array.isArray(this._data)) {
      idx = this._data.findIndex((x: any) => x.id === id);
      item = idx >= 0 ? this._data[idx] : undefined;
      if (idx < 0) idx = null;
    }
    return new MockDelegate(item, newPath, this._root, this, this._data, idx);
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
    // For mock, we need parent reference to actually set
    if (this._parentDelegate && this._parentDelegate._data && this._path.length > 0) {
      const lastSeg = this._path[this._path.length - 1];
      if (lastSeg.kind === 'prop') {
        this._parentDelegate._data[lastSeg.name] = value;
        this._data = value;
        return;
      }
    }
    throw new Error('MockDelegate.set() cannot set this path');
  }

  // Parent navigation
  parent(): Delegate | RootMarker {
    if (this._parentDelegate) {
      return this._parentDelegate;
    }
    return ROOT;
  }

  // Mutation: move this item to a destination collection
  moveTo(destination: Delegate): Result<URL> {
    // Remove from source
    if (this._parentArray !== null && this._indexInParent !== null) {
      this._parentArray.splice(this._indexInParent, 1);
    } else {
      return { ok: false, error: 'Cannot remove item from source: no parent array' };
    }

    // Add to destination
    const destData = (destination as MockDelegate)._data;
    if (!Array.isArray(destData)) {
      return { ok: false, error: 'Destination is not a collection' };
    }
    destData.push(this._data);

    // Return new URI
    const destUri = destination.uri();
    const id = this._data?.id ?? this._data?.name;
    if (id !== undefined) {
      return { ok: true, value: new URL(`${destUri.href}/${encodeURIComponent(String(id))}`) };
    }
    // Fall back to index
    const newIndex = destData.length - 1;
    return { ok: true, value: new URL(`${destUri.href}[${newIndex}]`) };
  }

  // Mutation: delete this item
  delete(): Result<URL> {
    if (this._parentArray !== null && this._indexInParent !== null) {
      this._parentArray.splice(this._indexInParent, 1);
      // Return the URI we were at (item no longer exists)
      return { ok: true, value: this.uri() };
    }
    return { ok: false, error: 'Cannot delete: item not in a collection' };
  }

  // Mutation: create a new item in this collection
  create(properties: Record<string, any>): Result<URL> {
    if (!Array.isArray(this._data)) {
      return { ok: false, error: 'Cannot create: this is not a collection' };
    }

    // Assign an id if not provided
    const newItem = { ...properties };
    if (!('id' in newItem)) {
      newItem.id = mockIdCounter++;
    }

    this._data.push(newItem);

    // Return URI to new item
    const id = newItem.id ?? newItem.name;
    if (id !== undefined) {
      return { ok: true, value: new URL(`${this.uri().href}/${encodeURIComponent(String(id))}`) };
    }
    const newIndex = this._data.length - 1;
    return { ok: true, value: new URL(`${this.uri().href}[${newIndex}]`) };
  }

  withFilter(filter: WhoseFilter): MockDelegate {
    const mergedFilter = { ...this._query.filter, ...filter };
    const newQuery = { ...this._query, filter: mergedFilter };
    return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
  }

  withSort(sort: SortSpec<any>): MockDelegate {
    const newQuery = { ...this._query, sort };
    return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
  }

  withPagination(pagination: PaginationSpec): MockDelegate {
    const newQuery = { ...this._query, pagination };
    return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
  }

  withExpand(fields: string[]): MockDelegate {
    const existing = this._query.expand || [];
    const merged = [...new Set([...existing, ...fields])];
    const newQuery = { ...this._query, expand: merged };
    return new MockDelegate(this._data, this._path, this._root, this._parentDelegate, this._parentArray, this._indexInParent, newQuery);
  }

  queryState(): QueryState {
    return this._query;
  }

  // Create a delegate from arbitrary data with explicit path
  fromJxa(data: any, path: PathSegment[]): MockDelegate {
    return new MockDelegate(data, path, this._root, this, null, null);
  }
}

// Create a mock delegate from in-memory data
function createMockDelegate(data: any, scheme: string = 'mail'): MockDelegate {
  return new MockDelegate(data, [{ kind: 'root', scheme }], data, null, null, null);
}
