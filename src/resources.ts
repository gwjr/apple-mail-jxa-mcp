/// <reference path="./types/mcp.d.ts" />

// ============================================================================
// MCP Resource Handler
// ============================================================================

const DEFAULT_COLLECTION_LIMIT = 20;
const MAX_COLLECTION_LIMIT = 100;

function readResource(uri: URL): ReadResourceResult {
  const resResult = resolveURI(uri.href);
  if (!resResult.ok) {
    return { ok: false, error: `URI resolution failed: ${resResult.error}` };
  }

  const res = resResult.value;

  try {
    let data = res.resolve();

    // Get the canonical URI from the delegate
    const canonicalUri = res._delegate.uri();
    const fixedUri = canonicalUri.href !== uri.href ? canonicalUri : undefined;

    // Protect against returning huge collections
    if (Array.isArray(data)) {
      const queryState = res._delegate.queryState();
      const requestedLimit = queryState.pagination?.limit;
      const requestedOffset = queryState.pagination?.offset ?? 0;

      // Use requested limit (capped at max) or default
      const effectiveLimit = requestedLimit
        ? Math.min(requestedLimit, MAX_COLLECTION_LIMIT)
        : DEFAULT_COLLECTION_LIMIT;

      if (data.length > effectiveLimit) {
        const totalCount = data.length;
        const baseUri = (fixedUri || canonicalUri).href.split('?')[0];
        const nextOffset = requestedOffset + effectiveLimit;
        const nextUri = `${baseUri}?limit=${effectiveLimit}&offset=${nextOffset}`;

        return {
          ok: true,
          mimeType: 'application/json',
          text: {
            _pagination: {
              total: totalCount,
              returned: effectiveLimit,
              offset: requestedOffset,
              limit: effectiveLimit,
              next: nextOffset < totalCount ? nextUri : null
            },
            items: data.slice(0, effectiveLimit)
          },
          fixedUri
        };
      }
    }

    // Add _uri to the result if it's an object
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      (data as any)._uri = (fixedUri || uri).href;
    }

    return { ok: true, mimeType: 'application/json', text: data, fixedUri };
  } catch (e: any) {
    const errorMessage = e.message || String(e);
    return { ok: false, error: `JXA error: ${errorMessage}` };
  }
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
    { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' },
    // Rules, Signatures, Settings
    { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
    { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' },
    { uri: 'mail://settings', name: 'Settings', description: 'Mail.app preferences' }
  ];

  const resResult = resolveURI('mail://accounts');
  if (resResult.ok) {
    try {
      const specifiers = resResult.value.resolve() as any[];
      for (let i = 0; i < specifiers.length; i++) {
        const acc = resResult.value.byIndex(i).resolve() as any;
        resources.push({
          uri: `mail://accounts/${encodeURIComponent(acc.id)}`,
          name: acc.fullName,
          description: acc.userName  // email address
        });
      }
    } catch {
      // Silently ignore if we can't resolve accounts
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

  // --- Account Standard Mailboxes ---
  {
    uriTemplate: 'mail://accounts[{index}]/inbox',
    name: 'Account Inbox',
    description: "The account's inbox mailbox"
  },
  {
    uriTemplate: 'mail://accounts[{index}]/sent',
    name: 'Account Sent',
    description: "The account's sent mailbox"
  },
  {
    uriTemplate: 'mail://accounts[{index}]/drafts',
    name: 'Account Drafts',
    description: "The account's drafts mailbox"
  },
  {
    uriTemplate: 'mail://accounts[{index}]/junk',
    name: 'Account Junk',
    description: "The account's junk/spam mailbox"
  },
  {
    uriTemplate: 'mail://accounts[{index}]/trash',
    name: 'Account Trash',
    description: "The account's trash/deleted items mailbox"
  },
  {
    uriTemplate: 'mail://accounts[{index}]/inbox/messages?{query}',
    name: 'Account Inbox Messages',
    description: "Messages in the account's inbox. Supports filter/sort/pagination"
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
  },

  // --- Rules ---
  {
    uriTemplate: 'mail://rules',
    name: 'All Rules',
    description: 'List all mail filtering rules'
  },
  {
    uriTemplate: 'mail://rules[{index}]',
    name: 'Rule by Index',
    description: 'Single rule. Returns: name, enabled, conditions, actions'
  },
  {
    uriTemplate: 'mail://rules/{name}',
    name: 'Rule by Name',
    description: 'Single rule by name'
  },
  {
    uriTemplate: 'mail://rules[{index}]/ruleConditions',
    name: 'Rule Conditions',
    description: 'Conditions for a rule. Returns: header, qualifier, ruleType, expression'
  },

  // --- Signatures ---
  {
    uriTemplate: 'mail://signatures',
    name: 'All Signatures',
    description: 'List all email signatures'
  },
  {
    uriTemplate: 'mail://signatures[{index}]',
    name: 'Signature by Index',
    description: 'Single signature by position'
  },
  {
    uriTemplate: 'mail://signatures/{name}',
    name: 'Signature by Name',
    description: 'Single signature by name. Returns: name, content (lazy)'
  },

  // --- Settings ---
  {
    uriTemplate: 'mail://settings',
    name: 'Settings',
    description: 'Mail.app preferences: fonts, colors, behavior, composing options'
  },
  {
    uriTemplate: 'mail://settings/{property}',
    name: 'Setting Property',
    description: 'Individual setting value (e.g., mail://settings/fetchInterval)'
  }
];

// Export for JXA
(globalThis as any).readResource = readResource;
(globalThis as any).listResources = listResources;
(globalThis as any).resourceTemplates = resourceTemplates;
