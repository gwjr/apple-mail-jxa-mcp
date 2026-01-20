/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../types/mcp.d.ts" />

// ============================================================================
// URI Router for mail:// scheme
// Parses URIs into discriminated union types for exhaustive handling
// ============================================================================

// Encode/decode URI components safely
function encodeURISegment(segment: string): string {
  return encodeURIComponent(segment);
}

function decodeURISegment(segment: string): string {
  return decodeURIComponent(segment);
}

// ============================================================================
// URI Parser
// ============================================================================

function parseMailURI(uri: string): ParsedURI {
  // Must start with mail://
  if (!uri.startsWith('mail://')) {
    return { type: 'unknown', uri };
  }

  const withoutScheme = uri.slice(7); // Remove "mail://"

  // Separate path and query string
  const [pathPart, queryPart] = withoutScheme.split('?');
  const segments = pathPart.split('/').filter(s => s.length > 0);

  // Parse query parameters
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
  }

  // Empty path: mail://
  if (segments.length === 0) {
    return { type: 'unknown', uri };
  }

  // Top-level resources
  const first = segments[0];

  // mail://properties
  if (first === 'properties' && segments.length === 1) {
    return { type: 'properties', uri };
  }

  // mail://rules or mail://rules/{index}
  if (first === 'rules') {
    if (segments.length === 1) {
      return { type: 'rules', uri };
    }
    if (segments.length === 2) {
      const index = parseInt(segments[1], 10);
      if (!isNaN(index) && index >= 0) {
        return { type: 'rules', uri, index };
      }
    }
    return { type: 'unknown', uri };
  }

  // mail://signatures or mail://signatures/{name}
  if (first === 'signatures') {
    if (segments.length === 1) {
      return { type: 'signatures', uri };
    }
    if (segments.length === 2) {
      return { type: 'signatures', uri, name: decodeURISegment(segments[1]) };
    }
    return { type: 'unknown', uri };
  }

  // mail://accounts...
  if (first === 'accounts') {
    // mail://accounts
    if (segments.length === 1) {
      return { type: 'accounts', uri };
    }

    const accountName = decodeURISegment(segments[1]);

    // mail://accounts/{account}
    if (segments.length === 2) {
      return { type: 'account', uri, account: accountName };
    }

    // Parse the rest: alternating /mailboxes/{name} and terminal /messages
    return parseMailboxPath(uri, accountName, segments.slice(2), query);
  }

  return { type: 'unknown', uri };
}

// Parse mailbox path: /mailboxes/{name}/mailboxes/{name}/.../messages/{id}/attachments
function parseMailboxPath(
  uri: string,
  account: string,
  segments: string[],
  query: Record<string, string>
): ParsedURI {
  const path: string[] = [];
  let i = 0;

  while (i < segments.length) {
    const segment = segments[i];

    if (segment === 'mailboxes') {
      // Check if this is terminal (list child mailboxes)
      if (i + 1 >= segments.length) {
        // mail://accounts/{a}/mailboxes (no path yet) - list top-level mailboxes
        if (path.length === 0) {
          return { type: 'account-mailboxes', uri, account };
        }
        // mail://accounts/{a}/mailboxes/{m}/mailboxes - list child mailboxes
        return { type: 'mailbox-mailboxes', uri, account, path };
      }

      // /mailboxes/{name} - add to path
      i++;
      path.push(decodeURISegment(segments[i]));
      i++;
      continue;
    }

    if (segment === 'messages') {
      // Must have at least one mailbox in path
      if (path.length === 0) {
        return { type: 'unknown', uri };
      }

      // mail://accounts/{a}/mailboxes/{m}/messages - list messages
      if (i + 1 >= segments.length) {
        const messageQuery: MessageQuery = {
          limit: parseInt(query['limit'], 10) || 20,
          offset: parseInt(query['offset'], 10) || 0,
          unread: query['unread'] === 'true' ? true : undefined
        };
        return {
          type: 'mailbox-messages',
          uri,
          account,
          path,
          query: messageQuery
        };
      }

      // mail://accounts/{a}/mailboxes/{m}/messages/{id}
      const messageId = parseInt(segments[i + 1], 10);
      if (isNaN(messageId)) {
        return { type: 'unknown', uri };
      }

      // mail://accounts/{a}/mailboxes/{m}/messages/{id}/attachments
      if (i + 2 < segments.length && segments[i + 2] === 'attachments') {
        return {
          type: 'message-attachments',
          uri,
          account,
          path,
          id: messageId
        };
      }

      // Just the message
      if (i + 2 >= segments.length) {
        return {
          type: 'message',
          uri,
          account,
          path,
          id: messageId
        };
      }

      return { type: 'unknown', uri };
    }

    // Unknown segment
    return { type: 'unknown', uri };
  }

  // Ended with a mailbox path but no terminal segment
  if (path.length > 0) {
    return { type: 'mailbox', uri, account, path };
  }

  return { type: 'unknown', uri };
}

// ============================================================================
// URI Builders
// ============================================================================

const URIBuilder = {
  properties(): string {
    return 'mail://properties';
  },

  rules(index?: number): string {
    if (index !== undefined) {
      return `mail://rules/${index}`;
    }
    return 'mail://rules';
  },

  signatures(name?: string): string {
    if (name !== undefined) {
      return `mail://signatures/${encodeURISegment(name)}`;
    }
    return 'mail://signatures';
  },

  accounts(): string {
    return 'mail://accounts';
  },

  account(name: string): string {
    return `mail://accounts/${encodeURISegment(name)}`;
  },

  accountMailboxes(account: string): string {
    return `mail://accounts/${encodeURISegment(account)}/mailboxes`;
  },

  mailbox(account: string, path: string[]): string {
    const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
    return `mail://accounts/${encodeURISegment(account)}/${pathStr}`;
  },

  mailboxMailboxes(account: string, path: string[]): string {
    const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
    return `mail://accounts/${encodeURISegment(account)}/${pathStr}/mailboxes`;
  },

  mailboxMessages(account: string, path: string[], query?: { limit?: number; offset?: number; unread?: boolean }): string {
    const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
    let uri = `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages`;

    const params: string[] = [];
    if (query?.limit !== undefined) params.push(`limit=${query.limit}`);
    if (query?.offset !== undefined) params.push(`offset=${query.offset}`);
    if (query?.unread !== undefined) params.push(`unread=${query.unread}`);
    if (params.length > 0) {
      uri += '?' + params.join('&');
    }

    return uri;
  },

  message(account: string, path: string[], id: number): string {
    const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
    return `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages/${id}`;
  },

  messageAttachments(account: string, path: string[], id: number): string {
    const pathStr = path.map(p => `mailboxes/${encodeURISegment(p)}`).join('/');
    return `mail://accounts/${encodeURISegment(account)}/${pathStr}/messages/${id}/attachments`;
  },

  // Build Apple's message:// URL from RFC 2822 Message-ID
  messageURL(messageId: string): string {
    // Encode special characters for URL
    const encoded = messageId
      .replace(/%/g, '%25')
      .replace(/ /g, '%20')
      .replace(/#/g, '%23');
    return `message://<${encoded}>`;
  }
};
