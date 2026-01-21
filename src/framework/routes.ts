/// <reference path="schema.ts" />

// ============================================================================
// Route Table Types
// ============================================================================

// Schema reference (handles recursive schemas)
type SchemaRef = { _ref: string };

// Value types for properties
type ValueType = 'string' | 'number' | 'boolean' | 'date' | 'array';

// Query operators valid for each type
const validOperators: Record<ValueType, string[]> = {
  string: ['equals', 'contains', 'startsWith'],
  number: ['equals', 'gt', 'lt'],
  boolean: ['equals'],
  date: ['equals', 'gt', 'lt'],
  array: ['equals'],
};

// Route entry types - discriminated by `kind`

type PropertyEntry = {
  kind: 'property';
  valueType: ValueType;
  jxaName?: string;
  lazy?: boolean;
  rw?: boolean;
};

type ComputedEntry = {
  kind: 'computed';
  computeFn: (jxa: any) => any;
  jxaName?: string;
};

type CollectionEntry = {
  kind: 'collection';
  addressing: AddressingMode[];
  elementSchema: SchemaRef;
  jxaName?: string;
  mutable?: { create?: boolean; delete?: boolean };
};

type NestedSchemaEntry = {
  kind: 'nested';
  targetSchema: SchemaRef;
  jxaName?: string;
  computed?: boolean;
};

type RootEntry = {
  kind: 'root';
};

type RouteEntry = PropertyEntry | ComputedEntry | CollectionEntry | NestedSchemaEntry | RootEntry;

// ============================================================================
// Factory Functions
// ============================================================================

const route = {
  property(valueType: ValueType, opts?: { jxaName?: string; lazy?: boolean; rw?: boolean }): PropertyEntry {
    return { kind: 'property', valueType, ...opts };
  },

  computed(fn: (jxa: any) => any, jxaName?: string): ComputedEntry {
    return { kind: 'computed', computeFn: fn, jxaName };
  },

  collection(elementSchema: SchemaRef, addressing: AddressingMode[], opts?: { jxaName?: string; mutable?: { create?: boolean; delete?: boolean } }): CollectionEntry {
    return { kind: 'collection', elementSchema, addressing, ...opts };
  },

  nested(targetSchema: SchemaRef, opts?: { jxaName?: string; computed?: boolean }): NestedSchemaEntry {
    return { kind: 'nested', targetSchema, ...opts };
  },

  root(): RootEntry {
    return { kind: 'root' };
  }
};

// Type guards
function isPropertyEntry(entry: RouteEntry): entry is PropertyEntry {
  return entry.kind === 'property';
}

function isComputedEntry(entry: RouteEntry): entry is ComputedEntry {
  return entry.kind === 'computed';
}

function isCollectionEntry(entry: RouteEntry): entry is CollectionEntry {
  return entry.kind === 'collection';
}

function isNestedEntry(entry: RouteEntry): entry is NestedSchemaEntry {
  return entry.kind === 'nested';
}

function isRootEntry(entry: RouteEntry): entry is RootEntry {
  return entry.kind === 'root';
}

// Route table structure
interface RouteNode {
  entry: RouteEntry;
  children: Record<string, RouteNode>;
}

interface RouteTable {
  scheme: string;
  root: RouteNode;
  schemaRegistry: Record<string, any>;
}

// Parsed URI result
interface ParsedSegment {
  name: string;
  addressing?: { type: 'index'; value: number } | { type: 'name'; value: string } | { type: 'id'; value: string };
}

interface ParsedQuery {
  filter: Record<string, any>;
  sort?: { by: string; direction: 'asc' | 'desc' };
  pagination?: { limit?: number; offset?: number };
  expand?: string[];
}

interface ParsedRoute {
  ok: true;
  type: string;
  segments: ParsedSegment[];
  depth: number;
  route: RouteNode;
  query?: ParsedQuery;
  queryValid: boolean;
  queryError?: string;
}

interface ParseError {
  ok: false;
  error: string;
  pathSoFar: string;
  failedSegment: string;
  availableOptions: string[];
}

type ParseResult = ParsedRoute | ParseError;

// ============================================================================
// Route Table Compiler
// ============================================================================

