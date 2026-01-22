// ═══════════════════════════════════════════════════════════════════════════
// TYPE MODEL
// ═══════════════════════════════════════════════════════════════════════════
//
// This file defines the core type relationships for the framework.
// Read from top to bottom to understand the type system.
//
// The types here are real TypeScript - the compiler validates them.
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE FUNDAMENTAL DIVISION: SCHEMATIC vs GENERATED
// ─────────────────────────────────────────────────────────────────────────────

// There exist two worlds of types:
//
// SCHEMATIC types live in the schema DSL. They describe structure.
// GENERATED types live at runtime. They are the API surface.
//
// The framework's job is to transform Schematic → Generated.
// It is a fundamental design principle that we do not directly define
// Generated types; we let them emerge from the effect of the schema
// and of the type system which constructs types from it.
// 
// We use brands to mark which world a type belongs to.
declare const SchematicBrand: unique symbol;
declare const GeneratedBrand: unique symbol;

type Schematic = { readonly [SchematicBrand]: true };
type Generated = { readonly [GeneratedBrand]: true };

// ─────────────────────────────────────────────────────────────────────────────
// 2. SCHEMATIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

// A Schematic type is GENERATABLE if it represents the scheme for a type
// usable at runtime. (Most are, but the concept is distinct.)

declare const GeneratableBrand: unique symbol;
type Generatable = Schematic & { readonly [GeneratableBrand]: true };

// A Schematic type is SPECIFIABLE if it is meaningful to hold a runtime
// reference to it. [Implementation: maps to a JXA object specifier]

declare const SpecifiableBrand: unique symbol;
type Specifiable = Schematic & { readonly [SpecifiableBrand]: true };

// ─────────────────────────────────────────────────────────────────────────────
// 3. CHARACTERISTICS
// ─────────────────────────────────────────────────────────────────────────────

// Characteristics are applied to Schematic types.
// Their effect is on the Generated types they produce.
//
// This keeps the DSL pure: we say "this property is Mutable" at schema level,
// meaning "the generated property will support mutation".

// Example characteristics (as type brands):
declare const EagerBrand: unique symbol;
declare const MutableBrand: unique symbol;
declare const ListableBrand: unique symbol;

type Eager<S extends Schematic> = S & { readonly [EagerBrand]: true };
type Mutable<S extends Schematic> = S & { readonly [MutableBrand]: true };
type Listable<S extends Schematic> = S & { readonly [ListableBrand]: true };

// Characteristic functions (implementation would add to proto):
// eager(schema)    → property resolves with parent
// mutable(schema)  → property can be set
// listable(schema) → collection supports listing

// ─────────────────────────────────────────────────────────────────────────────
// 4. SPECIFYING AND SPECIFIER
// ─────────────────────────────────────────────────────────────────────────────

// SPECIFYING<T> is the Schematic form: "a reference to T" in the DSL.
// SPECIFIER<T> is the Generated form: the actual runtime reference.
//
// Specifying<T> (schema) → Specifier<T> (runtime)

// At runtime, a Specifier is serialised as a URL.

declare const SpecifyingBrand: unique symbol;
declare const SpecifierBrand: unique symbol;

type Specifying<T extends Specifiable> = Schematic & {
  readonly [SpecifyingBrand]: T;
};

type Specifier<T> = Generated & {
  readonly [SpecifierBrand]: T;
  uri(): URL;
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

// For a Specifiable type T, Specifier<T> has a resolve() method.
// What resolve() returns depends on T's characteristics.

// For scalar T:
//   Specifier<T>.resolve() → T

// For object T:
//   Specifier<T>.resolve() → T
//   where T's properties are either:
//     - values (if property is Eager)
//     - Specifier<Q> (if property is lazy - the default)

// EAGER: property resolves when parent resolves
// LAZY (default): property remains a Specifier in the resolved parent

interface Resolvable<T> {
  resolve(): T;
}

// A Specifier to a Specifiable type is Resolvable
type ResolvableSpecifier<T extends Specifiable> = Specifier<T> & Resolvable<T>;

// ─────────────────────────────────────────────────────────────────────────────
// 6. COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────

// A Collection is a Schematic type parameterised over:
//   - Item: the type of its contents
//   - AccessModes: which addressing it supports (index, id, name)
//   - ResolutionForm: what resolve() returns (if anything)

declare const CollectionBrand: unique symbol;

type Collection<Item extends Specifiable> = Schematic & {
  readonly [CollectionBrand]: Item;
};

// ResolutionForm defines what a collection's resolve() returns.
// Deliberately NOT Specifier<G>[] - this discourages the anti-pattern
// of calling resolve() to get specifiers you then have to resolve() again.

type ResolutionForm<T> =
  | URL      // single item URI
  | URL[]    // array of item URIs
  | T[];     // array of resolved items (eager collection only)

// Access modes (added via characteristics):
interface Indexable<T> { byIndex(n: number): Specifier<T>; }
interface NameAddressable<T> { byName(name: string): Specifier<T>; }
interface IdAddressable<T> { byId(id: string | number): Specifier<T>; }


// ─────────────────────────────────────────────────────────────────────────────
// 7. SUMMARY DIAGRAM
// ─────────────────────────────────────────────────────────────────────────────

/*
  SCHEMATIC (DSL)                      GENERATED (Runtime/API)
  ═══════════════                      ═══════════════════════

  Schema<T>          ─────────────►   T
  (describes T)        generate       (runtime value)

  Specifying<T>      ─────────────►   Specifier<T>
  (schema ref)         generate       (runtime ref, serialised as URL)
                                           │
                                           │ .resolve()
                                           ▼
                                      T (the resolved value)

  Collection<Item>   ─────────────►   Specifier<Collection<Item>>
  (schema)             generate       (runtime)
                                           │
                                           │ .byIndex(n) / .byId(id) / .byName(s)
                                           ▼
                                      Specifier<Item>

  Characteristics (Eager, Mutable, etc.)
  are applied at Schema level, affect Generated behavior.

  MCP Client sees:
  ────────────────
  - URLs (Specifiers serialised)
  - JSON (resolved values serialised)
*/

// ─────────────────────────────────────────────────────────────────────────────
// 8. EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export type {
  // World markers
  Schematic,
  Generated,

  // Schematic capabilities
  Generatable,
  Specifiable,

  // Characteristics
  Eager,
  Mutable,

  // Core types
  Specifying,
  Specifier,
  Collection,

  // Interfaces
  Resolvable,
  Indexable,
  NameAddressable,
  IdAddressable,

  // Utility
  ResolutionForm,
};
