// ============================================================================
// Core Types - Foundation (no dependencies)
// ============================================================================

// Result type for fallible operations
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// Addressing modes for collections
type AddressingMode = 'name' | 'index' | 'id';

// ============================================================================
// Specifier Types
// ============================================================================

type Specifier<T> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T>;
  fix(): Result<Specifier<T>>;
} & { readonly [K in keyof T]: Specifier<T[K]> };

type MutableSpecifier<T> = Specifier<T> & { set(value: T): Result<void> };

// Individual addressing capabilities
type NameAddressable<T> = { byName(name: string): Specifier<T> };
type IdAddressable<T> = { byId(id: string | number): Specifier<T> };
type IndexAddressable<T> = { byIndex(i: number): Specifier<T> };

// Map addressing mode to capability
type AddressingCapability<T, M extends AddressingMode> =
  M extends 'name' ? NameAddressable<T> :
  M extends 'id' ? IdAddressable<T> :
  M extends 'index' ? IndexAddressable<T> :
  {};

// Union of all addressing capabilities for a tuple of modes
type AddressingCapabilities<T, A extends readonly AddressingMode[]> =
  A[number] extends infer M
    ? M extends AddressingMode
      ? AddressingCapability<T, M>
      : {}
    : {};

// ============================================================================
// Query Types
// ============================================================================

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

// ============================================================================
// Collection Specifier
// ============================================================================

// Base collection specifier (without addressing)
type BaseCollectionSpecifier<T, A extends readonly AddressingMode[]> = {
  readonly _isSpecifier: true;
  readonly uri: string;
  resolve(): Result<T[]>;
  fix(): Result<CollectionSpecifier<T, A>>;
  whose(filter: WhoseFilter<T>): CollectionSpecifier<T, A>;
  sortBy(spec: SortSpec<T>): CollectionSpecifier<T, A>;
  paginate(spec: PaginationSpec): CollectionSpecifier<T, A>;
  expand(props: ExpandSpec): CollectionSpecifier<T, A>;
  create(props: Partial<T>): Result<{ uri: string }>;
  deleteItem(uri: string): Result<{ deleted: true }>;
};

// Collection specifier with type-safe addressing based on modes
type CollectionSpecifier<T, A extends readonly AddressingMode[] = AddressingMode[]> =
  BaseCollectionSpecifier<T, A> & AddressingCapabilities<T, A>;

// ============================================================================
// Element Specifier with Operations
// ============================================================================

type ElementSpecifier<T> = Specifier<T> & {
  move(toUri: string): Result<{ uri: string }>;
  copy(toUri: string): Result<{ uri: string }>;
  delete(): Result<{ deleted: true }>;
};