function compileRoutes(schema: any, scheme: string, namedSchemas?: Record<string, any>): RouteTable {
  const schemaRegistry: Record<string, any> = {};

  // Register named schemas provided by caller
  if (namedSchemas) {
    for (const [name, s] of Object.entries(namedSchemas)) {
      schemaRegistry[name] = s;
    }
  }

  // Register schemas as they're encountered
  function registerSchema(s: any, name: string): void {
    if (s && !schemaRegistry[name]) {
      schemaRegistry[name] = s;
    }
  }

  // Check if type is a primitive constructor
  function isPrimitiveType(type: any): boolean {
    return type === String || type === Number || type === Boolean || type === Date;
  }

  // Map primitive constructor to ValueType
  function primitiveToValueType(type: any): ValueType {
    if (type === String) return 'string';
    if (type === Number) return 'number';
    if (type === Boolean) return 'boolean';
    if (type === Date) return 'date';
    return 'string'; // fallback
  }

  // Compile a schema into a route node
  function compileSchema(s: any, name: string): RouteNode {
    registerSchema(s, name);

    const children: Record<string, RouteNode> = {};

    for (const [key, descriptor] of Object.entries(s)) {
      if (!descriptor) continue;
      const desc = descriptor as any;

      // Collection: dimension is an array of addressing modes
      if (Array.isArray(desc.dimension)) {
        const elementSchemaName = getSchemaName(desc.type, key);
        registerSchema(desc.type, elementSchemaName);

        children[key] = {
          entry: route.collection(
            { _ref: elementSchemaName },
            desc.dimension,
            {
              jxaName: desc.jxaName,
              mutable: {
                create: desc.make !== 'unavailable',
                delete: desc.take !== 'unavailable',
              }
            }
          ),
          children: {},
        };
        continue;
      }

      // Scalar: dimension === 'scalar'
      if (desc.dimension === 'scalar') {
        // Scalar with Schema type = navigable (virtual context)
        if (!isPrimitiveType(desc.type)) {
          const nestedSchemaName = getSchemaName(desc.type, key);
          registerSchema(desc.type, nestedSchemaName);

          if (desc.computed) {
            // Computed navigation - the JXA object is computed
            children[key] = {
              entry: route.virtualCtx({ _ref: nestedSchemaName }),
              children: {},
            };
          } else {
            // Direct JXA property navigation
            children[key] = {
              entry: route.virtualProp(desc.jxaName || key, { _ref: nestedSchemaName }),
              children: {},
            };
          }
          continue;
        }

        // Scalar with computed function = computed property
        if (desc.computed) {
          children[key] = {
            entry: route.computed(desc.computed, desc.jxaName),
            children: {},
          };
          continue;
        }

        // Scalar with primitive type = property
        children[key] = {
          entry: route.property(primitiveToValueType(desc.type), {
            jxaName: desc.jxaName,
            lazy: desc.lazy,
            rw: desc.set !== 'unavailable',
          }),
          children: {},
        };
        continue;
      }
    }

    return {
      entry: route.root(),
      children,
    };
  }

  function getSchemaName(schema: any, fallback: string): string {
    // Try to find a unique identifier for the schema
    // Use the schema object reference to check if already registered
    for (const [name, registered] of Object.entries(schemaRegistry)) {
      if (registered === schema) return name;
    }
    return fallback;
  }

  const root = compileSchema(schema, 'Root');

  return { scheme, root, schemaRegistry };
}

// ============================================================================
// Route Node Resolution (handles schema refs)
// ============================================================================

function getRouteChildren(node: RouteNode, table: RouteTable): Record<string, RouteNode> {
  const entry = node.entry;

  // For collections, get children from element schema
  if (isCollectionEntry(entry)) {
    const schemaRef = entry.elementSchema;
    if ('_ref' in schemaRef) {
      const schema = table.schemaRegistry[schemaRef._ref];
      if (schema) {
        return compileSchemaChildren(schema, table);
      }
    }
  }

  // For virtual entries, get children from target schema
  if (isVirtualEntry(entry)) {
    const schemaRef = entry.targetSchema;
    if ('_ref' in schemaRef) {
      const schema = table.schemaRegistry[schemaRef._ref];
      if (schema) {
        return compileSchemaChildren(schema, table);
      }
    }
  }

  return node.children;
}

