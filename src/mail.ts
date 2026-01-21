// scratch/mail.ts - Mail.app Schema
//
// Uses framework.ts building blocks. No framework code here.

// ─────────────────────────────────────────────────────────────────────────────
// App-specific utilities
// ─────────────────────────────────────────────────────────────────────────────

type ParsedEmailAddress = { name: string; address: string };

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific mutation handlers
// ─────────────────────────────────────────────────────────────────────────────

// Messages move by setting the mailbox property, not using JXA move command
const messageMoveHandler: MoveHandler = (msgDelegate, destCollectionDelegate): Result<URL> => {
  // destCollectionDelegate is the messages collection
  // parent() gives us the mailbox
  const destMailboxOrRoot = destCollectionDelegate.parent();
  if (isRoot(destMailboxOrRoot)) {
    return { ok: false, error: 'Cannot determine destination mailbox' };
  }
  const destMailbox = destMailboxOrRoot;

  // For JXA: message.mailbox = destMailbox._jxa()
  // For Mock: move data from one array to another
  const moveResult = msgDelegate.moveTo(destCollectionDelegate);
  if (!moveResult.ok) return moveResult;

  // Return new URL - construct from destination mailbox URI
  const destMailboxUri = destMailbox.uri();
  // Get the message's RFC messageId (stable across moves)
  try {
    const rfcMessageId = msgDelegate.prop('messageId')._jxa();
    const newUrl = new URL(`${destMailboxUri.href}/messages/${encodeURIComponent(rfcMessageId)}`);
    return { ok: true, value: newUrl };
  } catch {
    // Fall back to default move result
    return moveResult;
  }
};

// Messages delete by moving to trash, not actual delete
const messageDeleteHandler: DeleteHandler = (msgDelegate): Result<URL> => {
  // For now, use the default delete behavior
  // A full implementation would navigate to account's trash and move there
  return msgDelegate.delete();
};

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

const _RuleProtoBase = {
  ...baseScalar,
  name: eagerScalar,
  enabled: withSet(t.boolean),
  allConditionsMustBeMet: withSet(t.boolean),
  deleteMessage: withSet(t.boolean),
  markRead: withSet(t.boolean),
  markFlagged: withSet(t.boolean),
  markFlagIndex: withSet(t.number),
  stopEvaluatingRules: withSet(t.boolean),
  forwardMessage: withSet(t.string),
  redirectMessage: withSet(t.string),
  replyText: withSet(t.string),
  playSound: withSet(t.string),
  highlightTextUsingColor: withSet(t.string),
  // copyMessage/moveMessage return the destination mailbox name (or null)
  copyMessage: computed<string | null>(extractMailboxName),
  moveMessage: computed<string | null>(extractMailboxName),
  ruleConditions: pipe(baseCollection, withByIndex(RuleConditionProto)),
};

// RuleProto with delete operation (uses default JXA delete)
const RuleProto = pipe(_RuleProtoBase, withDelete());

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

// Forward declaration for MessageProto type (used in collection types)
type MessageProtoType = typeof _MessageProtoBase & MoveableProto<typeof _MessageProtoBase> & DeleteableProto;

const _MessageProtoBase = {
  ...baseScalar,
  id: eagerScalar,
  messageId: eagerScalar,
  subject: withSet(t.string),
  sender: computed<ParsedEmailAddress>(parseEmailAddress),
  replyTo: computed<ParsedEmailAddress>(parseEmailAddress),
  dateSent: eagerScalar,
  dateReceived: eagerScalar,
  content: makeLazy(baseScalar),
  readStatus: withSet(t.boolean),
  flaggedStatus: withSet(t.boolean),
  junkMailStatus: withSet(t.boolean),
  messageSize: eagerScalar,
  toRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  ccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  bccRecipients: pipe2(baseCollection, withByIndex(RecipientProto), withByName(RecipientProto)),
  attachments: withJxaName(
    pipe3(baseCollection, withByIndex(AttachmentProto), withByName(AttachmentProto), withById(AttachmentProto)),
    'mailAttachments'
  ),
};

// MessageProto with move and delete operations
const MessageProto = pipe2(
  _MessageProtoBase,
  withMove(_MessageProtoBase, messageMoveHandler),
  withDelete(messageDeleteHandler)
);

const LazyMessageProto = makeLazy(MessageProto);

// ─────────────────────────────────────────────────────────────────────────────
// Mailbox proto (recursive - interface required for self-reference)
// ─────────────────────────────────────────────────────────────────────────────

// Collection type with CollectionBrand for type-safe move operations
type MessageCollectionProto = CollectionProto<typeof LazyMessageProto> & ByIndexProto<typeof LazyMessageProto> & ByIdProto<typeof LazyMessageProto>;
type MailboxCollectionProto = CollectionProto<MailboxProtoType> & ByIndexProto<MailboxProtoType> & ByNameProto<MailboxProtoType>;

interface MailboxProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  unreadCount: typeof eagerScalar;
  messages: MessageCollectionProto;
  mailboxes: MailboxCollectionProto;
}

const MailboxProto: MailboxProtoType = {
  ...baseScalar,
  name: eagerScalar,
  unreadCount: eagerScalar,
  messages: pipe2(collection<typeof LazyMessageProto>(), withByIndex(LazyMessageProto), withById(LazyMessageProto)) as MessageCollectionProto,
  mailboxes: null as any,
};

MailboxProto.mailboxes = pipe2(collection<MailboxProtoType>(), withByIndex(MailboxProto), withByName(MailboxProto)) as MailboxCollectionProto;

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
  alwaysBccMyself: withSet(t.boolean),
  alwaysCcMyself: withSet(t.boolean),
  downloadHtmlAttachments: withSet(t.boolean),
  fetchInterval: withSet(t.number),
  expandGroupAddresses: withSet(t.boolean),
  // Composing
  defaultMessageFormat: withSet(t.string),
  chooseSignatureWhenComposing: withSet(t.boolean),
  quoteOriginalMessage: withSet(t.boolean),
  sameReplyFormat: withSet(t.boolean),
  includeAllOriginalMessageText: withSet(t.boolean),
  // Display
  highlightSelectedConversation: withSet(t.boolean),
  colorQuotedText: withSet(t.boolean),
  levelOneQuotingColor: withSet(t.string),
  levelTwoQuotingColor: withSet(t.string),
  levelThreeQuotingColor: withSet(t.string),
  // Fonts
  messageFont: withSet(t.string),
  messageFontSize: withSet(t.number),
  messageListFont: withSet(t.string),
  messageListFontSize: withSet(t.number),
  useFixedWidthFont: withSet(t.boolean),
  fixedWidthFont: withSet(t.string),
  fixedWidthFontSize: withSet(t.number),
  // Sounds
  newMailSound: withSet(t.string),
  shouldPlayOtherMailSounds: withSet(t.boolean),
  // Spelling
  checkSpellingWhileTyping: withSet(t.boolean),
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

// ─────────────────────────────────────────────────────────────────────────────
// Scheme Registration
// ─────────────────────────────────────────────────────────────────────────────

// Register the mail:// scheme with the framework
// This enables resolveURI('mail://...') to work
// Only register in JXA environment (Application and createJXADelegate are JXA-only)
// Use globalThis to check without TypeScript complaining
const _globalThis = globalThis as any;
if (typeof _globalThis.Application !== 'undefined' && typeof _globalThis.createJXADelegate !== 'undefined') {
  registerScheme(
    'mail',
    () => _globalThis.createJXADelegate(_globalThis.Application('Mail'), 'mail'),
    MailApplicationProto
  );
}
