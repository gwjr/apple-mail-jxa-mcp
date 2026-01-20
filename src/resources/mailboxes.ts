/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Mailboxes Resource Handler
// Returns mailbox hierarchy for an account
// ============================================================================

interface MailboxSummary {
  name: string;
  uri: string;
  unreadCount: number;
  messagesUri: string;
  mailboxesUri: string;
  hasChildren: boolean;
}

interface AccountMailboxesResponse {
  accountUri: string;
  mailboxes: MailboxSummary[];
}

interface MailboxResponse {
  name: string;
  uri: string;
  unreadCount: number;
  messagesUri: string;
  mailboxesUri: string;
}

interface MailboxChildrenResponse {
  parentUri: string;
  mailboxes: MailboxSummary[];
}

// Read top-level mailboxes for an account
function readAccountMailboxes(accountName: string): { mimeType: string; text: AccountMailboxesResponse } | null {
  const account = Mail.getAccount(accountName);
  if (!account) return null;

  const allMailboxes = account.getAllMailboxes();
  const topLevel = account.getTopLevelMailboxes();

  return {
    mimeType: 'application/json',
    text: {
      accountUri: URIBuilder.account(accountName),
      mailboxes: topLevel.map(mb => {
        const pathParts = mb.path;
        const mbPathStr = pathParts.join('/');
        const hasChildren = allMailboxes.some(other =>
          other.path.join('/').startsWith(mbPathStr + '/')
        );
        return {
          name: mb.name,
          uri: URIBuilder.mailbox(accountName, pathParts),
          unreadCount: mb.unreadCount,
          messagesUri: URIBuilder.mailboxMessages(accountName, pathParts),
          mailboxesUri: URIBuilder.mailboxMailboxes(accountName, pathParts),
          hasChildren
        };
      })
    }
  };
}

// Read a specific mailbox info
function readMailbox(accountName: string, pathParts: string[]): { mimeType: string; text: MailboxResponse } | null {
  const mb = Mail.findMailboxByPath(accountName, pathParts);
  if (!mb) return null;

  return {
    mimeType: 'application/json',
    text: {
      name: mb.name,
      uri: URIBuilder.mailbox(accountName, pathParts),
      unreadCount: mb.unreadCount,
      messagesUri: URIBuilder.mailboxMessages(accountName, pathParts),
      mailboxesUri: URIBuilder.mailboxMailboxes(accountName, pathParts)
    }
  };
}

// Read child mailboxes of a specific mailbox
function readMailboxChildren(accountName: string, pathParts: string[]): { mimeType: string; text: MailboxChildrenResponse } | null {
  const account = Mail.getAccount(accountName);
  if (!account) return null;

  const parentPath = pathParts.join('/');
  const allMailboxes = account.getAllMailboxes();

  // Find direct children (one level deeper)
  const prefix = parentPath + '/';
  const children = allMailboxes.filter(mb => {
    const mbPath = mb.path.join('/');
    if (!mbPath.startsWith(prefix)) return false;
    const remainder = mbPath.slice(prefix.length);
    return !remainder.includes('/'); // Direct child only
  });

  return {
    mimeType: 'application/json',
    text: {
      parentUri: URIBuilder.mailbox(accountName, pathParts),
      mailboxes: children.map(mb => {
        const childPathParts = mb.path;
        const mbPath = childPathParts.join('/');
        const hasChildren = allMailboxes.some(other =>
          other.path.join('/').startsWith(mbPath + '/')
        );
        return {
          name: mb.name,
          uri: URIBuilder.mailbox(accountName, childPathParts),
          unreadCount: mb.unreadCount,
          messagesUri: URIBuilder.mailboxMessages(accountName, childPathParts),
          mailboxesUri: URIBuilder.mailboxMailboxes(accountName, childPathParts),
          hasChildren
        };
      })
    }
  };
}