function compileSchemaChildren(schema: any, table: RouteTable): Record<string, RouteNode> {
  const children: Record<string, RouteNode> = {};

  // Helper to check if type is primitive
  function isPrimitiveType(type: any): boolean {
    return type === String || type === Number || type === Boolean || type === Date;
  }

  function primitiveToValueType(type: any): ValueType {
    if (type === String) return 'string';
    if (type === Number) return 'number';
    if (type === Boolean) return 'boolean';
    if (type === Date) return 'date';
    return 'string';
  }

  for (const [key, descriptor] of Object.entries(schema)) {
    if (!descriptor) continue;
    const desc = descriptor as any;

    // Collection: dimension is an array
    if (Array.isArray(desc.dimension)) {
      const elementSchemaName = findSchemaName(desc.type, table) || key;
      children[key] = {
        entry: route.collection(
          { _ref: elementSchemaName },
          desc.dimension,
          {
            jxaName: desc.jxaName,
            mutable: {
              create: desc.make !== 'unavailable',
              delete: desc.take !== 'unavailable',
            }
          }
        ),
        children: {},
      };
      continue;
    }

    // Scalar
    if (desc.dimension === 'scalar') {
      // Scalar with Schema type = navigable
      if (!isPrimitiveType(desc.type)) {
        const nestedSchemaName = findSchemaName(desc.type, table) || key;

        if (desc.computed) {
          children[key] = {
            entry: route.virtualCtx({ _ref: nestedSchemaName }),
            children: {},
          };
        } else {
          children[key] = {
            entry: route.virtualProp(desc.jxaName || key, { _ref: nestedSchemaName }),
            children: {},
          };
        }
        continue;
      }

      // Computed property
      if (desc.computed) {
        children[key] = {
          entry: route.computed(desc.computed, desc.jxaName),
          children: {},
        };
        continue;
      }

      // Primitive property
      children[key] = {
        entry: route.property(primitiveToValueType(desc.type), {
          jxaName: desc.jxaName,
          lazy: desc.lazy,
          rw: desc.set !== 'unavailable',
        }),
        children: {},
      };
      continue;
    }
  }

  return children;
}

function findSchemaName(schema: any, table: RouteTable): string | undefined {
  for (const [name, registered] of Object.entries(table.schemaRegistry)) {
    if (registered === schema) return name;
  }
  return undefined;
}

// ============================================================================
// URI Parsing with Route Table
// ============================================================================

