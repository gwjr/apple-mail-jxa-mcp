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
    // Standard mailboxes (aggregate across accounts)
    { uri: 'mail://inbox', name: 'Inbox', description: 'Combined inbox from all accounts' },
    { uri: 'mail://sent', name: 'Sent', description: 'Combined sent from all accounts' },
    { uri: 'mail://drafts', name: 'Drafts', description: 'Combined drafts from all accounts' },
    { uri: 'mail://trash', name: 'Trash', description: 'Combined trash from all accounts' },
    { uri: 'mail://junk', name: 'Junk', description: 'Combined junk/spam from all accounts' },
    { uri: 'mail://outbox', name: 'Outbox', description: 'Messages waiting to be sent' },
    // Accounts
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

// ============================================================================
// Resource Templates Documentation
// ============================================================================
//
// URI Structure: mail://{path}?{query}
//
// Path Addressing:
//   - By index:  collection[0], collection[1], ...
//   - By name:   collection/MyName (for mailboxes, recipients)
//   - By id:     collection/12345 (for messages)
//
// Query Parameters:
//   Filters (applied server-side when possible):
//     - Exact match:   ?name=Inbox
//     - Greater than:  ?unreadCount.gt=0
//     - Less than:     ?messageSize.lt=1000000
//     - Contains:      ?subject.contains=urgent
//     - Starts with:   ?name.startsWith=Project
//
//   Sorting:
//     - Ascending:     ?sort=name.asc
//     - Descending:    ?sort=dateReceived.desc
//
//   Pagination:
//     - Limit:         ?limit=10
//     - Offset:        ?offset=20
//     - Combined:      ?limit=10&offset=20
//
//   Expand (resolve lazy properties inline):
//     - Single:        ?expand=content
//     - Multiple:      ?expand=content,attachments
//
//   Combined:
//     ?unreadCount.gt=0&sort=unreadCount.desc&limit=10&expand=content
//
// ============================================================================

const resourceTemplates: McpResourceTemplate[] = [
  // --- Standard Mailboxes (aggregate across all accounts) ---
  {
    uriTemplate: 'mail://inbox',
    name: 'All Inboxes',
    description: 'Combined inbox across all accounts. Returns: name, unreadCount, messages'
  },
  {
    uriTemplate: 'mail://inbox/messages',
    name: 'Inbox Messages',
    description: 'Messages from all inboxes'
  },
  {
    uriTemplate: 'mail://inbox/messages?{query}',
    name: 'Filtered Inbox Messages',
    description: 'Filter: ?readStatus=false, ?subject.contains=X. Sort: ?sort=dateReceived.desc. Paginate: ?limit=10&offset=0'
  },
  {
    uriTemplate: 'mail://sent',
    name: 'All Sent',
    description: 'Combined sent mailbox across all accounts'
  },
  {
    uriTemplate: 'mail://drafts',
    name: 'All Drafts',
    description: 'Combined drafts mailbox across all accounts'
  },
  {
    uriTemplate: 'mail://trash',
    name: 'All Trash',
    description: 'Combined trash mailbox across all accounts'
  },
  {
    uriTemplate: 'mail://junk',
    name: 'All Junk',
    description: 'Combined junk/spam mailbox across all accounts'
  },
  {
    uriTemplate: 'mail://outbox',
    name: 'Outbox',
    description: 'Messages waiting to be sent'
  },

  // --- Accounts ---
  {
    uriTemplate: 'mail://accounts',
    name: 'All Accounts',
    description: 'List all mail accounts'
  },
  {
    uriTemplate: 'mail://accounts[{index}]',
    name: 'Account by Index',
    description: 'Single account. Returns: id, name, fullName, emailAddresses'
  },
  {
    uriTemplate: 'mail://accounts/{name}',
    name: 'Account by Name',
    description: 'Single account by name. Example: mail://accounts/iCloud'
  },

  // --- Mailboxes ---
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes',
    name: 'Mailboxes',
    description: 'All mailboxes for an account. Returns: name, unreadCount per mailbox'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}',
    name: 'Mailbox by Name',
    description: 'Single mailbox. Supports nested: /mailboxes/Work/mailboxes/Projects'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes?{query}',
    name: 'Filtered Mailboxes',
    description: 'Filter: ?name=Inbox, ?unreadCount.gt=0. Sort: ?sort=unreadCount.desc'
  },

  // --- Messages ---
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages',
    name: 'Messages',
    description: 'All messages. Returns: id, subject, sender {name, address}, dateSent, readStatus, etc. Content is lazy (use ?expand=content)'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages[{msgIndex}]',
    name: 'Message by Index',
    description: 'Single message by position (0-indexed)'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}',
    name: 'Message by ID',
    description: 'Single message by Mail.app message ID'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages?{query}',
    name: 'Filtered Messages',
    description: 'Filter: ?readStatus=false, ?flaggedStatus=true. Sort: ?sort=dateReceived.desc. Expand: ?expand=content'
  },

  // --- Message Content (Lazy) ---
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/content',
    name: 'Message Content',
    description: 'Full message body text. Fetched separately as it can be large'
  },

  // --- Recipients ---
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/toRecipients',
    name: 'To Recipients',
    description: 'To recipients. Returns: name, address'
  },
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/ccRecipients',
    name: 'CC Recipients',
    description: 'CC recipients. Returns: name, address'
  },

  // --- Attachments ---
  {
    uriTemplate: 'mail://accounts[{index}]/mailboxes/{name}/messages/{id}/attachments',
    name: 'Attachments',
    description: 'Message attachments. Returns: id, name, fileSize'
  }
];

// Export for JXA
(globalThis as any).readResource = readResource;
(globalThis as any).listResources = listResources;
(globalThis as any).resourceTemplates = resourceTemplates;
