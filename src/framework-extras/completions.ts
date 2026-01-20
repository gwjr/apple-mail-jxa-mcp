/// <reference path="../framework/schema.ts" />
/// <reference path="../framework/specifier.ts" />
/// <reference path="../framework/runtime.ts" />
/// <reference path="../framework/uri.ts" />
/// <reference path="../framework/routes.ts" />

// ============================================================================
// URI Completions Support
// Autocomplete functionality for partial URIs
// Route-table based for fast, schema-driven completions
// ============================================================================

// ============================================================================
// Main Completion Entry Point
// ============================================================================

function getCompletions(partial: string): Completion[] {
  // Parse scheme
  const schemeMatch = partial.match(/^([^:]*)(:\/?\/?)?(.*)?$/);
  if (!schemeMatch) return [];

  const [, schemePartial, schemeSep, pathPart] = schemeMatch;

  // If no scheme separator yet, suggest schemes
  if (!schemeSep || schemeSep !== '://') {
    return Object.keys(schemeRoots)
      .filter(s => s.startsWith(schemePartial))
      .map(s => ({ value: `${s}://`, label: s, description: 'Scheme' }));
  }

  const scheme = schemePartial;
  const path = pathPart || '';

  const routes = getRoutesForScheme(scheme);
  if (!routes) return [];

  // Check if we're in a query string
  const queryIdx = path.indexOf('?');
  if (queryIdx !== -1) {
    return getRouteQueryCompletions(scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1), routes);
  }

  return getRouteBasedPathCompletions(scheme, path, routes);
}

// ============================================================================
// Route-Table Based Path Completions
// ============================================================================

function getRouteBasedPathCompletions(scheme: string, path: string, routes: RouteTable): Completion[] {
  const completions: Completion[] = [];

  // Split path to find partial segment
  const segments = path.split('/');
  const partialSegment = segments.pop() || '';
  const completePath = segments.join('/');

  // Parse parent path to find current route node
  const parentUri = `${scheme}://${completePath}`;
  const parseResult = parseURIWithRoutes(parentUri, routes);

  if (!parseResult.ok) return [];

  const currentNode = parseResult.route;

  // Get children from route table
  const children = isRootEntry(currentNode.entry)
    ? currentNode.children
    : getRouteChildren(currentNode, routes);

  // Add matching route children
  for (const [name, node] of Object.entries(children)) {
    if (!name.toLowerCase().startsWith(partialSegment.toLowerCase())) continue;

    const entry = node.entry;
    let description: string;
    let suffix = '';

    if (isCollectionEntry(entry)) {
      suffix = '/';
      description = 'Collection';
    } else if (isVirtualPropEntry(entry)) {
      suffix = '/';
      description = entry.accountScoped ? 'Account mailbox' : 'Mailbox';
    } else if (isVirtualCtxEntry(entry)) {
      suffix = '/';
      description = 'Context';
    } else if (isPropertyEntry(entry)) {
      description = `${entry.valueType} property`;
      if (entry.lazy) description += ' (lazy)';
      if (entry.rw) description += ' (rw)';
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

  // If current node is a collection, add addressing options and real item names
  if (isCollectionEntry(currentNode.entry)) {
    const collEntry = currentNode.entry;

    // Add real names from resolved collection (if accessible)
    if (collEntry.addressing.includes('name') || collEntry.addressing.includes('id')) {
      try {
        const resolved = specifierFromURI(parentUri);
        if (resolved.ok && typeof resolved.value.resolve === 'function') {
          const items = resolved.value.resolve();
          if (items.ok && Array.isArray(items.value)) {
            for (const item of items.value.slice(0, 10)) {
              const itemName = item.name;
              if (itemName && String(itemName).toLowerCase().startsWith(partialSegment.toLowerCase())) {
                completions.push({
                  value: encodeURIComponent(String(itemName)),
                  label: String(itemName),
                  description: 'By name',
                });
              }
            }
          }
        }
      } catch { /* ignore resolution errors */ }
    }

    // Add index notation
    if (collEntry.addressing.includes('index')) {
      if (partialSegment.match(/^\[?\d*\]?$/) || completions.length === 0) {
        completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
      }
    }

    // Add query option
    if (partialSegment === '' || partialSegment === '?') {
      completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
    }
  }

  return completions;
}

