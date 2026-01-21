// scratch/mock-backing.ts - Mock Delegate implementation
//
// This file is only included in Node builds (for testing)
// Contains the MockDelegate class that works against in-memory data

// Import types from core (when compiled together, these are in the same scope)
// The core exports: Delegate, PathSegment, buildURI, buildQueryString, QueryState, WhoseFilter, SortSpec, PaginationSpec

// ─────────────────────────────────────────────────────────────────────────────
// Mock Delegate implementation
// ─────────────────────────────────────────────────────────────────────────────

class MockDelegate implements Delegate {
  constructor(
    private _data: any,           // Current node in mock data
    private _path: PathSegment[],
    private _query: QueryState = {}
  ) {}

  _jxa(): any {
    // Apply query state to data if it's an array
    if (Array.isArray(this._data)) {
      return applyQueryState(this._data, this._query);
    }
    return this._data;
  }

  prop(key: string): MockDelegate {
    const newPath = [...this._path, { kind: 'prop' as const, name: key }];
    const newData = this._data ? this._data[key] : undefined;
    return new MockDelegate(newData, newPath);
  }

  byIndex(n: number): MockDelegate {
    const newPath = [...this._path, { kind: 'index' as const, value: n }];
    const newData = Array.isArray(this._data) ? this._data[n] : undefined;
    return new MockDelegate(newData, newPath);
  }

  byName(name: string): MockDelegate {
    const newPath = [...this._path, { kind: 'name' as const, value: name }];
    let item: any;
    if (Array.isArray(this._data)) {
      item = this._data.find((x: any) => x.name === name);
    }
    return new MockDelegate(item, newPath);
  }

  byId(id: string | number): MockDelegate {
    const newPath = [...this._path, { kind: 'id' as const, value: id }];
    let item: any;
    if (Array.isArray(this._data)) {
      item = this._data.find((x: any) => x.id === id);
    }
    return new MockDelegate(item, newPath);
  }

  uri(): string {
    const base = buildURI(this._path);
    const queryStr = buildQueryString(this._query);
    return queryStr ? `${base}?${queryStr}` : base;
  }

  set(value: any): void {
    // For mock, we'd need parent reference to actually set
    // For testing purposes, this is a no-op or could throw
    throw new Error('MockDelegate.set() not implemented');
  }

  withFilter(filter: WhoseFilter): MockDelegate {
    const mergedFilter = { ...this._query.filter, ...filter };
    const newQuery = { ...this._query, filter: mergedFilter };
    return new MockDelegate(this._data, this._path, newQuery);
  }

  withSort(sort: SortSpec<any>): MockDelegate {
    const newQuery = { ...this._query, sort };
    return new MockDelegate(this._data, this._path, newQuery);
  }

  withPagination(pagination: PaginationSpec): MockDelegate {
    const newQuery = { ...this._query, pagination };
    return new MockDelegate(this._data, this._path, newQuery);
  }

  withExpand(fields: string[]): MockDelegate {
    const existing = this._query.expand || [];
    const merged = [...new Set([...existing, ...fields])];
    const newQuery = { ...this._query, expand: merged };
    return new MockDelegate(this._data, this._path, newQuery);
  }

  queryState(): QueryState {
    return this._query;
  }
}

// Create a mock delegate from in-memory data
function createMockDelegate(data: any, scheme: string = 'mail'): MockDelegate {
  return new MockDelegate(data, [{ kind: 'root', scheme }]);
}
