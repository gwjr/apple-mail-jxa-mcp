/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="cache.ts" />
/// <reference path="collections.ts" />

// ============================================================================
// Message Specifier and Facade
// Lazy navigation with explicit resolution
// ============================================================================

// Forward declaration for mailbox
declare function MailboxSpecifier(jxa: JXAMailbox, accountName: string, path: string[]): MailboxSpecifierType;

// ============================================================================
// Message Specifier
// Holds JXA reference without resolving - navigation is cheap
// ============================================================================

interface MessageSpecifierType {
  readonly _jxa: JXAMessage;
  readonly accountName: string;
  readonly mailboxPath: string[];

  // Lazy accessors (single Apple Event each)
  readonly id: number;
  readonly messageId: string;
  readonly messageUrl: string;

  // Mutable status
  read: boolean;
  flagged: boolean;

  // URI building (no Apple Events)
  uri(): string;

  // Full resolution (multiple Apple Events, returns clean data)
  resolve(): Result<Message>;
  summary(): MessageSummary;
  full(): MessageFull;
  getAttachments(): Attachment[];

  // Cache the message location
  cache(): void;
}

function MessageSpecifier(jxa: JXAMessage, accountName: string, mailboxPath: string[]): MessageSpecifierType {
  // Cache computed values
  let _id: number | null = null;
  let _messageId: string | null = null;

  const self: MessageSpecifierType = {
    _jxa: jxa,
    accountName,
    mailboxPath,

    get id(): number {
      if (_id === null) {
        _id = getOr(() => jxa.id(), 0);
      }
      return _id;
    },

    get messageId(): string {
      if (_messageId === null) {
        _messageId = str(getOr(() => jxa.messageId(), ''));
      }
      return _messageId;
    },

    get messageUrl(): string {
      const mid = self.messageId
        .replace(/%/g, '%25')
        .replace(/ /g, '%20')
        .replace(/#/g, '%23');
      return `message://<${mid}>`;
    },

    get read(): boolean {
      return getOr(() => jxa.readStatus, false);
    },

    set read(value: boolean) {
      jxa.readStatus = value;
    },

    get flagged(): boolean {
      return getOr(() => jxa.flaggedStatus, false);
    },

    set flagged(value: boolean) {
      jxa.flaggedStatus = value;
    },

    uri(): string {
      return URIBuilder.message(accountName, mailboxPath, self.id);
    },

    cache(): void {
      try {
        Cache.store(self.messageId, accountName, mailboxPath.join('/'), self.id);
      } catch {
        // Ignore cache errors
      }
    },

    resolve(): Result<Message> {
      try {
        const id = self.id;
        if (id === 0) {
          return err(`Failed to resolve message in ${accountName}/${mailboxPath.join('/')}: invalid id`);
        }

        const resolveRecipients = (getter: () => JXARecipient[]): Recipient[] => {
          try {
            return getter().map(r => ({
              name: strOrNull(getOr(() => r.name(), null)),
              address: str(getOr(() => r.address(), ''))
            }));
          } catch {
            return [];
          }
        };

        const resolveAttachments = (): Attachment[] => {
          try {
            return jxa.mailAttachments().map((a, i) => ({
              index: i,
              name: str(getOr(() => a.name(), '')),
              mimeType: str(getOr(() => a.mimeType(), 'application/octet-stream')),
              fileSize: getOr(() => a.fileSize(), null),
              downloaded: getOr(() => a.downloaded(), false)
            }));
          } catch {
            return [];
          }
        };

        let dateSent: string | null = null;
        let dateReceived: string | null = null;
        try {
          const ds = jxa.dateSent();
          dateSent = ds ? ds.toISOString() : null;
        } catch { /* ignore */ }
        try {
          const dr = jxa.dateReceived();
          dateReceived = dr ? dr.toISOString() : null;
        } catch { /* ignore */ }

        const message: Message = {
          id,
          messageId: self.messageId,
          subject: strOrNull(getOr(() => jxa.subject(), null)),
          sender: strOrNull(getOr(() => jxa.sender(), null)),
          dateSent,
          dateReceived,
          read: self.read,
          flagged: self.flagged,
          replyTo: strOrNull(getOr(() => jxa.replyTo(), null)),
          content: strOrNull(getOr(() => jxa.content(), null)),
          toRecipients: resolveRecipients(() => jxa.toRecipients()),
          ccRecipients: resolveRecipients(() => jxa.ccRecipients()),
          bccRecipients: resolveRecipients(() => jxa.bccRecipients()),
          attachments: resolveAttachments()
        };

        self.cache();
        return ok(message);
      } catch (e) {
        const err_msg = e instanceof Error ? e.message : String(e);
        return err(`Failed to resolve message in ${accountName}/${mailboxPath.join('/')}: ${err_msg}`);
      }
    },

    summary(): MessageSummary {
      self.cache();

      let dateReceived: string | null = null;
      try {
        const dr = jxa.dateReceived();
        dateReceived = dr ? dr.toISOString() : null;
      } catch { /* ignore */ }

      return {
        id: self.id,
        uri: self.uri(),
        messageUrl: self.messageUrl,
        subject: strOrNull(getOr(() => jxa.subject(), null)),
        sender: strOrNull(getOr(() => jxa.sender(), null)),
        dateReceived,
        read: self.read,
        flagged: self.flagged
      };
    },

    full(): MessageFull {
      self.cache();

      const resolveRecipients = (getter: () => JXARecipient[]): Recipient[] => {
        try {
          return getter().map(r => ({
            name: strOrNull(getOr(() => r.name(), null)),
            address: str(getOr(() => r.address(), ''))
          }));
        } catch {
          return [];
        }
      };

      let dateSent: string | null = null;
      let dateReceived: string | null = null;
      try {
        const ds = jxa.dateSent();
        dateSent = ds ? ds.toISOString() : null;
      } catch { /* ignore */ }
      try {
        const dr = jxa.dateReceived();
        dateReceived = dr ? dr.toISOString() : null;
      } catch { /* ignore */ }

      return {
        id: self.id,
        uri: self.uri(),
        messageUrl: self.messageUrl,
        subject: strOrNull(getOr(() => jxa.subject(), null)),
        sender: strOrNull(getOr(() => jxa.sender(), null)),
        dateReceived,
        dateSent,
        read: self.read,
        flagged: self.flagged,
        replyTo: strOrNull(getOr(() => jxa.replyTo(), null)),
        junk: getOr(() => jxa.junkMailStatus(), null),
        mailbox: mailboxPath.join('/'),
        account: accountName,
        content: strOrNull(getOr(() => jxa.content(), null)),
        toRecipients: resolveRecipients(() => jxa.toRecipients()),
        ccRecipients: resolveRecipients(() => jxa.ccRecipients()),
        attachments: self.getAttachments(),
        attachmentsUri: URIBuilder.messageAttachments(accountName, mailboxPath, self.id)
      };
    },

    getAttachments(): Attachment[] {
      try {
        return jxa.mailAttachments().map((a, i) => ({
          index: i,
          name: str(getOr(() => a.name(), '')),
          mimeType: str(getOr(() => a.mimeType(), 'application/octet-stream')),
          fileSize: getOr(() => a.fileSize(), null),
          downloaded: getOr(() => a.downloaded(), false)
        }));
      } catch {
        return [];
      }
    }
  };

  return self;
}
