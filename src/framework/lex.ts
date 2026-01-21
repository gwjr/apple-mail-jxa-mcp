// ============================================================================
// URI Lexer - Pure structural parsing, no schema knowledge
// ============================================================================

// Filter operations
type FilterOp = 'equals' | 'contains' | 'startsWith' | 'gt' | 'lt';

type Filter = {
  field: string;
  op: FilterOp;
  value: string;
};

// SortDirection defined in specifier.ts

// Qualifiers attach to segment heads
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

type Segment = {
  head: string;
  qualifier?: Qualifier;
};

type ParsedURI = {
  scheme: string;
  segments: Segment[];
};

type LexError = {
  message: string;
  position: number;
};

type LexResult = { ok: true; value: ParsedURI } | { ok: false; error: LexError };

// ============================================================================
// Query Parsing
// ============================================================================

function parseQueryQualifier(query: string): QueryQualifier {
  const result: QueryQualifier = { kind: 'query', filters: [] };

  for (const part of query.split('&')) {
    if (!part) continue;

    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;

    const key = part.slice(0, eqIdx);
    const value = decodeURIComponent(part.slice(eqIdx + 1));

    // Standard query params
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

    // Filter params: field=value or field.op=value
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

function parseFilterOp(op: string): FilterOp {
  switch (op) {
    case 'contains': return 'contains';
    case 'startsWith': return 'startsWith';
    case 'gt': return 'gt';
    case 'lt': return 'lt';
    default: return 'equals';
  }
}

// ============================================================================
// Segment Parsing
// ============================================================================

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s);
}

function parseSegments(path: string): Segment[] {
  if (!path) return [];

  const segments: Segment[] = [];
  let remaining = path;

  while (remaining) {
    // Skip leading slash
    if (remaining.startsWith('/')) {
      remaining = remaining.slice(1);
      if (!remaining) break;
    }

    // Find end of head (next /, [, or ?)
    let headEnd = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i] === '/' || remaining[i] === '[' || remaining[i] === '?') {
        headEnd = i;
        break;
      }
    }

    const head = decodeURIComponent(remaining.slice(0, headEnd));
    remaining = remaining.slice(headEnd);

    // Check if this "head" is actually an ID qualifier for previous segment
    if (segments.length > 0 && isInteger(head)) {
      const prev = segments[segments.length - 1];
      if (!prev.qualifier) {
        prev.qualifier = { kind: 'id', value: parseInt(head, 10) };
        continue;
      }
    }

    const segment: Segment = { head };

    // Parse qualifier if present
    if (remaining.startsWith('[')) {
      // Index qualifier: [N]
      const closeIdx = remaining.indexOf(']');
      if (closeIdx !== -1) {
        const indexStr = remaining.slice(1, closeIdx);
        if (!isInteger(indexStr)) {
          // Invalid index - treat as name addressing instead (will fail later if invalid)
          segment.head = head + remaining.slice(0, closeIdx + 1);
          remaining = remaining.slice(closeIdx + 1);
        } else {
          segment.qualifier = { kind: 'index', value: parseInt(indexStr, 10) };
          remaining = remaining.slice(closeIdx + 1);
        }
      }
    }

    if (remaining.startsWith('?')) {
      // Query qualifier: ?key=value&...
      // Find end of query (next / or end)
      let queryEnd = remaining.length;
      for (let i = 1; i < remaining.length; i++) {
        if (remaining[i] === '/') {
          queryEnd = i;
          break;
        }
      }

      const queryStr = remaining.slice(1, queryEnd);
      const queryQualifier = parseQueryQualifier(queryStr);

      // Merge with existing qualifier if index was already parsed
      if (segment.qualifier?.kind === 'index') {
        // Can't have both index and query on same segment
        // Query wins, but this is arguably malformed
      }
      segment.qualifier = queryQualifier;
      remaining = remaining.slice(queryEnd);
    }

    segments.push(segment);
  }

  return segments;
}

// ============================================================================
// Main Lexer
// ============================================================================

function lexURI(uri: string): LexResult {
  // Parse scheme
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    return {
      ok: false,
      error: { message: 'Invalid URI: missing scheme (expected scheme://...)', position: 0 }
    };
  }

  const scheme = uri.slice(0, schemeEnd);
  if (!scheme) {
    return {
      ok: false,
      error: { message: 'Invalid URI: empty scheme', position: 0 }
    };
  }

  const path = uri.slice(schemeEnd + 3);
  const segments = parseSegments(path);

  return {
    ok: true,
    value: { scheme, segments }
  };
}

// ============================================================================
// Exports
// ============================================================================

(globalThis as any).lexURI = lexURI;
