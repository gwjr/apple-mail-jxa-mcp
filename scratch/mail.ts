// scratch/mail.ts - Mail.app Schema
//
// Uses framework.ts building blocks. No framework code here.

// ─────────────────────────────────────────────────────────────────────────────
// Email Address Parsing (app-specific utility)
// ─────────────────────────────────────────────────────────────────────────────

type ParsedEmailAddress = { name: string; address: string };

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

interface RuleConditionProtoType extends BaseProtoType {
  header: typeof eagerScalar;
  qualifier: typeof eagerScalar;
  ruleType: typeof eagerScalar;
  expression: typeof eagerScalar;
}

const RuleConditionProto: RuleConditionProtoType = {
  ...baseScalar,
  header: eagerScalar,
  qualifier: eagerScalar,
  ruleType: eagerScalar,
  expression: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule proto
// ─────────────────────────────────────────────────────────────────────────────

interface RuleProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  enabled: ReturnType<typeof withSet<typeof baseScalar>>;
  allConditionsMustBeMet: ReturnType<typeof withSet<typeof baseScalar>>;
  deleteMessage: ReturnType<typeof withSet<typeof baseScalar>>;
  markRead: ReturnType<typeof withSet<typeof baseScalar>>;
  markFlagged: ReturnType<typeof withSet<typeof baseScalar>>;
  markFlagIndex: ReturnType<typeof withSet<typeof baseScalar>>;
  stopEvaluatingRules: ReturnType<typeof withSet<typeof baseScalar>>;
  forwardMessage: ReturnType<typeof withSet<typeof baseScalar>>;
  redirectMessage: ReturnType<typeof withSet<typeof baseScalar>>;
  replyText: ReturnType<typeof withSet<typeof baseScalar>>;
  playSound: ReturnType<typeof withSet<typeof baseScalar>>;
  highlightTextUsingColor: ReturnType<typeof withSet<typeof baseScalar>>;
  // copyMessage and moveMessage are computed properties in production - see note below
  ruleConditions: BaseProtoType & ByIndexProto<typeof RuleConditionProto>;
}

const RuleProto: RuleProtoType = {
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
  ruleConditions: pipe(baseCollection, withByIndex(RuleConditionProto)),
};

// ─────────────────────────────────────────────────────────────────────────────
// Signature proto
// ─────────────────────────────────────────────────────────────────────────────

interface SignatureProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
}

const SignatureProto: SignatureProtoType = {
  ...baseScalar,
  name: eagerScalar,
  content: makeLazy(baseScalar),
};

// ─────────────────────────────────────────────────────────────────────────────
// Recipient proto
// ─────────────────────────────────────────────────────────────────────────────

interface RecipientProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  address: typeof eagerScalar;
}

