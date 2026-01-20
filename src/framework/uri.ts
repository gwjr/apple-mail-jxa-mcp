/// <reference path="schema.ts" />
/// <reference path="specifier.ts" />
/// <reference path="runtime.ts" />
/// <reference path="routes.ts" />

// ============================================================================
// URI Resolution and Registry
// ============================================================================

interface SchemeRegistration {
  root: () => any;
  schema: any;
  routes: RouteTable;
}

const schemeRegistry: Record<string, SchemeRegistration> = {};

function registerScheme(scheme: string, root: () => any, schema: any, namedSchemas?: Record<string, any>): void {
  schemeRegistry[scheme] = {
    root,
    schema,
    routes: compileRoutes(schema, scheme, namedSchemas),
  };
}

// Legacy accessor for completions (read-only)
const schemeRoots: Record<string, () => any> = new Proxy({} as Record<string, () => any>, {
  get: (_target, prop: string) => schemeRegistry[prop]?.root,
  ownKeys: () => Object.keys(schemeRegistry),
  getOwnPropertyDescriptor: (_target, prop: string) =>
    schemeRegistry[prop] ? { configurable: true, enumerable: true } : undefined,
});

type Completion = { value: string; label?: string; description?: string };

// ============================================================================
// Route Table Access
// ============================================================================

function getRoutesForScheme(scheme: string): RouteTable | undefined {
  return schemeRegistry[scheme]?.routes;
}

function formatAvailableOptions(options: string[], max = 10): string {
  if (options.length === 0) return '';
  const shown = options.slice(0, max);
  const more = options.length > max ? `, ... (${options.length - max} more)` : '';
  return ` Available: ${shown.join(', ')}${more}`;
}

// ============================================================================
// Error Suggestion Helper (Route-Table Based)
// ============================================================================

function suggestCompletions(partial: string, max = 5): string {
  // Extract scheme
  const schemeEnd = partial.indexOf('://');
  if (schemeEnd === -1) return '';

  const scheme = partial.slice(0, schemeEnd);
  const routes = getRoutesForScheme(scheme);

  if (routes) {
    // Use route-based completions
    const completions = getRouteCompletions(partial, routes);
    if (!completions.length) return '';
    return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
  }

  // Fall back to legacy completion probing
  const completions = getCompletions(partial);
  if (!completions.length) return '';
  return ` Did you mean: ${completions.slice(0, max).map(c => c.label || c.value).join(', ')}?`;
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
// URI Deserialization (Route-Table Based)
// ============================================================================

function specifierFromURI(uri: string): Result<{ _isSpecifier: true; uri: string; resolve(): Result<any>; fix(): Result<any> }> {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) {
    return { ok: false, error: `Invalid URI (no scheme): ${uri}` };
  }

  const scheme = uri.slice(0, schemeEnd);
  const registration = schemeRegistry[scheme];

  if (!registration) {
    const knownSchemes = Object.keys(schemeRegistry);
    const suggestion = knownSchemes.length ? ` Known schemes: ${knownSchemes.join(', ')}` : '';
    return { ok: false, error: `Unknown scheme: ${scheme}.${suggestion}` };
  }

  return specifierFromURIWithRoutes(uri, scheme, registration, registration.routes);
}

