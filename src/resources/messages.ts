/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="../mail/collections.ts" />
/// <reference path="../mail/app.ts" />

// ============================================================================
// Messages Resource Handler
// Returns message listings and individual message details
// ============================================================================

// Read message listing for a mailbox
function readMailboxMessages(
  accountName: string,
  pathParts: string[],
  query: MessageQuery
): { mimeType: string; text: MessageListResponse } | null {
  const mb = Mail.findMailboxByPath(accountName, pathParts);
  if (!mb) return null;

  const messages = mb.getMessages({
    limit: query.limit,
    offset: query.offset,
    unreadOnly: query.unread
  });

  return {
    mimeType: 'application/json',
    text: {
      mailboxUri: URIBuilder.mailbox(accountName, pathParts),
      limit: query.limit,
      offset: query.offset,
      unread: query.unread,
      messages: messages.map(msg => msg.summary())
    }
  };
}

// Read a single message by ID
function readMessage(
  accountName: string,
  pathParts: string[],
  messageId: number
): { mimeType: string; text: MessageFull } | null {
  const msg = Mail.findMessageById(accountName, pathParts, messageId);
  if (!msg) return null;

  return {
    mimeType: 'application/json',
    text: msg.full()
  };
}

// Read message attachments
function readMessageAttachments(
  accountName: string,
  pathParts: string[],
  messageId: number
): { mimeType: string; text: AttachmentsResponse } | null {
  const msg = Mail.findMessageById(accountName, pathParts, messageId);
  if (!msg) return null;

  return {
    mimeType: 'application/json',
    text: {
      messageUri: URIBuilder.message(accountName, pathParts, messageId),
      attachments: msg.getAttachments()
    }
  };
}
