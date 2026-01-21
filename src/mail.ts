/// <reference path="./types/jxa.d.ts" />
/// <reference path="./framework/schema.ts" />
/// <reference path="./framework/specifier.ts" />
/// <reference path="./framework/lex.ts" />
/// <reference path="./framework/runtime.ts" />
/// <reference path="./framework/uri.ts" />

// ============================================================================
// Email Address Parsing
// ============================================================================

type ParsedEmailAddress = { name: string; address: string };

function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (!raw) return { name: '', address: '' };
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  if (match) {
    const name = (match[1] || '').trim();
    const address = (match[2] || '').trim();
    if (!name && address.includes('@')) return { name: '', address };
    if (!address.includes('@')) return { name: address, address: '' };
    return { name, address };
  }
  return { name: '', address: raw.trim() };
}

// ============================================================================
// Schema Definitions
// ============================================================================

const SettingsSchema = {
  // App info
  name: t.string,
  version: t.string,
  frontmost: t.boolean,
  // Behavior
  alwaysBccMyself: rw(t.boolean),
  alwaysCcMyself: rw(t.boolean),
  downloadHtmlAttachments: rw(t.boolean),
  fetchInterval: rw(t.number),
  expandGroupAddresses: rw(t.boolean),
  // Composing
  defaultMessageFormat: rw(t.string),
  chooseSignatureWhenComposing: rw(t.boolean),
  quoteOriginalMessage: rw(t.boolean),
  sameReplyFormat: rw(t.boolean),
  includeAllOriginalMessageText: rw(t.boolean),
  // Display
  highlightSelectedConversation: rw(t.boolean),
  colorQuotedText: rw(t.boolean),
  levelOneQuotingColor: rw(t.string),
  levelTwoQuotingColor: rw(t.string),
  levelThreeQuotingColor: rw(t.string),
  // Fonts
  messageFont: rw(t.string),
  messageFontSize: rw(t.number),
  messageListFont: rw(t.string),
  messageListFontSize: rw(t.number),
  useFixedWidthFont: rw(t.boolean),
  fixedWidthFont: rw(t.string),
  fixedWidthFontSize: rw(t.number),
  // Sounds
  newMailSound: rw(t.string),
  shouldPlayOtherMailSounds: rw(t.boolean),
  // Spelling
  checkSpellingWhileTyping: rw(t.boolean),
} as const;

const RuleConditionSchema = {
  header: t.string,
  qualifier: t.string,
  ruleType: t.string,
  expression: t.string,
} as const;

const RuleSchema = {
  name: t.string,
  enabled: rw(t.boolean),
  allConditionsMustBeMet: rw(t.boolean),
  deleteMessage: rw(t.boolean),
  markRead: rw(t.boolean),
  markFlagged: rw(t.boolean),
  markFlagIndex: rw(t.number),
  stopEvaluatingRules: rw(t.boolean),
  forwardMessage: rw(t.string),
  redirectMessage: rw(t.string),
  replyText: rw(t.string),
  playSound: rw(t.string),
  highlightTextUsingColor: rw(t.string),
  copyMessage: computed<string | null>((jxa) => {
    try {
      const mailbox = jxa.copyMessage();
      return mailbox ? mailbox.name() : null;
    } catch {
      return null;
    }
  }),
  moveMessage: computed<string | null>((jxa) => {
    try {
      const mailbox = jxa.moveMessage();
      return mailbox ? mailbox.name() : null;
    } catch {
      return null;
    }
  }),
  ruleConditions: collection(RuleConditionSchema, [by.index], { make: 'unavailable', take: 'unavailable' }),
} as const;

const SignatureSchema = {
  name: t.string,
  content: lazy(t.string),
} as const;

const RecipientSchema = {
  name: t.string,
  address: t.string,
} as const;

const AttachmentSchema = {
  id: t.string,
  name: t.string,
  fileSize: t.number,
} as const;