// Route-table based URI resolution
function specifierFromURIWithRoutes(
  uri: string,
  scheme: string,
  registration: SchemeRegistration,
  routes: RouteTable
): Result<any> {
  // Parse and validate URI structure against route table
  const parseResult = parseURIWithRoutes(uri, routes);

  if (!parseResult.ok) {
    // Format error with available options
    const availableStr = formatAvailableOptions(parseResult.availableOptions);
    return {
      ok: false,
      error: `Unknown segment '${parseResult.failedSegment}' at ${parseResult.pathSoFar}.${availableStr}`
    };
  }

  // Query validation
  if (!parseResult.queryValid && parseResult.queryError) {
    return { ok: false, error: `Invalid query: ${parseResult.queryError}` };
  }

  // Now execute navigation using validated route info
  let current: any = registration.root();
  let resolved = `${scheme}://`;

  // Split path for navigation
  let rest = uri.slice(scheme.length + 3);
  const queryIdx = rest.indexOf('?');
  const query = queryIdx !== -1 ? rest.slice(queryIdx + 1) : undefined;
  if (queryIdx !== -1) rest = rest.slice(0, queryIdx);

  // Navigate using route-guided path
  let currentRoute = routes.root;

  for (const segment of rest.split('/').filter(s => s)) {
    const indexMatch = segment.match(/^(.+?)\[(-?\d+)\]$/);
    const name = indexMatch ? indexMatch[1] : segment;
    const index = indexMatch ? parseInt(indexMatch[2]) : undefined;

    try {
      // Get route children to determine navigation type
      const children = isRootEntry(currentRoute.entry)
        ? currentRoute.children
        : getRouteChildren(currentRoute, routes);

      const childRoute = children[name];

      if (childRoute) {
        // Navigate using route-guided navigation
        const entry = childRoute.entry;

        if (isVirtualEntry(entry)) {
          // Virtual navigation (standard mailboxes, settings, etc.)
          const newUri = resolved + (resolved.endsWith('://') ? '' : '/') + name;
          const jxaApp = Application('Mail');
          const targetSchema = routes.schemaRegistry[entry.targetSchema._ref];

          if (isVirtualPropEntry(entry)) {
            if (entry.accountScoped) {
              // Account-scoped mailbox - need special handling
              current = navigateAccountMailbox(current, entry, newUri);
            } else {
              // Navigation via JXA property
              const jxaProp = jxaApp[entry.jxaProperty];
              const jxaObj = typeof jxaProp === 'function' ? jxaProp() : jxaProp;
              current = createSchemaSpecifier(newUri, jxaObj, targetSchema, entry.targetSchema._ref);
            }
          } else {
            // useSelf: use the current context (e.g., app itself for settings)
            current = createSchemaSpecifier(newUri, jxaApp, targetSchema, entry.targetSchema._ref);
          }
          currentRoute = childRoute;
          resolved += (resolved.endsWith('://') ? '' : '/') + name;
        } else if (current[name] !== undefined) {
          // Direct property navigation
          current = current[name];
          currentRoute = childRoute;
          resolved += (resolved.endsWith('://') ? '' : '/') + name;
        } else {
          // Should not happen if route table is correct
          return { ok: false, error: `Route exists but navigation failed for '${name}' at ${resolved}` };
        }
      } else if (isCollectionEntry(currentRoute.entry)) {
        // Addressing into a collection element by name/id
        if (current.byName) {
          current = current.byName(decodeURIComponent(name));
        } else if (current.byId) {
          current = current.byId(decodeURIComponent(name));
        } else {
          return { ok: false, error: `Cannot address collection by name/id at ${resolved}` };
        }
        resolved += (resolved.endsWith('://') ? '' : '/') + name;
        // Stay at collection level for children lookup
      } else {
        // No route match - should have been caught by parseURIWithRoutes
        const availableStr = formatAvailableOptions(Object.keys(children));
        return { ok: false, error: `Cannot navigate to '${name}' from ${resolved}.${availableStr}` };
      }

      // Handle index addressing
      if (index !== undefined) {
        if (!current.byIndex) {
          return { ok: false, error: `Cannot index into '${name}' at ${resolved}` };
        }
        current = current.byIndex(index);
        resolved += `[${index}]`;
      }
    } catch (error) {
      return { ok: false, error: `Failed at '${segment}': ${error}` };
    }
  }

  // Apply query parameters
  if (query) {
    try {
      const { filter, sort, pagination, expand } = parseQuery(query);
      if (Object.keys(filter).length > 0 && current.whose) current = current.whose(filter);
      if (sort && current.sortBy) current = current.sortBy(sort);
      if (pagination && current.paginate) current = current.paginate(pagination);
      if (expand?.length && current.expand) current = current.expand(expand);
    } catch (error) {
      return { ok: false, error: `Failed to apply query: ${error}` };
    }
  }

  return { ok: true, value: current };
}

// Navigate to account-scoped mailbox
function navigateAccountMailbox(parent: any, entry: VirtualPropertyEntry, uri: string): any {
  try {
    const parentResult = parent.resolve();
    if (!parentResult.ok) {
      throw new Error('Failed to resolve parent account');
    }
    const accountId = parentResult.value.id;
    if (!accountId) {
      throw new Error('Account has no ID');
    }

    const jxa = Application('Mail');
    const appMailbox = jxa[entry.jxaProperty]();
    const accountMailbox = appMailbox.mailboxes().find((m: any) => {
      try { return m.account().id() === accountId; } catch { return false; }
    });

    if (!accountMailbox) {
      throw new Error(`No ${entry.jxaProperty} mailbox found for account`);
    }

    return createSchemaSpecifier(uri, accountMailbox, MailboxSchema, 'Mailbox');
  } catch (error) {
    throw new Error(`Failed to navigate to account mailbox: ${error}`);
  }
}

