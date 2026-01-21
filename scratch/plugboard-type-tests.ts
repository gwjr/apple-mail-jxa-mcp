// Type-level tests for plugboard model
// Run with: npx tsc --noEmit scratch/plugboard-type-tests.ts

// ─────────────────────────────────────────────────────────────────────────────
// Inline the types we need (or import from plugboard.ts when it's a module)
// ─────────────────────────────────────────────────────────────────────────────

type PrimitiveType = 'string' | 'number' | 'boolean';

type ScalarDescriptor<T extends PrimitiveType, CanSet extends boolean = false> = {
  kind: 'scalar';
  type: T;
  settable: CanSet;
};

type PrimitiveTypeMap = {
  string: string;
  number: number;
  boolean: boolean;
};

type ScalarAccessor<T, CanSet extends boolean> =
  CanSet extends true
    ? { resolve(): T; set(value: T): void }
    : { resolve(): T };

type AccessorFor<D> =
  D extends ScalarDescriptor<infer T, infer CanSet>
    ? ScalarAccessor<PrimitiveTypeMap[T], CanSet>
    : never;

type Schema = Record<string, ScalarDescriptor<PrimitiveType, boolean>>;

type ResFor<S extends Schema> = {
  [K in keyof S]: AccessorFor<S[K]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Type tests
// ─────────────────────────────────────────────────────────────────────────────

// Setup: define test schemas
type ReadOnlyNumber = ScalarDescriptor<'number', false>;
type ReadWriteString = ScalarDescriptor<'string', true>;

type TestSchema = {
  id: ReadOnlyNumber;
  name: ReadWriteString;
};

declare const testRes: ResFor<TestSchema>;

// ✓ Read-only accessor has resolve()
const idValue: number = testRes.id.resolve();

// ✓ Read-write accessor has resolve()
const nameValue: string = testRes.name.resolve();

// ✓ Read-write accessor has set()
testRes.name.set('new name');

// ✗ Read-only accessor should NOT have set()
// @ts-expect-error - set() should not exist on read-only accessor
testRes.id.set(123);

// ─────────────────────────────────────────────────────────────────────────────
// Verify accessor types directly
// ─────────────────────────────────────────────────────────────────────────────

type IdAccessor = AccessorFor<ReadOnlyNumber>;
type NameAccessor = AccessorFor<ReadWriteString>;

// IdAccessor should be exactly { resolve(): number }
type AssertIdAccessor = IdAccessor extends { resolve(): number; set: never }
  ? never  // set should not be a property at all
  : IdAccessor extends { resolve(): number }
    ? 'set' extends keyof IdAccessor ? never : true
    : never;

const _assertIdAccessor: AssertIdAccessor = true;

// NameAccessor should be { resolve(): string; set(value: string): void }
type AssertNameAccessor = NameAccessor extends { resolve(): string; set(value: string): void }
  ? true
  : never;

const _assertNameAccessor: AssertNameAccessor = true;
