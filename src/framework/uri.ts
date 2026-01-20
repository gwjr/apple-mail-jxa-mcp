/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />
/// <reference path="runtime.ts" />

// ============================================================================
// URI Resolution and Registry
// ============================================================================

const schemeRoots: Record<string, () => any> = {};

function registerScheme(scheme: string, root: () => any): void {
  schemeRoots[scheme] = root;
}

type NavigationHook = (parent: any, name: string, uri: string) => any | undefined;
const navigationHooks: NavigationHook[] = [];

function registerNavigationHook(hook: NavigationHook): void {
  navigationHooks.push(hook);
}

type Completion = { value: string; label?: string; description?: string };
type CompletionHook = (specifier: any, partial: string) => Completion[];
const completionHooks: CompletionHook[] = [];

function registerCompletionHook(hook: CompletionHook): void {
  completionHooks.push(hook);
}

// ============================================================================
// Error Suggestion Helper
// ============================================================================

let _inErrorSuggestion = false;

function suggestCompletions(partial: string, max = 5): string {
  if (_inErrorSuggestion) return '';
  _inErrorSuggestion = true;
  try {
    const completions = getCompletions(partial);
    if (!completions.length) return '';
    return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
  } finally {
    _inErrorSuggestion = false;
  }
}

// ============================================================================
// Query Parsing and Filter Encoding
// ============================================================================

function parseQuery(query: string): { filter: WhoseFilter<any>; sort?: SortSpec<any>; pagination?: PaginationSpec; expand?: ExpandSpec } {
  const result: { filter: WhoseFilter<any>; sort?: SortSpec<any>; pagination?: PaginationSpec; expand?: ExpandSpec } = { filter: {} };

  for (const part of query.split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx);
    const value = part.slice(eqIdx + 1);

    if (key === 'sort') {
      const [by, direction] = value.split('.');
      result.sort = { by, direction: (direction as SortDirection) || 'asc' };
      continue;
    }
    if (key === 'limit') {
      result.pagination = result.pagination || {};
      result.pagination.limit = Number(value);
      continue;
    }
    if (key === 'offset') {
      result.pagination = result.pagination || {};
      result.pagination.offset = Number(value);
      continue;
    }
    if (key === 'expand') {
      result.expand = value.split(',').map(s => decodeURIComponent(s.trim()));
      continue;
    }

    const dotIdx = key.lastIndexOf('.');
    if (dotIdx === -1) {
      result.filter[key] = { equals: decodeURIComponent(value) };
    } else {
      const prop = key.slice(0, dotIdx);
      const op = key.slice(dotIdx + 1);
      if (op === 'contains') result.filter[prop] = { contains: decodeURIComponent(value) };
      else if (op === 'startsWith') result.filter[prop] = { startsWith: decodeURIComponent(value) };
      else if (op === 'gt') result.filter[prop] = { greaterThan: Number(value) };
      else if (op === 'lt') result.filter[prop] = { lessThan: Number(value) };
    }
  }
  return result;
}

function encodeFilter(filter: WhoseFilter<any>): string {
  const parts: string[] = [];
  for (const [key, predicate] of Object.entries(filter)) {
    const pred = predicate as any;
    if ('equals' in pred) parts.push(`${key}=${encodeURIComponent(String(pred.equals))}`);
    else if ('contains' in pred) parts.push(`${key}.contains=${encodeURIComponent(pred.contains)}`);
    else if ('startsWith' in pred) parts.push(`${key}.startsWith=${encodeURIComponent(pred.startsWith)}`);
    else if ('greaterThan' in pred) parts.push(`${key}.gt=${pred.greaterThan}`);
    else if ('lessThan' in pred) parts.push(`${key}.lt=${pred.lessThan}`);
  }
  return parts.join('&');
}

// ============================================================================
// URI Deserialization
// ============================================================================

function specifierFromURI(uri: string): Result<{ _isSpecifier: true; uri: string; resolve(): Result<any>; fix(): Result<any> }> {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    return { ok: false, error: `Invalid URI (no scheme): ${uri}.${suggestCompletions(uri)}` };
  }

  const scheme = uri.slice(0, schemeEnd);
  let rest = uri.slice(schemeEnd + 3);

  let query: string | undefined;
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) {
    query = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }

  const rootFactory = schemeRoots[scheme];
  if (!rootFactory) {
    const knownSchemes = Object.keys(schemeRoots);
    const suggestion = knownSchemes.length ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
    return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
  }

  let current: any = rootFactory();
  let resolved = `${scheme}://`;

  for (const segment of rest.split('/').filter(s => s)) {
    const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
    const name = indexMatch ? indexMatch[1] : segment;
    const index = indexMatch ? parseInt(indexMatch[2]) : undefined;

    try {
      if (current[name] !== undefined) {
        current = current[name];
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
      } else if (current.byName) {
        current = current.byName(decodeURIComponent(name));
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
      } else if (current.byId) {
        current = current.byId(decodeURIComponent(name));
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
      } else {
        const nextUri = resolved + (resolved.endsWith('://') ? '' : '/') + name;
        let hooked: any;
        for (const hook of navigationHooks) {
          hooked = hook(current, name, nextUri);
          if (hooked !== undefined) break;
        }
        if (hooked !== undefined) {
          current = hooked;
          resolved = nextUri;
        } else {
          const partial = resolved + (resolved.endsWith('://') ? '' : '/') + name;
          return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${suggestCompletions(partial)}` };
        }
      }

      if (index !== undefined) {
        if (!current.byIndex) {
          return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
        }
        current = current.byIndex(index);
        resolved += `[${index}]`;
      }
    } catch (error) {
      return { ok: false, error: `Failed at '${segment}': ${error}.${suggestCompletions(resolved)}` };
    }
  }

  if (query) {
    try {
      const { filter, sort, pagination, expand } = parseQuery(query);
      if (Object.keys(filter).length > 0 && current.whose) current = current.whose(filter);
      if (sort && current.sortBy) current = current.sortBy(sort);
      if (pagination && current.paginate) current = current.paginate(pagination);
      if (expand?.length && current.expand) current = current.expand(expand);
      resolved += '?' + query;
    } catch (error) {
      return { ok: false, error: `Failed to apply query: ${error} (resolved: ${resolved})` };
    }
  }

  return { ok: true, value: current };
}
