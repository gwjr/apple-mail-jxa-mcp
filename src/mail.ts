/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />

// ============================================================================
// Email Address Parsing (JS-based, no extra Apple Events)
// ============================================================================

type ParsedEmailAddress = { name: string; address: string };

function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (!raw) return { name: '', address: '' };

  // Format: "Name" <email@domain.com> or Name <email@domain.com> or just email@domain.com
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  if (match) {
    const name = (match[1] || '').trim();
    const address = (match[2] || '').trim();
    // If no name but we have something that looks like an email, check if address has a name component
    if (!name && address.includes('@')) {
      return { name: '', address };
    }
    // If the "address" doesn't have @, it might just be a name
    if (!address.includes('@')) {
      return { name: address, address: '' };
    }
    return { name, address };
  }
  // Fallback: treat the whole thing as the address
  return { name: '', address: raw.trim() };
}

// ============================================================================
// Apple Mail Schema Definitions
// ============================================================================

const RecipientBase = {
  name: accessor<string, 'name'>('name'),
  address: accessor<string, 'address'>('address'),
} as const;

const AttachmentBase = {
  id: accessor<string, 'id'>('id'),
  name: accessor<string, 'name'>('name'),
  fileSize: accessor<number, 'fileSize'>('fileSize'),
} as const;

const MessageBase = {
  id: accessor<number, 'id'>('id'),
  messageId: accessor<string, 'messageId'>('messageId'),
  subject: accessor<string, 'subject'>('subject'),
  sender: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.sender()))),
  replyTo: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.replyTo()))),
  dateSent: accessor<Date, 'dateSent'>('dateSent'),
  dateReceived: accessor<Date, 'dateReceived'>('dateReceived'),
  content: lazyAccessor<string, 'content'>('content'),  // lazy - expensive to fetch
  readStatus: accessor<boolean, 'readStatus'>('readStatus'),
  flaggedStatus: accessor<boolean, 'flaggedStatus'>('flaggedStatus'),
  junkMailStatus: accessor<boolean, 'junkMailStatus'>('junkMailStatus'),
  messageSize: accessor<number, 'messageSize'>('messageSize'),
  toRecipients: collection('toRecipients', RecipientBase, ['name', 'index'] as const),
  ccRecipients: collection('ccRecipients', RecipientBase, ['name', 'index'] as const),
  bccRecipients: collection('bccRecipients', RecipientBase, ['name', 'index'] as const),
  attachments: collection('mailAttachments', AttachmentBase, ['name', 'index', 'id'] as const),
} as const;

const MailboxBase: any = {
  name: accessor<string, 'name'>('name'),
  unreadCount: accessor<number, 'unreadCount'>('unreadCount'),
  messages: collection('messages', MessageBase, ['index', 'id'] as const)
};
// Self-referential: mailboxes contain mailboxes
MailboxBase.mailboxes = collection('mailboxes', MailboxBase, ['name', 'index'] as const);

const AccountBase = {
  id: accessor<string, 'id'>('id'),
  name: accessor<string, 'name'>('name'),
  fullName: accessor<string, 'fullName'>('fullName'),
  emailAddresses: accessor<string[], 'emailAddresses'>('emailAddresses'),
  mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'] as const)
} as const;

// Standard mailbox schemas (same structure as Mailbox but different accessors)
const StandardMailboxBase = {
  name: accessor<string, 'name'>('name'),
  unreadCount: accessor<number, 'unreadCount'>('unreadCount'),
  messages: collection('messages', MessageBase, ['index', 'id'] as const)
} as const;

const MailAppBase = {
  accounts: collection('accounts', AccountBase, ['name', 'index', 'id'] as const),
  // Standard mailboxes (aggregate across all accounts)
  inbox: { _standardMailbox: true, _jxaName: 'inbox' },
  drafts: { _standardMailbox: true, _jxaName: 'draftsMailbox' },
  junk: { _standardMailbox: true, _jxaName: 'junkMailbox' },
  outbox: { _standardMailbox: true, _jxaName: 'outbox' },
  sent: { _standardMailbox: true, _jxaName: 'sentMailbox' },
  trash: { _standardMailbox: true, _jxaName: 'trashMailbox' }
} as const;

// ============================================================================
// Create Derived Types
// ============================================================================

const Recipient = createDerived(RecipientBase, 'Recipient');
const Attachment = createDerived(AttachmentBase, 'Attachment');
const Message = createDerived(MessageBase, 'Message');
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');

// ============================================================================
// Type Aliases for Export
// ============================================================================

type Recipient = InstanceType<typeof Recipient>;
type Attachment = InstanceType<typeof Attachment>;
type Message = InstanceType<typeof Message>;
type Mailbox = InstanceType<typeof Mailbox>;
type Account = InstanceType<typeof Account>;

// ============================================================================
// Entry Point
// ============================================================================

const MailApp = createDerived(MailAppBase, 'Mail');
type MailApp = InstanceType<typeof MailApp>;

// Create derived type for standard mailboxes
const StandardMailbox = createDerived(StandardMailboxBase, 'StandardMailbox');

// Helper to create standard mailbox specifier
function createStandardMailboxSpecifier(
  uri: string,
  jxaMailbox: any
): any {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve(): Result<any> {
      return tryResolve(() => StandardMailbox.fromJXA(jxaMailbox, uri), uri);
    }
  };

  // Add properties from StandardMailboxBase
  for (const [key, descriptor] of Object.entries(StandardMailboxBase)) {
    if ('_accessor' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxaMailbox[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    } else if ('_collection' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const desc = descriptor as any;
          return createCollectionSpecifier(
            `${uri}/${key}`,
            jxaMailbox[desc._jxaName],
            desc._elementBase,
            desc._addressing,
            'StandardMailbox_' + key
          );
        },
        enumerable: true
      });
    }
  }

  return spec;
}

// Lazily initialized app specifier
let _mailApp: any = null;
function getMailApp() {
  if (!_mailApp) {
    const jxa = Application('Mail');
    const app = MailApp.fromJXA(jxa, 'mail://');
    // Add specifier-like properties
    (app as any).uri = 'mail://';
    (app as any)._isSpecifier = true;
    (app as any).resolve = () => ({ ok: true, value: app });

    // Add standard mailbox specifiers
    const standardMailboxes = [
      { name: 'inbox', jxaName: 'inbox' },
      { name: 'drafts', jxaName: 'draftsMailbox' },
      { name: 'junk', jxaName: 'junkMailbox' },
      { name: 'outbox', jxaName: 'outbox' },
      { name: 'sent', jxaName: 'sentMailbox' },
      { name: 'trash', jxaName: 'trashMailbox' }
    ];

    for (const { name, jxaName } of standardMailboxes) {
      Object.defineProperty(app, name, {
        get() {
          return createStandardMailboxSpecifier(`mail://${name}`, jxa[jxaName]);
        },
        enumerable: true
      });
    }

    _mailApp = app;
  }
  return _mailApp;
}

// Register mail:// scheme
registerScheme('mail', getMailApp);

// Export for JXA
(globalThis as any).specifierFromURI = specifierFromURI;
(globalThis as any).getCompletions = getCompletions;
