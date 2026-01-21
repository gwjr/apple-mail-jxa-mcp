/// <reference path="framework/specifier.ts" />
/// <reference path="framework/uri.ts" />
/// <reference path="framework/runtime.ts" />

// ============================================================================
// MCP Tools for Mail.app
// ============================================================================
//
// TODO: This file contains mail-specific code (message move, delete→trash,
// mailbox deletion guard) that should be moved to mail.ts via custom
// operation handlers. The tools here should be generic, with app-specific
// behavior defined via the schema's make/take operations.
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
    const parentUri = segments.slice(0, -1).join('/');
    // Check if parent is addressed by name (not by index like [0])
    const parentLastSegment = segments[segments.length - 2];
    if (parentLastSegment && !parentLastSegment.match(/\[\d+\]$/) && !parentLastSegment.includes('://')) {
      return {
        ok: false,
        error: `Cannot set 'name' when the object is addressed by name. Use index addressing (e.g., [0]) instead.`
      };
    }
  }

  const specResult = specifierFromURI(uri);
  if (!specResult.ok) {
    return { ok: false, error: specResult.error };
  }

  const spec = specResult.value as any;
  if (typeof spec.set !== 'function') {
    return { ok: false, error: `Property at ${uri} is not mutable` };
  }

  const result = spec.set(value);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, value: { uri, updated: true } };
}

// ============================================================================
// Make Tool - Create new objects in collections
// ============================================================================

function toolMake(collectionUri: string, properties: Record<string, any>): ToolResult {
  const specResult = specifierFromURI(collectionUri);
  if (!specResult.ok) {
    return { ok: false, error: specResult.error };
  }

  const spec = specResult.value as any;
  if (typeof spec.create !== 'function') {
    return { ok: false, error: `Collection at ${collectionUri} does not support creating items` };
  }

  const result = spec.create(properties);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, value: result.value };
}

// ============================================================================
// Move Tool - Move objects between collections
// ============================================================================

function toolMove(itemUri: string, destinationCollectionUri: string): ToolResult {
  // Get source item
  const itemResult = specifierFromURI(itemUri);
  if (!itemResult.ok) {
    return { ok: false, error: itemResult.error };
  }

  // Get destination collection
  const destResult = specifierFromURI(destinationCollectionUri);
  if (!destResult.ok) {
    return { ok: false, error: destResult.error };
  }

  const itemSpec = itemResult.value as any;
  const destSpec = destResult.value as any;

  // Check source has _jxa for move operation
  if (!itemSpec._jxa) {
    return { ok: false, error: `Cannot move item at ${itemUri}: no JXA reference` };
  }

  // Check destination supports creation
  if (typeof destSpec.create !== 'function' && !destSpec._jxa) {
    return { ok: false, error: `Destination ${destinationCollectionUri} does not support receiving items` };
  }

  // For messages, use JXA move verb
  if (itemUri.includes('/messages')) {
    try {
      // Get destination mailbox JXA reference
      // The destination should be a mailbox, get its JXA ref
      let destMailbox: any;
      if (destSpec._jxa) {
        // Destination is a collection, need parent mailbox
        destMailbox = destSpec._jxa;
      } else {
        // Parse destination to get mailbox
        const destMailboxUri = destinationCollectionUri.replace(/\/messages$/, '');
        const mailboxResult = specifierFromURI(destMailboxUri);
        if (!mailboxResult.ok) {
          return { ok: false, error: `Cannot find mailbox for ${destinationCollectionUri}` };
        }
        destMailbox = (mailboxResult.value as any)._jxa;
      }

      // Get messageId before move (stable identifier, unlike id which changes)
      const messageId = itemSpec._jxa.messageId();

      // Use JXA move
      itemSpec._jxa.move({ to: destMailbox });

      // Find the moved message in destination by messageId
      // The destination messages collection
      const destMailboxUri = destinationCollectionUri.replace(/\/messages$/, '');
      const destMessagesUri = `${destMailboxUri}/messages`;
      try {
        const movedMessage = destMailbox.messages.whose({ messageId: { _equals: messageId } }).at(0);
        const newId = movedMessage.id();
        return { ok: true, value: { uri: `${destMessagesUri}/${newId}` } };
      } catch {
        // Fallback: return destination collection URI if we can't find the specific message
        return { ok: true, value: { uri: destMessagesUri } };
      }
    } catch (e: any) {
      return { ok: false, error: `Move failed: ${e.message}` };
    }
  }

  // For other objects, would need take + make semantics
  return { ok: false, error: `Move not implemented for this object type` };
}

// ============================================================================
// Delete Tool - Delete objects with mailbox guard and message→trash override
// ============================================================================

function toolDelete(itemUri: string): ToolResult {
  // Guard: Cannot delete mailboxes
  if (itemUri.match(/\/mailboxes\/[^/]+$/) || itemUri.match(/\/mailboxes\[\d+\]$/)) {
    // But allow if it's a message in a mailbox
    if (!itemUri.includes('/messages')) {
      return { ok: false, error: `Cannot delete mailboxes. Use Mail.app directly to manage mailboxes.` };
    }
  }

  const itemResult = specifierFromURI(itemUri);
  if (!itemResult.ok) {
    return { ok: false, error: itemResult.error };
  }

  const itemSpec = itemResult.value as any;
  if (!itemSpec._jxa) {
    return { ok: false, error: `Cannot delete item at ${itemUri}: no JXA reference` };
  }

  // For messages, move to trash instead of deleting
  if (itemUri.includes('/messages')) {
    try {
      // Find the account's trash mailbox
      // Parse URI to find account
      const accountMatch = itemUri.match(/mail:\/\/accounts\[(\d+)\]/);
      let trashMailbox: any;

      if (accountMatch) {
        const accountUri = `mail://accounts[${accountMatch[1]}]`;
        const accountResult = specifierFromURI(accountUri);
        if (accountResult.ok) {
          const accountSpec = accountResult.value as any;
          if (accountSpec._jxa) {
            trashMailbox = accountSpec._jxa.trashMailbox;
          }
        }
      }

      // Fallback to app-level trash
      if (!trashMailbox) {
        const trashResult = specifierFromURI('mail://trash');
        if (trashResult.ok) {
          trashMailbox = (trashResult.value as any)._jxa;
        }
      }

      if (!trashMailbox) {
        return { ok: false, error: `Cannot find trash mailbox` };
      }

      // Move to trash
      itemSpec._jxa.move({ to: trashMailbox });

      return { ok: true, value: { deleted: true, movedToTrash: true, uri: itemUri } };
    } catch (e: any) {
      return { ok: false, error: `Delete (move to trash) failed: ${e.message}` };
    }
  }

  // For other objects, actually delete
  try {
    itemSpec._jxa.delete();
    return { ok: true, value: { deleted: true, uri: itemUri } };
  } catch (e: any) {
    return { ok: false, error: `Delete failed: ${e.message}` };
  }
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