const RecipientProto: RecipientProtoType = {
  ...baseScalar,
  name: eagerScalar,
  address: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Attachment proto
// ─────────────────────────────────────────────────────────────────────────────

interface AttachmentProtoType extends BaseProtoType {
  id: typeof eagerScalar;
  name: typeof eagerScalar;
  fileSize: typeof eagerScalar;
}

const AttachmentProto: AttachmentProtoType = {
  ...baseScalar,
  id: eagerScalar,
  name: eagerScalar,
  fileSize: eagerScalar,
};

// ─────────────────────────────────────────────────────────────────────────────
// Message proto
// ─────────────────────────────────────────────────────────────────────────────

interface MessageProtoType extends BaseProtoType {
  id: typeof eagerScalar;
  messageId: typeof eagerScalar;
  subject: ReturnType<typeof withSet<typeof baseScalar>>;
  sender: BaseProtoType;                    // Computed: parses raw email string
  replyTo: BaseProtoType;                   // Computed: parses raw email string
  dateSent: typeof eagerScalar;
  dateReceived: typeof eagerScalar;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
  readStatus: ReturnType<typeof withSet<typeof baseScalar>>;
  flaggedStatus: ReturnType<typeof withSet<typeof baseScalar>>;
  junkMailStatus: ReturnType<typeof withSet<typeof baseScalar>>;
  messageSize: typeof eagerScalar;
  toRecipients: BaseProtoType & ByIndexProto<typeof RecipientProto> & ByNameProto<typeof RecipientProto>;
  ccRecipients: BaseProtoType & ByIndexProto<typeof RecipientProto> & ByNameProto<typeof RecipientProto>;
  bccRecipients: BaseProtoType & ByIndexProto<typeof RecipientProto> & ByNameProto<typeof RecipientProto>;
  attachments: JxaNamedProto<BaseProtoType & ByIndexProto<typeof AttachmentProto> & ByNameProto<typeof AttachmentProto> & ByIdProto<typeof AttachmentProto>>;
}

const MessageProto: MessageProtoType = {
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
// Mailbox proto (recursive)
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

interface MailAccountProtoType extends BaseProtoType {
  id: typeof eagerScalar;
  name: typeof eagerScalar;
  fullName: typeof eagerScalar;
  // emailAddresses requires computed() to call jxa.emailAddresses()
  mailboxes: BaseProtoType & ByIndexProto<typeof MailboxProto> & ByNameProto<typeof MailboxProto>;
  // Account-level inbox - complex navigation via computedNav
  inbox: ComputedNavProto<typeof MailboxProto>;
}

const MailAccountProto: MailAccountProtoType = {
  ...baseScalar,
  id: eagerScalar,
  name: eagerScalar,
  fullName: eagerScalar,
  mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
  // Account inbox navigates to mailboxes.byName('INBOX')
  inbox: computedNav((d) => d.prop('mailboxes').byName('INBOX'), MailboxProto),
};

// ─────────────────────────────────────────────────────────────────────────────
// Application proto
// ─────────────────────────────────────────────────────────────────────────────

interface MailApplicationProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  version: typeof eagerScalar;
  accounts: BaseProtoType & ByIndexProto<typeof MailAccountProto> & ByNameProto<typeof MailAccountProto> & ByIdProto<typeof MailAccountProto>;
  rules: BaseProtoType & ByIndexProto<typeof RuleProto> & ByNameProto<typeof RuleProto>;
  signatures: BaseProtoType & ByIndexProto<typeof SignatureProto> & ByNameProto<typeof SignatureProto>;
  // Standard mailboxes - simple property access (jxaName mapping)
  inbox: typeof MailboxProto;
  drafts: JxaNamedProto<typeof MailboxProto>;
  junk: JxaNamedProto<typeof MailboxProto>;
  outbox: typeof MailboxProto;
  sent: JxaNamedProto<typeof MailboxProto>;
  trash: JxaNamedProto<typeof MailboxProto>;
  // Settings namespace requires computed()
}

const MailApplicationProto: MailApplicationProtoType = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe3(baseCollection, withByIndex(MailAccountProto), withByName(MailAccountProto), withById(MailAccountProto)),
  rules: pipe2(baseCollection, withByIndex(RuleProto), withByName(RuleProto)),
  signatures: pipe2(baseCollection, withByIndex(SignatureProto), withByName(SignatureProto)),
  // Standard mailboxes - simple property access with jxaName mapping
  inbox: MailboxProto,                              // jxaName matches schema name
  drafts: withJxaName(MailboxProto, 'draftsMailbox'),
  junk: withJxaName(MailboxProto, 'junkMailbox'),
  outbox: MailboxProto,                             // jxaName matches schema name
  sent: withJxaName(MailboxProto, 'sentMailbox'),
  trash: withJxaName(MailboxProto, 'trashMailbox'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function getMailApp(delegate: Delegate): Res<typeof MailApplicationProto> {
  return createRes(delegate, MailApplicationProto);
}

// Type aliases
type MailApplication = Res<typeof MailApplicationProto>;
type MailAccount = Res<typeof MailAccountProto>;
type MailMailbox = Res<typeof MailboxProto>;
type MailMessage = Res<typeof MessageProto>;
type MailAttachment = Res<typeof AttachmentProto>;
type MailRecipient = Res<typeof RecipientProto>;
type MailRule = Res<typeof RuleProto>;
type MailRuleCondition = Res<typeof RuleConditionProto>;
type MailSignature = Res<typeof SignatureProto>;
