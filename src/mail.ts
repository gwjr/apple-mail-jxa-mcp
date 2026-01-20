/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />
/// <reference path="./framework/schema.ts" />
/// <reference path="./framework/specifier.ts" />
/// <reference path="./framework/runtime.ts" />
/// <reference path="./framework/uri.ts" />
/// <reference path="./framework-extras/completions.ts" />

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
// Schema Definitions - Using New Simplified Syntax
// ============================================================================

const SettingsSchema = {
  // App info
  name: t.string,
  version: t.string,
  frontmost: t.boolean,
  // Behavior
  alwaysBccMyself: t.boolean,
  alwaysCcMyself: t.boolean,
  downloadHtmlAttachments: t.boolean,
  fetchInterval: t.number,
  expandGroupAddresses: t.boolean,
  // Composing
  defaultMessageFormat: t.string,
  chooseSignatureWhenComposing: t.boolean,
  quoteOriginalMessage: t.boolean,
  sameReplyFormat: t.boolean,
  includeAllOriginalMessageText: t.boolean,
  // Display
  highlightSelectedConversation: t.boolean,
  colorQuotedText: t.boolean,
  levelOneQuotingColor: t.string,
  levelTwoQuotingColor: t.string,
  levelThreeQuotingColor: t.string,
  // Fonts
  messageFont: t.string,
  messageFontSize: t.number,
  messageListFont: t.string,
  messageListFontSize: t.number,
  useFixedWidthFont: t.boolean,
  fixedWidthFont: t.string,
  fixedWidthFontSize: t.number,
  // Sounds
  newMailSound: t.string,
  shouldPlayOtherMailSounds: t.boolean,
  // Spelling
  checkSpellingWhileTyping: t.boolean,
} as const;

const RuleConditionSchema = {
  header: t.string,
  qualifier: t.string,
  ruleType: t.string,
  expression: t.string,
} as const;

const RuleSchema = {
  name: t.string,
  enabled: t.boolean,
  allConditionsMustBeMet: t.boolean,
  deleteMessage: t.boolean,
  markRead: t.boolean,
  markFlagged: t.boolean,
  markFlagIndex: t.number,
  stopEvaluatingRules: t.boolean,
  forwardMessage: t.string,
  redirectMessage: t.string,
  replyText: t.string,
  playSound: t.string,
  highlightTextUsingColor: t.string,
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
  ruleConditions: collection(RuleConditionSchema, [by.index]),
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
  subject: t.string,
  sender: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.sender()))),
  replyTo: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.replyTo()))),
  dateSent: t.date,
  dateReceived: t.date,
  content: lazy(t.string),
  readStatus: t.boolean,
  flaggedStatus: t.boolean,
  junkMailStatus: t.boolean,
  messageSize: t.number,
  toRecipients: collection(RecipientSchema, [by.name, by.index]),
  ccRecipients: collection(RecipientSchema, [by.name, by.index]),
  bccRecipients: collection(RecipientSchema, [by.name, by.index]),
  attachments: jxa(collection(AttachmentSchema, [by.name, by.index, by.id]), 'mailAttachments'),
} as const;

const MailboxSchema: any = {
  name: t.string,
  unreadCount: t.number,
  messages: collection(MessageSchema, [by.index, by.id]),
};
MailboxSchema.mailboxes = collection(MailboxSchema, [by.name, by.index]);

const AccountSchema = {
  id: t.string,
  name: t.string,
  fullName: t.string,
  emailAddresses: t.array(t.string),
  mailboxes: collection(MailboxSchema, [by.name, by.index]),
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
  inbox: standardMailbox('inbox'),
  drafts: standardMailbox('draftsMailbox'),
  junk: standardMailbox('junkMailbox'),
  outbox: standardMailbox('outbox'),
  sent: standardMailbox('sentMailbox'),
  trash: standardMailbox('trashMailbox'),
} as const;

// ============================================================================
// Derived Classes
// ============================================================================

const Settings = createDerived(SettingsSchema, 'Settings');
const RuleCondition = createDerived(RuleConditionSchema, 'RuleCondition');
const Rule = createDerived(RuleSchema, 'Rule');
const Signature = createDerived(SignatureSchema, 'Signature');
const Recipient = createDerived(RecipientSchema, 'Recipient');
const Attachment = createDerived(AttachmentSchema, 'Attachment');
const Message = createDerived(MessageSchema, 'Message');
const Mailbox = createDerived(MailboxSchema, 'Mailbox');
const Account = createDerived(AccountSchema, 'Account');
const MailApp = createDerived(MailAppSchema, 'Mail');
const StandardMailbox = createDerived(StandardMailboxSchema, 'StandardMailbox');

