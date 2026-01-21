/// <reference path="specifier.ts" />
/// <reference path="schema.ts" />
/// <reference path="lex.ts" />
/// <reference path="runtime.ts" />

// ============================================================================
// Scheme Registry
// ============================================================================

type SchemeRegistration = {
  root: () => any;
  schema: Schema;
};

const schemeRegistry: Record<string, SchemeRegistration> = {};

function registerScheme(scheme: string, root: () => any, schema: Schema): void {
  schemeRegistry[scheme] = { root, schema };
}

// ============================================================================
// Helpers
// ============================================================================

function isPrimitive(type: any): type is PrimitiveType {
  return type === String || type === Number || type === Boolean || type === Date;
}

function isScalar(desc: Descriptor): desc is ScalarDescriptor {
  return desc.dimension === 'scalar';
}

function isCollection(desc: Descriptor): desc is CollectionDescriptor {
  return Array.isArray(desc.dimension);
}

// ============================================================================
// URI Resolution - Route through schema
// ============================================================================

function specifierFromURI(uri: string): Result<any> {
  // Lex the URI
  const lexResult = lexURI(uri);
  if (!lexResult.ok) {
    return { ok: false, error: lexResult.error.message };
  }

  const { scheme, segments } = lexResult.value;

  // Look up scheme
  const registration = schemeRegistry[scheme];
  if (!registration) {
    const known = Object.keys(schemeRegistry);
    return { ok: false, error: `Unknown scheme: ${scheme}. Known: ${known.join(', ')}` };
  }

  // Start at root
  let currentJxa = registration.root();
  let currentSchema: Schema = registration.schema;
  let currentUri = `${scheme}://`;
  let inCollection = false;
  let collectionSchema: Schema | null = null;
  let collectionAddressing: AddressingMode[] = [];

  // Walk segments
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const { head, qualifier } = segment;

    // Look up head in current schema
    const desc = currentSchema[head] as Descriptor | undefined;

    if (desc) {
      // Found in schema
      const jxaName = desc.jxaName || head;

      if (isCollection(desc)) {
        // Navigate to collection
        currentJxa = currentJxa[jxaName];
        currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
        collectionSchema = desc.type;
        collectionAddressing = desc.dimension;
        inCollection = true;

        // Apply qualifier
        if (qualifier) {
          const result = applyQualifier(currentJxa, qualifier, currentUri, collectionSchema, collectionAddressing);
          if (!result.ok) return result;
          currentJxa = result.value.jxa;
          currentUri = result.value.uri;
          if (qualifier.kind !== 'query') {
            // Index or ID addressing - now at element level
            currentSchema = collectionSchema;
            inCollection = false;
          }
        }
      } else if (isScalar(desc)) {
        if (isPrimitive(desc.type)) {
          // Leaf scalar - can't navigate further
          currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
          const getter = () => currentJxa[jxaName]();
          if (desc.set === 'default') {
            return { ok: true, value: mutableSpec(currentUri, getter, (v) => currentJxa[jxaName].set(v)) };
          }
          return { ok: true, value: scalarSpec(currentUri, getter) };
        } else {
          // Nested schema
          currentUri += (currentUri.endsWith('://') ? '' : '/') + head;
          if (desc.computed) {
            currentJxa = desc.computed(currentJxa);
          } else {
            currentJxa = currentJxa[jxaName]();
          }
          currentSchema = desc.type as Schema;
          inCollection = false;
        }
      }
    } else if (inCollection) {
      // Not in schema, but we're in a collection - treat as name/id address
      currentUri += (currentUri.endsWith('://') ? '' : '/') + head;

      if (collectionAddressing.includes('name')) {
        currentJxa = currentJxa.byName(decodeURIComponent(head));
      } else if (collectionAddressing.includes('id')) {
        currentJxa = currentJxa.byId(decodeURIComponent(head));
      } else {
        return { ok: false, error: `Cannot address by name at ${currentUri}` };
      }

      currentSchema = collectionSchema!;
      inCollection = false;

      // Apply qualifier if present (e.g., query on element)
      if (qualifier?.kind === 'query') {
        // Queries on elements expand lazy props, etc. - handle later
      }
    } else {
      // Not found and not in collection
      const available = Object.keys(currentSchema);
      return { ok: false, error: `Unknown segment '${head}' at ${currentUri}. Available: ${available.join(', ')}` };
    }
  }

  // Build final specifier
  if (inCollection) {
    return {
      ok: true,
      value: createCollSpec(currentUri, currentJxa, collectionSchema!, collectionAddressing, 'Item')
    };
  }

  return {
    ok: true,
    value: createElemSpec(currentUri, currentJxa, currentSchema, [], 'Item')
  };
}

// ============================================================================
// Qualifier Application
// ============================================================================

function applyQualifier(
  jxa: any,
  qualifier: Qualifier,
  baseUri: string,
  schema: Schema,
  addressing: AddressingMode[]
): Result<{ jxa: any; uri: string }> {
  switch (qualifier.kind) {
    case 'index': {
      if (!addressing.includes('index')) {
        return { ok: false, error: `Collection at ${baseUri} does not support index addressing` };
      }
      const newJxa = jxa.at(qualifier.value);
      const newUri = `${baseUri}[${qualifier.value}]`;
      return { ok: true, value: { jxa: newJxa, uri: newUri } };
    }

    case 'id': {
      if (!addressing.includes('id')) {
        return { ok: false, error: `Collection at ${baseUri} does not support id addressing` };
      }
      const newJxa = jxa.byId(qualifier.value);
      const newUri = `${baseUri}/${qualifier.value}`;
      return { ok: true, value: { jxa: newJxa, uri: newUri } };
    }

    case 'query': {
      // Apply filters, sort, pagination to collection
      let filtered = jxa;
      let uri = baseUri;

      if (qualifier.filters.length > 0) {
        const jxaFilter: Record<string, any> = {};
        for (const f of qualifier.filters) {
          const jxaName = (schema[f.field] as Descriptor)?.jxaName || f.field;
          jxaFilter[jxaName] = filterToJxa(f);
        }
        try {
          filtered = jxa.whose(jxaFilter);
        } catch {
          // JXA whose failed, filter in JS later
        }
        uri += '?' + qualifier.filters.map(f => `${f.field}${f.op === 'equals' ? '' : '.' + f.op}=${encodeURIComponent(f.value)}`).join('&');
      }

      if (qualifier.sort) {
        uri += (uri.includes('?') ? '&' : '?') + `sort=${qualifier.sort.field}.${qualifier.sort.direction}`;
      }
      if (qualifier.limit !== undefined) {
        uri += (uri.includes('?') ? '&' : '?') + `limit=${qualifier.limit}`;
      }
      if (qualifier.offset !== undefined) {
        uri += (uri.includes('?') ? '&' : '?') + `offset=${qualifier.offset}`;
      }

      return { ok: true, value: { jxa: filtered, uri } };
    }
  }
}

function filterToJxa(filter: Filter): any {
  switch (filter.op) {
    case 'equals': return filter.value;
    case 'contains': return { _contains: filter.value };
    case 'startsWith': return { _beginsWith: filter.value };
    case 'gt': return { _greaterThan: parseFloat(filter.value) };
    case 'lt': return { _lessThan: parseFloat(filter.value) };
  }
}

// ============================================================================
// Exports
// ============================================================================

(globalThis as any).registerScheme = registerScheme;
(globalThis as any).specifierFromURI = specifierFromURI;