function parseURIWithRoutes(uri: string, routes: RouteTable): ParseResult {
  // Parse scheme
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    return {
      ok: false,
      error: `Invalid URI (no scheme): ${uri}`,
      pathSoFar: '',
      failedSegment: uri,
      availableOptions: [routes.scheme],
    };
  }

  const scheme = uri.slice(0, schemeEnd);
  if (scheme !== routes.scheme) {
    return {
      ok: false,
      error: `Unknown scheme: ${scheme}. Expected: ${routes.scheme}`,
      pathSoFar: '',
      failedSegment: scheme,
      availableOptions: [routes.scheme],
    };
  }

  let rest = uri.slice(schemeEnd + 3);

  // Split query string
  let queryString: string | undefined;
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) {
    queryString = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }

  // Handle root URI
  if (!rest || rest === '') {
    return {
      ok: true,
      type: 'root',
      segments: [],
      depth: 0,
      route: routes.root,
      queryValid: true,
    };
  }

  // Parse path segments
  const rawSegments = rest.split('/').filter(s => s);
  const parsedSegments: ParsedSegment[] = [];
  let currentNode = routes.root;
  let pathSoFar = `${scheme}://`;
  let depth = 0;

  for (let i = 0; i < rawSegments.length; i++) {
    const segment = rawSegments[i];
    depth++;

    // Check for index addressing: name[index]
    const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
    const name = indexMatch ? indexMatch[1] : segment;
    const index = indexMatch ? parseInt(indexMatch[2]) : undefined;

    // Get available children at current level
    const children = isRootEntry(currentNode.entry)
      ? currentNode.children
      : getRouteChildren(currentNode, routes);

    // Check if navigating into a collection element
    if (isCollectionEntry(currentNode.entry)) {
      // This segment addresses an element in the collection
      const addressing = currentNode.entry.addressing;

      // Determine addressing type
      if (index !== undefined) {
        // name[index] - but for collections, name should match collection name (already consumed)
        // This is actually a direct index like [0]
        return {
          ok: false,
          error: `Unexpected segment '${segment}' - collection already being addressed`,
          pathSoFar,
          failedSegment: segment,
          availableOptions: Object.keys(children),
        };
      }

      // Check if segment matches a child property (not an element address)
      if (children[name]) {
        currentNode = children[name];
        parsedSegments.push({ name });
        pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + name;

        // Handle index on the child (e.g., mailboxes/INBOX/messages[0])
        if (indexMatch) {
          // This shouldn't happen - index should be on collection, not child
          return {
            ok: false,
            error: `Cannot use index on '${name}'`,
            pathSoFar,
            failedSegment: segment,
            availableOptions: [],
          };
        }
        continue;
      }

      // Segment addresses an element by name or id
      let addressingType: 'name' | 'id' = 'name';
      if (addressing.includes('name')) {
        addressingType = 'name';
      } else if (addressing.includes('id')) {
        addressingType = 'id';
      } else {
        return {
          ok: false,
          error: `Collection does not support name or id addressing, use index: [0]`,
          pathSoFar,
          failedSegment: segment,
          availableOptions: ['[index]'],
        };
      }

      parsedSegments.push({
        name,
        addressing: { type: addressingType, value: decodeURIComponent(name) },
      });
      pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + segment;

      // Stay at collection level but now we're addressing an element
      // Children are from the element schema
      continue;
    }

    // Look up child route
    const childNode = children[name];
    if (!childNode) {
      return {
        ok: false,
        error: `Unknown segment '${name}' at ${pathSoFar}`,
        pathSoFar,
        failedSegment: name,
        availableOptions: Object.keys(children),
      };
    }

    currentNode = childNode;
    parsedSegments.push({ name });
    pathSoFar += (pathSoFar.endsWith('://') ? '' : '/') + name;

    // Handle index addressing on collections
    if (index !== undefined) {
      if (!isCollectionEntry(currentNode.entry)) {
        return {
          ok: false,
          error: `Cannot use index on non-collection '${name}'`,
          pathSoFar,
          failedSegment: segment,
          availableOptions: [],
        };
      }

      if (!currentNode.entry.addressing.includes('index')) {
        return {
          ok: false,
          error: `Collection '${name}' does not support index addressing`,
          pathSoFar,
          failedSegment: segment,
          availableOptions: [],
        };
      }

      parsedSegments.push({
        name: `[${index}]`,
        addressing: { type: 'index', value: index },
      });
      pathSoFar += `[${index}]`;
      depth++;
    }
  }

  // Parse and validate query string
  let query: ParsedQuery | undefined;
  let queryValid = true;
  let queryError: string | undefined;

  if (queryString) {
    const queryResult = parseAndValidateQuery(queryString, currentNode, routes);
    query = queryResult.query;
    queryValid = queryResult.valid;
    queryError = queryResult.error;
  }

  return {
    ok: true,
    type: getEntryType(currentNode.entry),
    segments: parsedSegments,
    depth,
    route: currentNode,
    query,
    queryValid,
    queryError,
  };
}

// ============================================================================
// Query Parsing and Validation
// ============================================================================

