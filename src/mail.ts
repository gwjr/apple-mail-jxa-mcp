/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />

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
  sender: accessor<string, 'sender'>('sender'),
  replyTo: accessor<string, 'replyTo'>('replyTo'),
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

const MailAppBase = {
  accounts: collection('accounts', AccountBase, ['name', 'index', 'id'] as const)
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
    _mailApp = app;
  }
  return _mailApp;
}

// Register mail:// scheme
registerScheme('mail', getMailApp);

// Export for JXA
(globalThis as any).specifierFromURI = specifierFromURI;
