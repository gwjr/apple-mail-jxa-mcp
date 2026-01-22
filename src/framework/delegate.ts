// src/framework/delegate.ts - Delegate Interface
//
// The abstraction layer between schema and backing store (JXA/Mock).

// ─────────────────────────────────────────────────────────────────────────────
// Root Marker (for parent navigation)
// ─────────────────────────────────────────────────────────────────────────────

// Explicit unique symbol type - used directly in type literal (no typeof needed)
const RootBrand: unique symbol = Symbol('RootBrand');
type RootMarker = { readonly [RootBrand]: true };
const ROOT: RootMarker = { [RootBrand]: true } as RootMarker;

function isRoot(d: Delegate | RootMarker): d is RootMarker {
  return RootBrand in d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Segment Type
// ─────────────────────────────────────────────────────────────────────────────

type PathSegment =
  | { kind: 'root'; scheme: string }
  | { kind: 'prop'; name: string }
  | { kind: 'index'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'id'; value: string | number };

// ─────────────────────────────────────────────────────────────────────────────
// Result Type
// ─────────────────────────────────────────────────────────────────────────────

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Query State Types
// ─────────────────────────────────────────────────────────────────────────────

// Forward declare - full definitions in filter-query.ts
type WhoseFilter = Record<string, Predicate>;
type SortDirection = 'asc' | 'desc';
type SortSpec<T> = { by: keyof T; direction?: SortDirection };
type PaginationSpec = { limit?: number; offset?: number };

type QueryState = {
  filter?: WhoseFilter;
  sort?: SortSpec<any>;
  pagination?: PaginationSpec;
  expand?: string[];
};

// Predicate type (forward declare - full definition in filter-query.ts)
interface Predicate {
  operator: FilterOperator<any>;
  value: any;
}

interface FilterOperator<T> {
  readonly name: string;
  parseUri(s: string): T;
  toJxa(v: T): any;
  test(itemVal: any, predVal: T): boolean;
  toUri(v: T): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegate Interface
// ─────────────────────────────────────────────────────────────────────────────

interface Delegate {
  _jxa(): any;
  prop(key: string): Delegate;
  propWithAlias(jxaName: string, uriName: string): Delegate;
  byIndex(n: number): Delegate;
  byName(name: string): Delegate;
  byId(id: string | number): Delegate;
  uri(): URL;
  set(value: any): void;
  namespace(name: string): Delegate;

  // Parent navigation - returns RootMarker at top
  parent(): Delegate | RootMarker;

  // Mutation operations - return URL
  moveTo(destination: Delegate): Result<URL>;
  delete(): Result<URL>;
  create(properties: Record<string, any>): Result<URL>;

  withFilter(filter: WhoseFilter): Delegate;
  withSort(sort: SortSpec<any>): Delegate;
  withPagination(pagination: PaginationSpec): Delegate;
  withExpand(fields: string[]): Delegate;
  queryState(): QueryState;

  // Create a delegate from arbitrary JXA ref with explicit path
  // Used for computed navigations that can't be expressed as delegate operations
  fromJxa?(jxaRef: any, path: PathSegment[]): Delegate;
}