function parseAndValidateQuery(
  queryString: string,
  currentNode: RouteNode,
  routes: RouteTable
): { query: ParsedQuery; valid: boolean; error?: string } {
  const query: ParsedQuery = { filter: {} };
  let valid = true;
  let error: string | undefined;

  // Get the schema for the current node to validate fields
  let fieldTypes: Record<string, ValueType> = {};

  if (isCollectionEntry(currentNode.entry)) {
    const schemaRef = currentNode.entry.elementSchema;
    if ('_ref' in schemaRef) {
      const schema = routes.schemaRegistry[schemaRef._ref];
      if (schema) {
        fieldTypes = extractFieldTypes(schema);
      }
    }
  }

  for (const part of queryString.split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;

    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);

    // Standard params
    if (key === 'sort') {
      const [by, direction] = value.split('.');
      query.sort = { by, direction: (direction as 'asc' | 'desc') || 'asc' };
      continue;
    }
    if (key === 'limit') {
      query.pagination = query.pagination || {};
      query.pagination.limit = Number(value);
      continue;
    }
    if (key === 'offset') {
      query.pagination = query.pagination || {};
      query.pagination.offset = Number(value);
      continue;
    }
    if (key === 'expand') {
      query.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
      continue;
    }

    // Filter params
    const dotIdx = key.lastIndexOf('.');
    if (dotIdx === -1) {
      // Simple equals: ?name=value
      query.filter[key] = { equals: decodeURIComponent(value) };
    } else {
      const prop = key.slice(0, dotIdx);
      const op = key.slice(dotIdx + 1);

      // Validate operator against field type
      const fieldType = fieldTypes[prop];
      if (fieldType) {
        const validOps = validOperators[fieldType];
        const normalizedOp = normalizeOperator(op);

        if (!validOps.includes(normalizedOp)) {
          valid = false;
          error = `${op} operator not valid for ${fieldType} field`;
        }
      }

      // Parse the filter
      if (op === 'contains') query.filter[prop] = { contains: decodeURIComponent(value) };
      else if (op === 'startsWith') query.filter[prop] = { startsWith: decodeURIComponent(value) };
      else if (op === 'gt') query.filter[prop] = { greaterThan: Number(value) };
      else if (op === 'lt') query.filter[prop] = { lessThan: Number(value) };
    }
  }

  return { query, valid, error };
}

function normalizeOperator(op: string): string {
  if (op === 'gt') return 'gt';
  if (op === 'lt') return 'lt';
  return op;
}

function extractFieldTypes(schema: any): Record<string, ValueType> {
  const types: Record<string, ValueType> = {};

  function isPrimitiveType(type: any): boolean {
    return type === String || type === Number || type === Boolean || type === Date;
  }

  function primitiveToValueType(type: any): ValueType {
    if (type === String) return 'string';
    if (type === Number) return 'number';
    if (type === Boolean) return 'boolean';
    if (type === Date) return 'date';
    return 'string';
  }

  for (const [key, descriptor] of Object.entries(schema)) {
    if (!descriptor) continue;
    const desc = descriptor as any;

    // Only scalar primitives are filterable
    if (desc.dimension === 'scalar' && isPrimitiveType(desc.type)) {
      types[key] = primitiveToValueType(desc.type);
    }
  }

  return types;
}

// ============================================================================
// Completion Support
// ============================================================================

function getRouteCompletions(partial: string, routes: RouteTable): Completion[] {
  const completions: Completion[] = [];

  // Parse scheme
  const schemeMatch = partial.match(/^([^:]*)(:\/?\/?)?(.*)?$/);
  if (!schemeMatch) return [];

  const [, schemePartial, schemeSep, pathPart] = schemeMatch;

  // Suggest schemes
  if (!schemeSep || schemeSep !== '://') {
    if (routes.scheme.startsWith(schemePartial)) {
      completions.push({ value: `${routes.scheme}://`, label: routes.scheme, description: 'Scheme' });
    }
    return completions;
  }

  const path = pathPart || '';

  // Check if in query string
  const queryIdx = path.indexOf('?');
  if (queryIdx !== -1) {
    return getRouteQueryCompletions(routes.scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1), routes);
  }

  // Path completion
  return getRoutePathCompletions(routes.scheme, path, routes);
}

function getRoutePathCompletions(scheme: string, path: string, routes: RouteTable): Completion[] {
  const completions: Completion[] = [];

  // Split path to find partial segment
  const segments = path.split('/');
  const partialSegment = segments.pop() || '';
  const completePath = segments.join('/');

  // Parse parent path
  const parentUri = `${scheme}://${completePath}`;
  const parentResult = parseURIWithRoutes(parentUri, routes);

  if (!parentResult.ok) return [];

  const parentNode = parentResult.route;
  const children = isRootEntry(parentNode.entry)
    ? parentNode.children
    : getRouteChildren(parentNode, routes);

  // Suggest matching children
  for (const [name, node] of Object.entries(children)) {
    if (!name.toLowerCase().startsWith(partialSegment.toLowerCase())) continue;

    const entry = node.entry;
    let description: string;
    let suffix = '';

    if (isCollectionEntry(entry)) {
      suffix = '/';
      description = 'Collection';
    } else if (isVirtualEntry(entry)) {
      suffix = '/';
      description = 'Mailbox';
    } else if (isPropertyEntry(entry)) {
      description = `${entry.valueType} property`;
    } else if (isComputedEntry(entry)) {
      description = 'Computed property';
    } else {
      description = 'Entry';
    }

    completions.push({
      value: name + suffix,
      label: name,
      description,
    });
  }

  // If at a collection, suggest addressing options
  if (isCollectionEntry(parentNode.entry)) {
    if (parentNode.entry.addressing.includes('index')) {
      completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
    }
    completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
  }

  return completions;
}