const MessageSchema = {
  id: t.number,
  messageId: t.string,
  subject: rw(t.string),
  sender: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.sender()))),
  replyTo: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.replyTo()))),
  dateSent: t.date,
  dateReceived: t.date,
  content: lazy(t.string),
  readStatus: rw(t.boolean),
  flaggedStatus: rw(t.boolean),
  junkMailStatus: rw(t.boolean),
  messageSize: t.number,
  toRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
  ccRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
  bccRecipients: collection(RecipientSchema, [by.name, by.index], { make: 'unavailable', take: 'unavailable' }),
  attachments: jxa(collection(AttachmentSchema, [by.name, by.index, by.id], { make: 'unavailable', take: 'unavailable' }), 'mailAttachments'),
} as const;

const MailboxSchema: Schema = {
  name: t.string,
  unreadCount: t.number,
  messages: collection(MessageSchema, [by.index, by.id]),
};
MailboxSchema.mailboxes = collection(MailboxSchema, [by.name, by.index]);

const AccountSchema = {
  id: t.string,
  name: t.string,
  fullName: t.string,
  emailAddresses: computed<string[]>((jxa) => {
    try {
      return jxa.emailAddresses() || [];
    } catch {
      return [];
    }
  }),
  mailboxes: collection(MailboxSchema, [by.name, by.index]),
  // Account-scoped standard mailboxes via computed properties
  inbox: computed((jxa) => jxa.mailbox({ name: 'INBOX' })),
  sent: computed((jxa) => {
    const app = Application('Mail');
    return (app as any).sentMailbox().mailboxes().find((mb: any) => {
      try { return mb.account().id() === jxa.id(); } catch { return false; }
    });
  }),
  drafts: computed((jxa) => {
    const app = Application('Mail');
    return (app as any).draftsMailbox().mailboxes().find((mb: any) => {
      try { return mb.account().id() === jxa.id(); } catch { return false; }
    });
  }),
  junk: computed((jxa) => {
    const app = Application('Mail');
    return (app as any).junkMailbox().mailboxes().find((mb: any) => {
      try { return mb.account().id() === jxa.id(); } catch { return false; }
    });
  }),
  trash: computed((jxa) => {
    const app = Application('Mail');
    return (app as any).trashMailbox().mailboxes().find((mb: any) => {
      try { return mb.account().id() === jxa.id(); } catch { return false; }
    });
  }),
} as const;

const StandardMailboxSchema = {
  name: t.string,
  unreadCount: t.number,
  messages: collection(MessageSchema, [by.index, by.id]),
} as const;

const MailAppSchema = {
  accounts: collection(AccountSchema, [by.name, by.index, by.id]),
  rules: collection(RuleSchema, [by.name, by.index]),
  signatures: collection(SignatureSchema, [by.name, by.index]),
  // Standard mailboxes as computed properties pointing to JXA accessors
  inbox: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.inbox } as ScalarDescriptor,
  drafts: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.draftsMailbox, jxaName: 'draftsMailbox' } as ScalarDescriptor,
  junk: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.junkMailbox, jxaName: 'junkMailbox' } as ScalarDescriptor,
  outbox: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.outbox } as ScalarDescriptor,
  sent: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.sentMailbox, jxaName: 'sentMailbox' } as ScalarDescriptor,
  trash: { dimension: 'scalar', type: StandardMailboxSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa.trashMailbox, jxaName: 'trashMailbox' } as ScalarDescriptor,
  // Settings namespace - properties are directly on app, not in a sub-object
  settings: { dimension: 'scalar', type: SettingsSchema, set: 'unavailable', lazy: false, computed: (jxa: any) => jxa } as ScalarDescriptor,
} as const;

// ============================================================================
// Entry Point
// ============================================================================

let _mailApp: any = null;
function getMailApp() {
  if (_mailApp) return _mailApp;
  _mailApp = Application('Mail');
  return _mailApp;
}

registerScheme('mail', getMailApp, MailAppSchema);

// ============================================================================
// Exports
// ============================================================================

(globalThis as any).specifierFromURI = specifierFromURI;
