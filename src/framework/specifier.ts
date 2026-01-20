/// <reference path="schema.ts" />

// ============================================================================
// Specifier Types
// ============================================================================

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type Specifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T>;
  fix(): Result<Specifier<T>>;
} & { readonly [K in keyof T]: Specifier<T[K]> };

type MutableSpecifier<T> = Specifier<T> & { set(value: T): Result<void> };

type NameAddressable<T> = { byName(name: string): Specifier<T> };
type IdAddressable<T> = { byId(id: string | number): Specifier<T> };
type IndexAddressable<T> = { byIndex(i: number): Specifier<T> };

type Predicate<T> =
  | { equals: T }
  | { contains: T extends string ? string : never }
  | { startsWith: T extends string ? string : never }
  | { greaterThan: T extends number ? number : never }
  | { lessThan: T extends number ? number : never };

type WhoseFilter<T> = { [K in keyof T]?: Predicate<T[K]> };
type SortDirection = 'asc' | 'desc';
type SortSpec<T> = { by: keyof T; direction?: SortDirection };
type PaginationSpec = { limit?: number; offset?: number };
type ExpandSpec = string[];

type CollectionSpecifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T[]>;
  fix(): Result<CollectionSpecifier<T>>;
  whose(filter: WhoseFilter<T>): CollectionSpecifier<T>;
  sortBy(spec: SortSpec<T>): CollectionSpecifier<T>;
  paginate(spec: PaginationSpec): CollectionSpecifier<T>;
  expand(props: ExpandSpec): CollectionSpecifier<T>;
  byIndex(i: number): Specifier<T>;
  byName?(name: string): Specifier<T>;
  byId?(id: string | number): Specifier<T>;
};

type MutableCollectionSpecifier<T> = CollectionSpecifier<T> & {
  create(props: Partial<T>): Result<Specifier<T>>;
  delete(uri: string): Result<void>;
};
