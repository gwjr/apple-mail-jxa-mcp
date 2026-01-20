/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />
/// <reference path="properties.ts" />
/// <reference path="rules.ts" />
/// <reference path="signatures.ts" />
/// <reference path="accounts.ts" />
/// <reference path="mailboxes.ts" />
/// <reference path="messages.ts" />

// ============================================================================
// Resource Registry
// Provides resource lister and reader for the MCP server
// ============================================================================

// List all top-level resources
function listResources(): McpResource[] {
  const resources: McpResource[] = [
    { uri: 'mail://properties', name: 'App Properties', description: 'Mail.app settings and properties' },
    { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
    { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' },
    { uri: 'mail://accounts', name: 'Accounts', description: 'Mail accounts' }
  ];

  // Add individual accounts
  const accounts = Mail.getAccounts();
  for (const acc of accounts) {
    resources.push({
      uri: URIBuilder.account(acc.name),
      name: acc.name,
      description: 'Mail account'
    });
  }

  return resources;
}

// Read a resource by URI
function readResource(uri: string): { mimeType: string; text: string | object } | null {
  const parsed = parseMailURI(uri);

  switch (parsed.type) {
    case 'properties':
      return readProperties();

    case 'rules':
      if (parsed.index !== undefined) {
        return readRule(parsed.index);
      }
      return readRulesList();

    case 'signatures':
      if (parsed.name !== undefined) {
        return readSignature(parsed.name);
      }
      return readSignaturesList();

    case 'accounts':
      return readAccountsList();

    case 'account':
      return readAccount(parsed.account);

    case 'account-mailboxes':
      return readAccountMailboxes(parsed.account);

    case 'mailbox':
      return readMailbox(parsed.account, parsed.path);

    case 'mailbox-mailboxes':
      return readMailboxChildren(parsed.account, parsed.path);

    case 'mailbox-messages':
      return readMailboxMessages(parsed.account, parsed.path, parsed.query);

    case 'message':
      return readMessage(parsed.account, parsed.path, parsed.id);

    case 'message-attachments':
      return readMessageAttachments(parsed.account, parsed.path, parsed.id);

    case 'unknown':
    default:
      return null;
  }
}

// Resource templates for discovery
const resourceTemplates: McpResourceTemplate[] = [
  {
    uriTemplate: 'mail://accounts/{account}',
    name: 'Account',
    description: 'Mail account details'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes',
    name: 'Account Mailboxes',
    description: 'Top-level mailboxes for an account'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}',
    name: 'Mailbox',
    description: 'Mailbox info (path is slash-separated for nested mailboxes)'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/mailboxes',
    name: 'Child Mailboxes',
    description: 'Child mailboxes of a mailbox'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages',
    name: 'Messages',
    description: 'Messages in a mailbox'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages?limit={limit}&offset={offset}',
    name: 'Paginated Messages',
    description: 'Messages with pagination'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages?unread=true',
    name: 'Unread Messages',
    description: 'Only unread messages'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages/{id}',
    name: 'Message',
    description: 'Full message details'
  },
  {
    uriTemplate: 'mail://accounts/{account}/mailboxes/{+path}/messages/{id}/attachments',
    name: 'Attachments',
    description: 'Message attachments list'
  },
  {
    uriTemplate: 'mail://rules/{index}',
    name: 'Rule',
    description: 'Individual mail rule details'
  },
  {
    uriTemplate: 'mail://signatures/{name}',
    name: 'Signature',
    description: 'Individual signature content'
  }
];