function getRouteQueryCompletions(
  scheme: string,
  basePath: string,
  query: string,
  routes: RouteTable
): Completion[] {
  const completions: Completion[] = [];

  const parseResult = parseURIWithRoutes(`${scheme}://${basePath}`, routes);
  if (!parseResult.ok || !isCollectionEntry(parseResult.route.entry)) return [];

  const schemaRef = parseResult.route.entry.elementSchema;

  let fieldTypes: Record<string, ValueType> = {};
  if ('_ref' in schemaRef) {
    const schema = routes.schemaRegistry[schemaRef._ref];
    if (schema) {
      fieldTypes = extractFieldTypes(schema);
    }
  }

  const params = query.split('&');
  const lastParam = params[params.length - 1] || '';

  // Standard params
  if (!lastParam.includes('=') || lastParam === '') {
    if ('sort'.startsWith(lastParam)) completions.push({ value: 'sort=', label: 'sort', description: 'Sort results' });
    if ('limit'.startsWith(lastParam)) completions.push({ value: 'limit=', label: 'limit', description: 'Limit count' });
    if ('offset'.startsWith(lastParam)) completions.push({ value: 'offset=', label: 'offset', description: 'Skip N' });
    if ('expand'.startsWith(lastParam)) completions.push({ value: 'expand=', label: 'expand', description: 'Expand lazy props' });
  }

  // Property filters
  if (!lastParam.includes('=') && !lastParam.includes('.')) {
    for (const [key, type] of Object.entries(fieldTypes)) {
      if (key.startsWith(lastParam)) {
        completions.push({ value: `${key}=`, label: key, description: `Filter by ${key} (${type})` });
      }
    }
  }

  // Operator completion
  const dotMatch = lastParam.match(/^(\w+)\.(\w*)$/);
  if (dotMatch) {
    const [, prop, opPartial] = dotMatch;
    const fieldType = fieldTypes[prop];
    const ops = fieldType ? validOperators[fieldType] : ['contains', 'startsWith', 'gt', 'lt'];

    for (const op of ops) {
      const displayOp = op === 'greaterThan' ? 'gt' : op === 'lessThan' ? 'lt' : op;
      if (displayOp.startsWith(opPartial)) {
        completions.push({ value: `${prop}.${displayOp}=`, label: displayOp, description: `${op} operator` });
      }
    }
  }

  // Sort completion
  if (lastParam.startsWith('sort=')) {
    const sortVal = lastParam.slice(5);
    if (!sortVal.includes('.')) {
      for (const key of Object.keys(fieldTypes)) {
        if (key.startsWith(sortVal)) {
          completions.push({ value: `sort=${key}.`, label: key, description: `Sort by ${key}` });
        }
      }
    } else {
      const [prop] = sortVal.split('.');
      const dir = sortVal.split('.')[1] || '';
      if ('asc'.startsWith(dir)) completions.push({ value: `sort=${prop}.asc`, label: 'asc', description: 'Ascending' });
      if ('desc'.startsWith(dir)) completions.push({ value: `sort=${prop}.desc`, label: 'desc', description: 'Descending' });
    }
  }

  return completions;
}

// ============================================================================
// Exports
// ============================================================================

(globalThis as any).compileRoutes = compileRoutes;
(globalThis as any).parseURIWithRoutes = parseURIWithRoutes;
(globalThis as any).getRouteCompletions = getRouteCompletions;
(globalThis as any).getRouteChildren = getRouteChildren;
(globalThis as any).validOperators = validOperators;
