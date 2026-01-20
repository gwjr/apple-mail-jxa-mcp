/// <reference path="./types/mcp.d.ts" />

// ============================================================================
// MCP Resource Handler
// ============================================================================

function readResource(uri: string): { mimeType: string; text: string | object } | null {
  const spec = specifierFromURI(uri);
  if (!spec.ok) {
    return { mimeType: 'text/plain', text: spec.error };
  }

  const result = spec.value.resolve();
  if (!result.ok) {
    return { mimeType: 'text/plain', text: result.error };
  }

  return { mimeType: 'application/json', text: result.value };
}

function listResources(): McpResource[] {
  const resources: McpResource[] = [
    { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' }
  ];

  const spec = specifierFromURI('mail://accounts');
  if (spec.ok) {
    const result = spec.value.resolve();
    if (result.ok) {
      for (let i = 0; i < result.value.length; i++) {
        const acc = result.value[i];
        resources.push({
          uri: `mail://accounts[${i}]`,
          name: acc.name,
          description: `Account: ${acc.fullName}`
        });
      }
    }
  }

  return resources;
}

const resourceTemplates: McpResourceTemplate[] = [
  { uriTemplate: 'mail://accounts[{index}]', name: 'Account', description: 'Mail account by index' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes', name: 'Mailboxes', description: 'Mailboxes for an account' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes?{filter}', name: 'Filtered Mailboxes', description: 'Filter: ?name=X, ?unreadCount.gt=0. Sort: ?sort=name.asc' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}', name: 'Mailbox', description: 'Mailbox by name (can be nested: /mailboxes/A/mailboxes/B)' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages', name: 'Messages', description: 'Messages in a mailbox' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages?{filter}', name: 'Filtered Messages', description: 'Filter: ?readStatus=false. Sort: ?sort=dateReceived.desc' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages[{msgIndex}]', name: 'Message', description: 'Single message by index' },
  { uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}', name: 'Message', description: 'Single message by id' }
];

// Export for JXA
(globalThis as any).readResource = readResource;
(globalThis as any).listResources = listResources;
(globalThis as any).resourceTemplates = resourceTemplates;