// ============================================================================
// Specifier Helpers
// ============================================================================

function createSchemaSpecifier(uri: string, jxa: any, schema: any, typeName: string): any {
  const DerivedClass = createDerived(schema, typeName);
  const spec: any = {
    _isSpecifier: true, uri,
    resolve: () => tryResolve(() => DerivedClass.fromJXA(jxa, uri), uri),
    fix: () => ({ ok: true, value: spec }),
  };
  for (const [key, descriptor] of Object.entries(schema)) {
    const jxaName = getJxaName(descriptor, key);
    if (descriptor && '_t' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() { return scalarSpec(`${uri}/${key}`, () => jxa[jxaName]() ?? ''); },
        enumerable: true
      });
    } else if (descriptor && '_coll' in (descriptor as any)) {
      const desc = descriptor as any;
      Object.defineProperty(spec, key, {
        get() { return createCollSpec(`${uri}/${key}`, jxa[jxaName], desc._schema, getAddressingModes(desc._addressing), `${typeName}_${key}`, desc._opts); },
        enumerable: true
      });
    }
  }
  return spec;
}

// ============================================================================
// Entry Point
// ============================================================================

let _mailApp: any = null;
function getMailApp() {
  if (_mailApp) return _mailApp;

  const jxa = Application('Mail');
  const app = MailApp.fromJXA(jxa, 'mail://');
  (app as any).uri = 'mail://';
  (app as any)._isSpecifier = true;
  (app as any).resolve = () => ({ ok: true, value: app });

  // Standard mailboxes
  const standardMailboxes = [
    { name: 'inbox', jxaName: 'inbox' },
    { name: 'drafts', jxaName: 'draftsMailbox' },
    { name: 'junk', jxaName: 'junkMailbox' },
    { name: 'outbox', jxaName: 'outbox' },
    { name: 'sent', jxaName: 'sentMailbox' },
    { name: 'trash', jxaName: 'trashMailbox' },
  ];
  for (const { name, jxaName } of standardMailboxes) {
    Object.defineProperty(app, name, {
      get() { return createSchemaSpecifier(`mail://${name}`, jxa[jxaName], StandardMailboxSchema, 'StandardMailbox'); },
      enumerable: true
    });
  }

  // Settings
  Object.defineProperty(app, 'settings', {
    get() { return createSchemaSpecifier('mail://settings', jxa, SettingsSchema, 'Settings'); },
    enumerable: true
  });

  _mailApp = app;
  return _mailApp;
}

registerScheme('mail', getMailApp);

// ============================================================================
// Account Standard Mailbox Navigation
// ============================================================================

const accountStandardMailboxes: Record<string, string> = {
  inbox: 'inbox',
  sent: 'sentMailbox',
  drafts: 'draftsMailbox',
  junk: 'junkMailbox',
  trash: 'trashMailbox',
};

registerCompletionHook((specifier: any, partial: string) => {
  if (!specifier?.uri?.match(/^mail:\/\/accounts\[\d+\]$/)) return [];
  return Object.keys(accountStandardMailboxes)
    .filter(name => name.startsWith(partial.toLowerCase()))
    .map(name => ({ value: `${name}/`, label: name, description: 'Standard mailbox' }));
});

registerNavigationHook((parent: any, name: string, uri: string) => {
  const jxaAppName = accountStandardMailboxes[name];
  if (!jxaAppName || !parent?._isSpecifier) return undefined;
  try {
    const parentResult = parent.resolve();
    if (!parentResult.ok) return undefined;
    const accountId = parentResult.value.id;
    if (!accountId) return undefined;
    const jxa = Application('Mail');
    const appMailbox = jxa[jxaAppName]();
    const accountMailbox = appMailbox.mailboxes().find((m: any) => {
      try { return m.account().id() === accountId; } catch { return false; }
    });
    if (!accountMailbox) return undefined;
    return createSchemaSpecifier(uri, accountMailbox, MailboxSchema, 'Mailbox');
  } catch { return undefined; }
});

// ============================================================================
// Exports
// ============================================================================

(globalThis as any).specifierFromURI = specifierFromURI;
(globalThis as any).getCompletions = getCompletions;
