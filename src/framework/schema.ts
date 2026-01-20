// ============================================================================
// Schema Definition DSL - Simplified Syntax
// ============================================================================

// Type markers - property name defaults to JXA name
const t = {
  string: { _t: 'string' } as const,
  number: { _t: 'number' } as const,
  boolean: { _t: 'boolean' } as const,
  date: { _t: 'date' } as const,
  array: <T>(elem: T) => ({ _t: 'array' as const, _elem: elem }),
};

// Addressing markers (compile-time safe)
const by = {
  name: { _by: 'name' } as const,
  index: { _by: 'index' } as const,
  id: { _by: 'id' } as const,
};

type AddressingMarker = typeof by[keyof typeof by];
type AddressingMode = 'name' | 'index' | 'id';

// Modifiers
function lazy<T>(type: T): T & { _lazy: true } {
  return { ...type, _lazy: true as const } as any;
}

function rw<T>(type: T): T & { _rw: true } {
  return { ...type, _rw: true as const } as any;
}

function jxa<T, N extends string>(type: T, name: N): T & { _jxaName: N } {
  return { ...type, _jxaName: name } as any;
}

// Collection definition
type CollectionOpts = { create?: boolean; delete?: boolean };

function collection<S, const A extends readonly AddressingMarker[]>(
  schema: S,
  addressing: A,
  opts?: CollectionOpts
): { _coll: true; _schema: S; _addressing: A; _opts?: CollectionOpts } {
  return { _coll: true, _schema: schema, _addressing: addressing, _opts: opts };
}

// Computed property
function computed<T>(fn: (jxa: any) => T): { _computed: true; _fn: (jxa: any) => T } {
  return { _computed: true, _fn: fn };
}

// Standard mailbox marker
function standardMailbox<N extends string>(jxaName: N): { _stdMailbox: true; _jxaName: N } {
  return { _stdMailbox: true, _jxaName: jxaName };
}

// Extract addressing modes from markers
function getAddressingModes(markers: readonly AddressingMarker[]): AddressingMode[] {
  return markers.map(m => m._by);
}
