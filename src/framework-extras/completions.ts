/// <reference path="../framework/schema.ts" />
/// <reference path="../framework/specifier.ts" />
/// <reference path="../framework/runtime.ts" />
/// <reference path="../framework/uri.ts" />

// ============================================================================
// URI Completions Support
// Autocomplete functionality for partial URIs
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

  // Check if we're in a query string
  const queryIdx = path.indexOf('?');
  if (queryIdx !== -1) {
    return getQueryCompletions(scheme, path.slice(0, queryIdx), path.slice(queryIdx + 1));
  }

  // Path completion
  return getPathCompletions(scheme, path);
}

// ============================================================================
// Path Completions
// ============================================================================

function getPathCompletions(scheme: string, path: string): Completion[] {
  const completions: Completion[] = [];

  // Split path and find the partial segment being typed
  const segments = path.split('/');
  const partialSegment = segments.pop() || '';
  const completePath = segments.join('/');

  // Resolve the parent specifier
  const parentUri = `${scheme}://${completePath}`;
  const parentResult = specifierFromURI(parentUri);
  if (!parentResult.ok) return [];

  const parent = parentResult.value as any;

  // Check if partial matches a property exactly - if so, navigate into it
  if (partialSegment && parent[partialSegment] !== undefined) {
    const child = parent[partialSegment];
    // If it's a collection, suggest addressing
    if (isCollectionForCompletion(child)) {
      return getCollectionCompletions(child, '');
    }
    // If it's a navigable specifier, suggest its properties
    if (child._isSpecifier) {
      return getPropertyCompletions(child, '');
    }
  }

  // Check if parent is a collection - suggest addressing
  if (isCollectionForCompletion(parent)) {
    return getCollectionCompletions(parent, partialSegment);
  }

  // Otherwise suggest properties matching partial
  return getPropertyCompletions(parent, partialSegment);
}

// ============================================================================
// Collection Completions
// ============================================================================

function isCollectionForCompletion(obj: any): boolean {
  return obj && (typeof obj.byName === 'function' || typeof obj.byIndex === 'function' || typeof obj.byId === 'function');
}

