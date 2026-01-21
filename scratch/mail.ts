// scratch/mail.ts - Mail.app Schema
//
// Uses framework.ts building blocks. No framework code here.

// ─────────────────────────────────────────────────────────────────────────────
// App-specific utilities
// ─────────────────────────────────────────────────────────────────────────────

type ParsedEmailAddress = { name: string; address: string };

// Extract mailbox name from JXA mailbox object (used for rule actions)
function extractMailboxName(mailbox: any): string | null {
  try {
    return mailbox ? mailbox.name() : null;
  } catch {
    return null;
  }
}

function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (!raw) return { name: '', address: '' };
  // Plain email address (no angle brackets)
  if (!raw.includes('<') && raw.includes('@')) {
    return { name: '', address: raw.trim() };
  }
  // Format: "Name" <email> or Name <email>
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    const name = (match[1] || '').trim();
    const address = (match[2] || '').trim();
    return { name, address };
  }
  return { name: '', address: raw.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail Schema - prototype composition
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RuleCondition proto
// ─────────────────────────────────────────────────────────────────────────────

const RuleConditionProto = {
  ...baseScalar,
  header: eagerScalar,
  qualifier: eagerScalar,
  ruleType: eagerScalar,
  expression: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule proto
// ─────────────────────────────────────────────────────────────────────────────

const RuleProto = {
  ...baseScalar,
  name: eagerScalar,
  enabled: withSet(baseScalar),
  allConditionsMustBeMet: withSet(baseScalar),
  deleteMessage: withSet(baseScalar),
  markRead: withSet(baseScalar),
  markFlagged: withSet(baseScalar),
  markFlagIndex: withSet(baseScalar),
  stopEvaluatingRules: withSet(baseScalar),
  forwardMessage: withSet(baseScalar),
  redirectMessage: withSet(baseScalar),
  replyText: withSet(baseScalar),
  playSound: withSet(baseScalar),
  highlightTextUsingColor: withSet(baseScalar),
  // copyMessage/moveMessage return the destination mailbox name (or null)
  copyMessage: computed<string | null>(extractMailboxName),
  moveMessage: computed<string | null>(extractMailboxName),
  ruleConditions: pipe(baseCollection, withByIndex(RuleConditionProto)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Signature proto
// ─────────────────────────────────────────────────────────────────────────────

const SignatureProto = {
  ...baseScalar,
  name: eagerScalar,
  content: makeLazy(baseScalar),
};

// ─────────────────────────────────────────────────────────────────────────────
// Recipient proto
// ─────────────────────────────────────────────────────────────────────────────

const RecipientProto = {
  ...baseScalar,
  name: eagerScalar,
  address: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Attachment proto
// ─────────────────────────────────────────────────────────────────────────────

const AttachmentProto = {
  ...baseScalar,
  id: eagerScalar,
  name: eagerScalar,
  fileSize: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Message proto
// ─────────────────────────────────────────────────────────────────────────────

const MessageProto = {
  ...baseScalar,
  id: eagerScalar,
  messageId: eagerScalar,
  subject: withSet(baseScalar),
  sender: computed<ParsedEmailAddress>(parseEmailAddress),
  replyTo: computed<ParsedEmailAddress>(parseEmailAddress),
  dateSent: eagerScalar,
  dateReceived: eagerScalar,
  content: makeLazy(baseScalar),
  readStatus: withSet(baseScalar),
  flaggedStatus: withSet(baseScalar),
  junkMailStatus: withSet(baseScalar),
  messageSize: eagerScalar,
  toRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  ccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  bccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  attachments: withJxaName(
    pipe3(baseCollection, withByIndex(AttachmentProto), withByName(AttachmentProto), withById(AttachmentProto)),
    'mailAttachments'
  ),
};

const LazyMessageProto = makeLazy(MessageProto);

// ─────────────────────────────────────────────────────────────────────────────
// Mailbox proto (recursive - interface required for self-reference)
// ─────────────────────────────────────────────────────────────────────────────

interface MailboxProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  unreadCount: typeof eagerScalar;
  messages: BaseProtoType & ByIndexProto<typeof LazyMessageProto> & ByIdProto<typeof LazyMessageProto>;
  mailboxes: BaseProtoType & ByIndexProto<MailboxProtoType> & ByNameProto<MailboxProtoType>;
}

const MailboxProto: MailboxProtoType = {
  ...baseScalar,
  name: eagerScalar,
  unreadCount: eagerScalar,
  messages: pipe2(baseCollection, withByIndex(LazyMessageProto), withById(LazyMessageProto)),
  mailboxes: null as any,
};

MailboxProto.mailboxes = pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto));

// ─────────────────────────────────────────────────────────────────────────────
// Account proto
// ─────────────────────────────────────────────────────────────────────────────

const MailAccountProto = {
  ...baseScalar,
  id: eagerScalar,
  name: eagerScalar,
  fullName: eagerScalar,
  emailAddresses: eagerScalar,  // Returns string[] of account's email addresses
  mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
  // Account inbox navigates to mailboxes.byName('INBOX')
  inbox: computedNav((d) => d.prop('mailboxes').byName('INBOX'), MailboxProto),
};

// ─────────────────────────────────────────────────────────────────────────────
// Settings proto (namespace for app-level preferences)
// ─────────────────────────────────────────────────────────────────────────────

const MailSettingsProto = {
  ...baseScalar,
  // App info (read-only)
  name: eagerScalar,
  version: eagerScalar,
  frontmost: eagerScalar,
  // Behavior
  alwaysBccMyself: withSet(baseScalar),
  alwaysCcMyself: withSet(baseScalar),
  downloadHtmlAttachments: withSet(baseScalar),
  fetchInterval: withSet(baseScalar),
  expandGroupAddresses: withSet(baseScalar),
  // Composing
  defaultMessageFormat: withSet(baseScalar),
  chooseSignatureWhenComposing: withSet(baseScalar),
  quoteOriginalMessage: withSet(baseScalar),
  sameReplyFormat: withSet(baseScalar),
  includeAllOriginalMessageText: withSet(baseScalar),
  // Display
  highlightSelectedConversation: withSet(baseScalar),
  colorQuotedText: withSet(baseScalar),
  levelOneQuotingColor: withSet(baseScalar),
  levelTwoQuotingColor: withSet(baseScalar),
  levelThreeQuotingColor: withSet(baseScalar),
  // Fonts
  messageFont: withSet(baseScalar),
  messageFontSize: withSet(baseScalar),
  messageListFont: withSet(baseScalar),
  messageListFontSize: withSet(baseScalar),
  useFixedWidthFont: withSet(baseScalar),
  fixedWidthFont: withSet(baseScalar),
  fixedWidthFontSize: withSet(baseScalar),
  // Sounds
  newMailSound: withSet(baseScalar),
  shouldPlayOtherMailSounds: withSet(baseScalar),
  // Spelling
  checkSpellingWhileTyping: withSet(baseScalar),
};

// ─────────────────────────────────────────────────────────────────────────────
// Application proto
// ─────────────────────────────────────────────────────────────────────────────

const MailApplicationProto = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe3(baseCollection, withByIndex(MailAccountProto), withByName(MailAccountProto), withById(MailAccountProto)),
  rules: pipe2(baseCollection, withByIndex(RuleProto), withByName(RuleProto)),
  signatures: pipe2(baseCollection, withByIndex(SignatureProto), withByName(SignatureProto)),
  // Standard mailboxes - simple property access with jxaName mapping
  inbox: MailboxProto,
  drafts: withJxaName(MailboxProto, 'draftsMailbox'),
  junk: withJxaName(MailboxProto, 'junkMailbox'),
  outbox: MailboxProto,
  sent: withJxaName(MailboxProto, 'sentMailbox'),
  trash: withJxaName(MailboxProto, 'trashMailbox'),
  // Settings namespace - virtual grouping of app-level preferences
  settings: namespaceNav(MailSettingsProto),
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function getMailApp(delegate: Delegate): Res<typeof MailApplicationProto> {
  return createRes(delegate, MailApplicationProto);
}

// Type aliases - use typeof to derive types from proto objects
type MailApplication = Res<typeof MailApplicationProto>;
type MailAccount = Res<typeof MailAccountProto>;
type MailMailbox = Res<MailboxProtoType>;  // Uses interface (recursive)
type MailMessage = Res<typeof MessageProto>;
type MailAttachment = Res<typeof AttachmentProto>;
type MailRecipient = Res<typeof RecipientProto>;
type MailRule = Res<typeof RuleProto>;
type MailRuleCondition = Res<typeof RuleConditionProto>;
type MailSignature = Res<typeof SignatureProto>;
type MailSettings = Res<typeof MailSettingsProto>;
