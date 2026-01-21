/// <reference path="specifier.ts" />

// ============================================================================
// Schema Definition DSL - Discriminated Union Model
// ============================================================================

type PrimitiveType = typeof String | typeof Number | typeof Boolean | typeof Date;

type Schema = Record<string, Descriptor>;

// Operations: default JXA, unavailable, or custom handler
type OperationBehaviour =
  | 'default'
  | 'unavailable'
  | ((jxa: any, ...args: any[]) => Result<any>);

// ============================================================================
// Descriptors - Discriminated by `dimension`
// ============================================================================

type BaseDescriptor = {
  jxaName?: string;
  lazy: boolean;
  computed?: (jxa: any) => any;
};

type ScalarDescriptor = BaseDescriptor & {
  dimension: 'scalar';
  type: PrimitiveType | Schema;
  set: OperationBehaviour;
};

type CollectionDescriptor = BaseDescriptor & {
  dimension: AddressingMode[];
  type: Schema;
  make: OperationBehaviour;
  take: OperationBehaviour;
};

type Descriptor = ScalarDescriptor | CollectionDescriptor;

// ============================================================================
// DSL
// ============================================================================

const by = {
  name: 'name' as const,
  index: 'index' as const,
  id: 'id' as const,
};

const t = {
  string: { dimension: 'scalar', type: String, set: 'unavailable', lazy: false } as ScalarDescriptor,
  number: { dimension: 'scalar', type: Number, set: 'unavailable', lazy: false } as ScalarDescriptor,
  boolean: { dimension: 'scalar', type: Boolean, set: 'unavailable', lazy: false } as ScalarDescriptor,
  date: { dimension: 'scalar', type: Date, set: 'unavailable', lazy: false } as ScalarDescriptor,
};

function rw(desc: ScalarDescriptor): ScalarDescriptor {
  return { ...desc, set: 'default' };
}

function lazy<D extends Descriptor>(desc: D): D {
  return { ...desc, lazy: true };
}

function jxa<D extends Descriptor>(desc: D, name: string): D {
  return { ...desc, jxaName: name };
}

function computed<T>(fn: (jxa: any) => T): ScalarDescriptor {
  return { dimension: 'scalar', type: Object as any, set: 'unavailable', lazy: false, computed: fn };
}

function collection<S extends Schema, const A extends readonly AddressingMode[]>(
  schema: S,
  addressing: A,
  opts?: { make?: OperationBehaviour; take?: OperationBehaviour }
): CollectionDescriptor {
  return {
    dimension: [...addressing],
    type: schema,
    make: opts?.make ?? 'default',
    take: opts?.take ?? 'default',
    lazy: false,
  };
}