function getCollectionCompletions(collection: any, partial: string): Completion[] {
  const completions: Completion[] = [];

  // Favor name-based addressing - resolve and get actual names
  if (typeof collection.byName === 'function') {
    try {
      const resolved = collection.resolve();
      if (resolved.ok && Array.isArray(resolved.value)) {
        for (const item of resolved.value.slice(0, 10)) {
          const name = item.name;
          if (name && String(name).toLowerCase().startsWith(partial.toLowerCase())) {
            completions.push({
              value: encodeURIComponent(String(name)),
              label: String(name),
              description: 'By name'
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // ID addressing if no name addressing
  if (typeof collection.byId === 'function' && typeof collection.byName !== 'function') {
    try {
      const resolved = collection.resolve();
      if (resolved.ok && Array.isArray(resolved.value)) {
        for (const item of resolved.value.slice(0, 10)) {
          const id = item.id;
          if (id && String(id).startsWith(partial)) {
            completions.push({
              value: String(id),
              label: String(id),
              description: 'By ID'
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Index addressing - show if typing bracket or no other completions
  if (typeof collection.byIndex === 'function') {
    if (partial.match(/^\[?\d*\]?$/) || completions.length === 0) {
      completions.push({ value: '[0]', label: '[index]', description: 'Access by index' });
    }
  }

  // Query option
  if (partial === '' || partial === '?') {
    completions.push({ value: '?', label: '?', description: 'Add filter/sort/pagination' });
  }

  return completions;
}

// ============================================================================
// Property Completions
// ============================================================================

function getPropertyCompletions(specifier: any, partial: string): Completion[] {
  const completions: Completion[] = [];

  // Get all enumerable properties
  for (const key of Object.keys(specifier)) {
    if (key.startsWith('_') || key === 'uri' || key === 'resolve') continue;
    if (!key.toLowerCase().startsWith(partial.toLowerCase())) continue;

    const value = specifier[key];
    if (typeof value === 'function') continue;

    if (isCollectionForCompletion(value)) {
      completions.push({ value: `${key}/`, label: key, description: 'Collection' });
    } else if (value && value._isSpecifier && hasNavigableChildren(value)) {
      completions.push({ value: `${key}/`, label: key, description: 'Navigable' });
    } else {
      completions.push({ value: key, label: key, description: 'Property' });
    }
  }

  // Add completions from hooks
  for (const hook of completionHooks) {
    try {
      const extra = hook(specifier, partial);
      for (const c of extra) {
        if (c.label && c.label.toLowerCase().startsWith(partial.toLowerCase())) {
          completions.push(c);
        }
      }
    } catch { /* ignore */ }
  }

  return completions;
}

function hasNavigableChildren(specifier: any): boolean {
  for (const key of Object.keys(specifier)) {
    if (key.startsWith('_') || key === 'uri' || key === 'resolve') continue;
    if (typeof specifier[key] !== 'function') return true;
  }
  return false;
}

// ============================================================================
// Query Completions
// ============================================================================

function getQueryCompletions(scheme: string, basePath: string, query: string): Completion[] {
  const completions: Completion[] = [];

  // Resolve to get the collection and a sample element
  const spec = specifierFromURI(`${scheme}://${basePath}`);
  if (!spec.ok || !isCollectionForCompletion(spec.value)) return [];

  const collection = spec.value;

  // Parse current query
  const params = query.split('&');
  const lastParam = params[params.length - 1] || '';

  // Standard query params
  if (!lastParam.includes('=') || lastParam === '') {
    if ('sort'.startsWith(lastParam)) completions.push({ value: 'sort=', label: 'sort', description: 'Sort results' });
    if ('limit'.startsWith(lastParam)) completions.push({ value: 'limit=', label: 'limit', description: 'Limit count' });
    if ('offset'.startsWith(lastParam)) completions.push({ value: 'offset=', label: 'offset', description: 'Skip N' });
    if ('expand'.startsWith(lastParam)) completions.push({ value: 'expand=', label: 'expand', description: 'Expand lazy props' });
  }

  // Get a sample element to find filterable properties
  let sampleElement: any = null;
  try {
    const resolved = collection.resolve();
    if (resolved.ok && resolved.value.length > 0) {
      sampleElement = resolved.value[0];
    }
  } catch { /* ignore */ }

  if (!sampleElement) return completions;

  // Property name completion for filters
  if (!lastParam.includes('=') && !lastParam.includes('.')) {
    for (const key of Object.keys(sampleElement)) {
      if (key.startsWith('_')) continue;
      const val = sampleElement[key];
      if (typeof val !== 'function' && !isCollectionForCompletion(val) && !(val && val._isSpecifier)) {
        if (key.startsWith(lastParam)) {
          completions.push({ value: `${key}=`, label: key, description: `Filter by ${key}` });
        }
      }
    }
  }

  // Operator completion (property.xxx)
  const dotMatch = lastParam.match(/^(\w+)\.(\w*)$/);
  if (dotMatch) {
    const [, , opPartial] = dotMatch;
    const operators = ['contains', 'startsWith', 'gt', 'lt'];
    for (const op of operators) {
      if (op.startsWith(opPartial)) {
        completions.push({ value: `${dotMatch[1]}.${op}=`, label: op, description: `${op} operator` });
      }
    }
  }

  // Sort value completion
  if (lastParam.startsWith('sort=')) {
    const sortVal = lastParam.slice(5);
    if (!sortVal.includes('.')) {
      for (const key of Object.keys(sampleElement)) {
        if (key.startsWith('_')) continue;
        const val = sampleElement[key];
        if (typeof val !== 'function' && !isCollectionForCompletion(val) && key.startsWith(sortVal)) {
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

  // Expand value completion - find lazy specifier properties
  if (lastParam.startsWith('expand=')) {
    const expandVal = lastParam.slice(7);
    for (const key of Object.keys(sampleElement)) {
      if (key.startsWith('_')) continue;
      const val = sampleElement[key];
      if (val && val._isSpecifier && key.startsWith(expandVal)) {
        completions.push({ value: `expand=${key}`, label: key, description: 'Expand lazy property' });
      }
    }
  }

  return completions;
}
