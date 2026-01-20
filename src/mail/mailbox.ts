/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="cache.ts" />
/// <reference path="collections.ts" />
/// <reference path="message.ts" />

// ============================================================================
// Mailbox Specifier and Collection
// Lazy navigation with explicit resolution
// ============================================================================

interface MessageListOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

// ============================================================================
// Mailbox Specifier
// Holds JXA reference without resolving - navigation is cheap
// ============================================================================

interface MailboxSpecifierType {
  readonly _jxa: JXAMailbox;
  readonly accountName: string;
  readonly path: string[];

  // Lazy accessors
  readonly name: string;
  readonly unreadCount: number;

  // URI building (no Apple Events)
  uri(): string;

  // Resolution
  resolve(): Result<Mailbox>;
  info(): MailboxInfo;
  infoWithChildren(hasChildren: boolean): MailboxWithChildren;

  // Message access (efficient index-based iteration)
  getMessages(opts?: MessageListOptions): MessageSpecifierType[];
  getMessageById(id: number): MessageSpecifierType | null;
  searchByMessageId(messageId: string): MessageSpecifierType | null;

  // Child mailbox access
  getChildMailboxes(): MailboxSpecifierType[];
}

function MailboxSpecifier(jxa: JXAMailbox, accountName: string, path: string[]): MailboxSpecifierType {
  const self: MailboxSpecifierType = {
    _jxa: jxa,
    accountName,
    path,

    get name(): string {
      return str(getOr(() => jxa.name(), ''));
    },

    get unreadCount(): number {
      return getOr(() => jxa.unreadCount(), 0);
    },

    uri(): string {
      return URIBuilder.mailbox(accountName, path);
    },

    resolve(): Result<Mailbox> {
      try {
        const mailbox: Mailbox = {
          name: self.name,
          unreadCount: self.unreadCount
        };
        return ok(mailbox);
      } catch (e) {
        const err_msg = e instanceof Error ? e.message : String(e);
        return err(`Failed to resolve mailbox ${path.join('/')} in ${accountName}: ${err_msg}`);
      }
    },

    info(): MailboxInfo {
      return {
        name: self.name,
        uri: self.uri(),
        unreadCount: self.unreadCount,
        messagesUri: URIBuilder.mailboxMessages(accountName, path),
        mailboxesUri: URIBuilder.mailboxMailboxes(accountName, path)
      };
    },

    infoWithChildren(hasChildren: boolean): MailboxWithChildren {
      return {
        ...self.info(),
        hasChildren
      };
    },

    // Efficient message access - uses index-based iteration to avoid N+1
    getMessages(opts?: MessageListOptions): MessageSpecifierType[] {
      const options = opts ?? {};
      const limit = options.limit ?? 20;
      const offset = options.offset ?? 0;
      const unreadOnly = options.unreadOnly ?? false;

      const result: MessageSpecifierType[] = [];

      // If filtering by unread, use whose() clause
      if (unreadOnly) {
        try {
          const unreadMsgs = jxa.messages.whose({ readStatus: { _equals: false } })();
          const startIdx = offset;
          const endIdx = Math.min(offset + limit, unreadMsgs.length);
          for (let i = startIdx; i < endIdx; i++) {
            try {
              result.push(MessageSpecifier(unreadMsgs[i], accountName, path));
            } catch {
              // Skip messages that fail to load
            }
          }
          return result;
        } catch {
          return [];
        }
      }

      // For all messages, use index-based access to avoid loading all
      let index = 0;
      let collected = 0;

      try {
        while (collected < limit) {
          try {
            const msg = jxa.messages.at(index);
            // Verify the message exists by accessing a property
            msg.id();

            if (index >= offset) {
              result.push(MessageSpecifier(msg, accountName, path));
              collected++;
            }
            index++;
          } catch {
            // No more messages or error accessing this index
            break;
          }
        }
        return result;
      } catch {
        return [];
      }
    },

    getMessageById(id: number): MessageSpecifierType | null {
      try {
        const msg = jxa.messages.byId(id);
        // Verify it exists
        msg.id();
        return MessageSpecifier(msg, accountName, path);
      } catch {
        return null;
      }
    },

    searchByMessageId(messageId: string): MessageSpecifierType | null {
      try {
        const found = jxa.messages.whose({ messageId: { _equals: messageId } })();
        return found.length > 0 ? MessageSpecifier(found[0], accountName, path) : null;
      } catch {
        return null;
      }
    },

    getChildMailboxes(): MailboxSpecifierType[] {
      try {
        return jxa.mailboxes().map((m: JXAMailbox) => {
          const childName = str(getOr(() => m.name(), ''));
          return MailboxSpecifier(m, accountName, [...path, childName]);
        });
      } catch {
        return [];
      }
    }
  };

  return self;
}
