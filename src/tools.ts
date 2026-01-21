/// <reference path="framework.ts" />

// ============================================================================
// MCP Tools for Mail.app
// ============================================================================
//
// Generic tools that work with the framework. Domain-specific behavior
// (e.g., message move, delete→trash) is handled by custom handlers in mail.ts.
//

type ToolResult = { ok: true; value: any } | { ok: false; error: string };

// ============================================================================
// Set Tool - Modify scalar values
// ============================================================================

function toolSet(uri: string, value: any): ToolResult {
  // Guard: Detect if URI uses name addressing for the item being modified
  // If so, and we're setting 'name', this would break the reference
  const segments = uri.split('/');
  const lastSegment = segments[segments.length - 1];

  // Check if parent uses name addressing and we're setting 'name'
  if (lastSegment === 'name') {
    const parentLastSegment = segments[segments.length - 2];
    if (parentLastSegment && !parentLastSegment.match(/\[\d+\]$/) && !parentLastSegment.includes('://')) {
      return {
        ok: false,
        error: `Cannot set 'name' when the object is addressed by name. Use index addressing (e.g., [0]) instead.`
      };
    }
  }

  const resResult = resolveURI(uri);
  if (!resResult.ok) {
    return { ok: false, error: resResult.error };
  }

  const res = resResult.value as any;

  // Check if the proto has a set method (added by withSet)
  if (typeof res.set !== 'function') {
    return { ok: false, error: `Property at ${uri} is not mutable` };
  }

  try {
    res.set(value);
    return { ok: true, value: { uri, updated: true } };
  } catch (e: any) {
    return { ok: false, error: `Set failed: ${e.message || e}` };
  }
}

// ============================================================================
// Make Tool - Create new objects in collections
// ============================================================================

function toolMake(collectionUri: string, properties: Record<string, any>): ToolResult {
  const resResult = resolveURI(collectionUri);
  if (!resResult.ok) {
    return { ok: false, error: resResult.error };
  }

  const res = resResult.value as any;

  // Check if proto has create method (from withCreate) or use delegate
  if (typeof res.create === 'function') {
    const result = res.create(properties);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, value: { uri: result.value._delegate.uri().href } };
  }

  // Fall back to delegate create
  const createResult = res._delegate.create(properties);
  if (!createResult.ok) {
    return { ok: false, error: createResult.error };
  }

  return { ok: true, value: { uri: createResult.value.href } };
}

// ============================================================================
// Move Tool - Move objects between collections
// ============================================================================

function toolMove(itemUri: string, destinationCollectionUri: string): ToolResult {
  // Guard: Cannot move mailboxes
  if (itemUri.match(/\/mailboxes\/[^/]+$/) || itemUri.match(/\/mailboxes\[\d+\]$/)) {
    if (!itemUri.includes('/messages')) {
      return { ok: false, error: `Cannot move mailboxes. Use Mail.app directly to manage mailboxes.` };
    }
  }

  // Get source item
  const itemResult = resolveURI(itemUri);
  if (!itemResult.ok) {
    return { ok: false, error: itemResult.error };
  }

  // Get destination collection
  const destResult = resolveURI(destinationCollectionUri);
  if (!destResult.ok) {
    return { ok: false, error: destResult.error };
  }

  const item = itemResult.value as any;
  const dest = destResult.value as any;

  // Check if item has move method (from withMove)
  if (typeof item.move === 'function') {
    const moveResult = item.move(dest);
    if (!moveResult.ok) {
      return { ok: false, error: moveResult.error };
    }
    return { ok: true, value: { uri: moveResult.value._delegate.uri().href } };
  }

  // Fall back to delegate moveTo
  const moveResult = item._delegate.moveTo(dest._delegate);
  if (!moveResult.ok) {
    return { ok: false, error: moveResult.error };
  }

  return { ok: true, value: { uri: moveResult.value.href } };
}

// ============================================================================
// Delete Tool - Delete objects with mailbox guard
// ============================================================================

function toolDelete(itemUri: string): ToolResult {
  // Guard: Cannot delete mailboxes
  if (itemUri.match(/\/mailboxes\/[^/]+$/) || itemUri.match(/\/mailboxes\[\d+\]$/)) {
    if (!itemUri.includes('/messages')) {
      return { ok: false, error: `Cannot delete mailboxes. Use Mail.app directly to manage mailboxes.` };
    }
  }

  const itemResult = resolveURI(itemUri);
  if (!itemResult.ok) {
    return { ok: false, error: itemResult.error };
  }

  const item = itemResult.value as any;

  // Check if item has delete method (from withDelete)
  if (typeof item.delete === 'function') {
    const deleteResult = item.delete();
    if (!deleteResult.ok) {
      return { ok: false, error: deleteResult.error };
    }
    return { ok: true, value: { deleted: true, uri: itemUri } };
  }

  // Fall back to delegate delete
  const deleteResult = item._delegate.delete();
  if (!deleteResult.ok) {
    return { ok: false, error: deleteResult.error };
  }

  return { ok: true, value: { deleted: true, uri: itemUri } };
}

// ============================================================================
// Tool Registration Helper
// ============================================================================

function registerMailTools(server: MCPServer): void {
  server.addTool({
    name: 'set',
    description: 'Set a scalar property value. Use URI to specify the property (e.g., mail://rules[0]/enabled).',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'URI of the property to set' },
        value: { description: 'New value for the property' }
      },
      required: ['uri', 'value']
    },
    handler: (args: Record<string, unknown>) => {
      const result = toolSet(args.uri as string, args.value);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
    }
  });

  server.addTool({
    name: 'make',
    description: 'Create a new object in a collection (e.g., new rule, signature).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'URI of the collection (e.g., mail://rules)' },
        properties: { type: 'object', description: 'Properties for the new object' }
      },
      required: ['collection', 'properties']
    },
    handler: (args: Record<string, unknown>) => {
      const result = toolMake(args.collection as string, args.properties as Record<string, any>);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
    }
  });

  server.addTool({
    name: 'move',
    description: 'Move an object to a different collection (e.g., move message to another mailbox).',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'URI of the item to move' },
        destination: { type: 'string', description: 'URI of the destination collection' }
      },
      required: ['item', 'destination']
    },
    handler: (args: Record<string, unknown>) => {
      const result = toolMove(args.item as string, args.destination as string);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
    }
  });

  server.addTool({
    name: 'delete',
    description: 'Delete an object. Messages are moved to trash. Mailbox deletion is blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'URI of the item to delete' }
      },
      required: ['item']
    },
    handler: (args: Record<string, unknown>) => {
      const result = toolDelete(args.item as string);
      if (!result.ok) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
    }
  });
}

// Export for use in main.ts
(globalThis as any).registerMailTools = registerMailTools;
