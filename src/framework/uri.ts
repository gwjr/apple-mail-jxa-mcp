// src/framework/uri.ts - URI Parsing & Resolution
//
// URI scheme handling and navigation.

// ─────────────────────────────────────────────────────────────────────────────
// URI Building
// ─────────────────────────────────────────────────────────────────────────────

function buildURIString(segments: PathSegment[]): string {
  let uri = '';
  for (const seg of segments) {
    switch (seg.kind) {
      case 'root':
        uri = `${seg.scheme}://`;
        break;
      case 'prop':
        uri += (uri.endsWith('://') ? '' : '/') + seg.name;
        break;
      case 'index':
        uri += `%5B${seg.value}%5D`;  // URL-encoded [ and ]
        break;
      case 'name':
        uri += '/' + encodeURIComponent(seg.value);
        break;
      case 'id':
        uri += '/' + encodeURIComponent(String(seg.value));
        break;
    }
  }
  return uri;
}

function buildURI(segments: PathSegment[]): URL {
  return new URL(buildURIString(segments));
}

function buildQueryString(query: QueryState): string {
  const parts: string[] = [];

  if (query.filter) {
    for (const [field, pred] of Object.entries(query.filter)) {
      const opName = pred.operator.name;
      const value = pred.operator.toUri(pred.value);
      if (opName === 'equals') {
        parts.push(`${field}=${value}`);
      } else {
        parts.push(`${field}.${opName}=${value}`);
      }
    }
  }

  if (query.sort) {
    parts.push(`sort=${String(query.sort.by)}.${query.sort.direction || 'asc'}`);
  }

  if (query.pagination?.limit !== undefined) {
    parts.push(`limit=${query.pagination.limit}`);
  }
  if (query.pagination?.offset !== undefined) {
    parts.push(`offset=${query.pagination.offset}`);
  }

  if (query.expand && query.expand.length > 0) {
    parts.push(`expand=${query.expand.join(',')}`);
  }

  return parts.join('&');
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Lexer Types
// ─────────────────────────────────────────────────────────────────────────────

type FilterOp = 'equals' | 'contains' | 'startsWith' | 'gt' | 'lt';

type Filter = {
  field: string;
  op: FilterOp;
  value: string;
};

type IndexQualifier = { kind: 'index'; value: number };
type IdQualifier = { kind: 'id'; value: number };
type QueryQualifier = {
  kind: 'query';
  filters: Filter[];
  sort?: { field: string; direction: SortDirection };
  limit?: number;
  offset?: number;
  expand?: string[];
};

type Qualifier = IndexQualifier | IdQualifier | QueryQualifier;

type URISegment = {
  head: string;
  qualifier?: Qualifier;
};

type ParsedURI = {
  scheme: string;
  segments: URISegment[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Proto Guards (for runtime schema navigation during URI resolution)
// ─────────────────────────────────────────────────────────────────────────────

function hasByIndex(proto: object): proto is { byIndex: (n: number) => unknown } {
  return 'byIndex' in proto && typeof (proto as any).byIndex === 'function';
}

function hasByName(proto: object): proto is { byName: (name: string) => unknown } {
  return 'byName' in proto && typeof (proto as any).byName === 'function';
}

function hasById(proto: object): proto is { byId: (id: string | number) => unknown } {
  return 'byId' in proto && typeof (proto as any).byId === 'function';
}

function isChildProto(value: unknown): value is BaseProtoType<MCPReturnableValue> {
  return typeof value === 'object' && value !== null && 'resolutionStrategy' in value && typeof (value as any).resolutionStrategy === 'function';
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Lexer
// ─────────────────────────────────────────────────────────────────────────────

function parseFilterOp(op: string): FilterOp {
  switch (op) {
    case 'contains': return 'contains';
    case 'startsWith': return 'startsWith';
    case 'gt': return 'gt';
    case 'lt': return 'lt';
    default: return 'equals';
  }
}

function parseQueryQualifier(query: string): QueryQualifier {
  const result: QueryQualifier = { kind: 'query', filters: [] };

  for (const part of query.split('&')) {
    if (!part) continue;

    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;

    const key = part.slice(0, eqIdx);
    const value = decodeURIComponent(part.slice(eqIdx + 1));

    if (key === 'sort') {
      const dotIdx = value.lastIndexOf('.');
      if (dotIdx !== -1) {
        const field = value.slice(0, dotIdx);
        const dir = value.slice(dotIdx + 1);
        result.sort = { field, direction: dir === 'desc' ? 'desc' : 'asc' };
      } else {
        result.sort = { field: value, direction: 'asc' };
      }
      continue;
    }

    if (key === 'limit') {
      result.limit = parseInt(value, 10);
      continue;
    }

    if (key === 'offset') {
      result.offset = parseInt(value, 10);
      continue;
    }

    if (key === 'expand') {
      result.expand = value.split(',').map(s => s.trim());
      continue;
    }

    const dotIdx = key.lastIndexOf('.');
    if (dotIdx === -1) {
      result.filters.push({ field: key, op: 'equals', value });
    } else {
      const field = key.slice(0, dotIdx);
      const opStr = key.slice(dotIdx + 1);
      const op = parseFilterOp(opStr);
      result.filters.push({ field, op, value });
    }
  }

  return result;
}

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s);
}

function parseSegments(path: string): URISegment[] {
  if (!path) return [];

  const segments: URISegment[] = [];
  let remaining = path;

  while (remaining) {
    if (remaining.startsWith('/')) {
      remaining = remaining.slice(1);
      if (!remaining) break;
    }

    // Check for literal or encoded brackets/query
    let headEnd = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      const ch = remaining[i];
      if (ch === '/' || ch === '[' || ch === '?') {
        headEnd = i;
        break;
      }
      // Check for URL-encoded [ (%5B or %5b)
      if (ch === '%' && i + 2 < remaining.length) {
        const encoded = remaining.slice(i, i + 3).toUpperCase();
        if (encoded === '%5B' || encoded === '%3F') {
          headEnd = i;
          break;
        }
      }
    }

    const head = decodeURIComponent(remaining.slice(0, headEnd));
    remaining = remaining.slice(headEnd);

    if (segments.length > 0 && isInteger(head)) {
      const prev = segments[segments.length - 1];
      if (!prev.qualifier) {
        prev.qualifier = { kind: 'id', value: parseInt(head, 10) };
        continue;
      }
    }

    const segment: URISegment = { head };

    // Check for literal [ or URL-encoded %5B
    if (remaining.startsWith('[') || remaining.toUpperCase().startsWith('%5B')) {
      const isEncoded = remaining.toUpperCase().startsWith('%5B');
      const openLen = isEncoded ? 3 : 1;  // '%5B' vs '['
      const closeChar = isEncoded ? '%5D' : ']';
      const closeIdx = remaining.toUpperCase().indexOf(isEncoded ? '%5D' : ']');
      const closeLen = isEncoded ? 3 : 1;
      if (closeIdx !== -1) {
        const indexStr = remaining.slice(openLen, closeIdx);
        if (isInteger(indexStr)) {
          segment.qualifier = { kind: 'index', value: parseInt(indexStr, 10) };
          remaining = remaining.slice(closeIdx + closeLen);
        }
      }
    }

    if (remaining.startsWith('?')) {
      let queryEnd = remaining.length;
      for (let i = 1; i < remaining.length; i++) {
        if (remaining[i] === '/') {
          queryEnd = i;
          break;
        }
      }

      const queryStr = remaining.slice(1, queryEnd);
      segment.qualifier = parseQueryQualifier(queryStr);
      remaining = remaining.slice(queryEnd);
    }

    segments.push(segment);
  }

  return segments;
}

function lexURI(uri: string): Result<ParsedURI> {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    return { ok: false, error: 'Invalid URI: missing scheme (expected scheme://...)' };
  }

  const scheme = uri.slice(0, schemeEnd);
  if (!scheme) {
    return { ok: false, error: 'Invalid URI: empty scheme' };
  }

  const path = uri.slice(schemeEnd + 3);
  const segments = parseSegments(path);

  return { ok: true, value: { scheme, segments } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheme Registry
// ─────────────────────────────────────────────────────────────────────────────

type SchemeRegistration<P extends object> = {
  createRoot: () => Delegate;
  proto: P;
};

const schemeRegistry: Record<string, SchemeRegistration<any>> = {};

function registerScheme<P extends object>(
  scheme: string,
  createRoot: () => Delegate,
  proto: P
): void {
  schemeRegistry[scheme] = { createRoot, proto };
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Resolution Helpers
// ─────────────────────────────────────────────────────────────────────────────

function filtersToWhoseFilter(filters: Filter[]): WhoseFilter {
  const result: WhoseFilter = {};
  for (const { field, op, value } of filters) {
    const operator = getOperatorByName(op);
    if (operator) {
      result[field] = { operator, value: operator.parseUri(value) };
    }
  }
  return result;
}

function sortToSortSpec(sort: { field: string; direction: SortDirection }): SortSpec<any> {
  return { by: sort.field, direction: sort.direction };
}

function applyQueryQualifier(
  delegate: Delegate,
  proto: any,
  qualifier: QueryQualifier
): { delegate: Delegate; proto: any } {
  let newDelegate = delegate;

  if (qualifier.filters.length > 0) {
    const whoseFilter = filtersToWhoseFilter(qualifier.filters);
    newDelegate = newDelegate.withFilter(whoseFilter);
  }

  if (qualifier.sort) {
    const sortSpec = sortToSortSpec(qualifier.sort);
    newDelegate = newDelegate.withSort(sortSpec);
  }

  if (qualifier.limit !== undefined || qualifier.offset !== undefined) {
    newDelegate = newDelegate.withPagination({
      limit: qualifier.limit,
      offset: qualifier.offset,
    });
  }

  if (qualifier.expand && qualifier.expand.length > 0) {
    newDelegate = newDelegate.withExpand(qualifier.expand);
  }

  const queryableProto = withQuery(proto);

  return { delegate: newDelegate, proto: queryableProto };
}

// ─────────────────────────────────────────────────────────────────────────────
// URI Resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveURI(uri: string): Result<Res<any>> {
  const lexResult = lexURI(uri);
  if (!lexResult.ok) {
    return { ok: false, error: lexResult.error };
  }

  const { scheme, segments } = lexResult.value;

  const registration = schemeRegistry[scheme];
  if (!registration) {
    const known = Object.keys(schemeRegistry);
    return { ok: false, error: `Unknown scheme: ${scheme}. Known: ${known.join(', ') || '(none)'}` };
  }

  let delegate = registration.createRoot();
  let proto: any = registration.proto;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const { head, qualifier } = segment;

    // For namespace protos, look up properties in the target proto
    const lookupProto = getNamespaceNav(proto) || proto;
    const childProto = lookupProto[head];

    // Check for namespaceNav first (virtual grouping, no JXA navigation)
    // Namespaces need special handling: no qualifiers allowed, keep the navProto
    const namespaceTargetProto = childProto ? getNamespaceNav(childProto) : undefined;
    if (namespaceTargetProto) {
      delegate = delegate.namespace(head);
      // Keep the navProto (childProto) which has the custom resolve, not the inner targetProto
      proto = childProto!;
      // Namespaces don't have qualifiers - if there's a qualifier, it's an error
      if (qualifier) {
        return { ok: false, error: `Namespace '${head}' does not support qualifiers` };
      }
      continue;
    }

    // Check for computedNav - need target proto for further resolution
    const computedNavInfo = childProto ? getComputedNav(childProto) : undefined;
    if (computedNavInfo) {
      // Use navigationStrategy for delegate navigation
      delegate = childProto.navigationStrategy(delegate, head, childProto);
      // But use the target proto for further resolution
      proto = computedNavInfo.targetProto;

      // Handle qualifiers on the target if any
      if (qualifier) {
        const itemProto = getItemProto(proto);

        if (qualifier.kind === 'index') {
          if (!hasByIndex(proto)) {
            return { ok: false, error: `computedNav target '${head}' does not support index addressing` };
          }
          delegate = delegate.byIndex(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'id') {
          if (!hasById(proto)) {
            return { ok: false, error: `computedNav target '${head}' does not support id addressing` };
          }
          delegate = delegate.byId(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'query') {
          const applied = applyQueryQualifier(delegate, proto, qualifier);
          delegate = applied.delegate;
          proto = applied.proto;
        }
      }
    } else if (childProto !== undefined && isChildProto(childProto)) {
      // Normal property navigation - use navigationStrategy or default
      const nav = childProto.navigationStrategy || defaultNavigation;
      delegate = nav(delegate, head, childProto);
      proto = childProto;

      if (qualifier) {
        const itemProto = getItemProto(proto);

        if (qualifier.kind === 'index') {
          if (!hasByIndex(proto)) {
            return { ok: false, error: `Collection '${head}' does not support index addressing` };
          }
          delegate = delegate.byIndex(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'id') {
          if (!hasById(proto)) {
            return { ok: false, error: `Collection '${head}' does not support id addressing` };
          }
          delegate = delegate.byId(qualifier.value);
          proto = itemProto || baseScalar;
        } else if (qualifier.kind === 'query') {
          const applied = applyQueryQualifier(delegate, proto, qualifier);
          delegate = applied.delegate;
          proto = applied.proto;
        }
      }
    } else if (hasByName(proto) || hasById(proto)) {
      const itemProto = getItemProto(proto);

      if (hasByName(proto)) {
        delegate = delegate.byName(head);
        proto = itemProto || baseScalar;
      } else if (hasById(proto)) {
        delegate = delegate.byId(head);
        proto = itemProto || baseScalar;
      }

      if (qualifier && qualifier.kind === 'index') {
        const subProto = proto[head];
        if (subProto && isChildProto(subProto) && hasByIndex(subProto)) {
          delegate = delegate.prop(head).byIndex(qualifier.value);
          proto = getItemProto(subProto) || baseScalar;
        }
      }
    } else {
      const available = Object.keys(lookupProto).filter(k => {
        const v = lookupProto[k];
        return isChildProto(v);
      });
      return { ok: false, error: `Unknown segment '${head}'. Available: ${available.join(', ')}` };
    }
  }

  return { ok: true, value: createSpecifier(delegate, proto) };
}
