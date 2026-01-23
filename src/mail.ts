// src/mail.ts - Mail.app Schema
//
// Uses framework/ building blocks. No framework code here.

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
    const rfcMessageId = msgDelegate.prop('messageId')._jxa() as string;
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
  ...baseObject,
  header: t.string,
  qualifier: t.string,
  ruleType: t.string,
  expression: t.string,
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule proto
// ─────────────────────────────────────────────────────────────────────────────

const RuleProto = withDelete()({
  ...baseObject,
  name: t.string,
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
  ruleConditions: collection(RuleConditionProto, [Accessor.Index]),
});

// ─────────────────────────────────────────────────────────────────────────────
// Signature proto
// ─────────────────────────────────────────────────────────────────────────────

const SignatureProto = {
  ...baseObject,
  name: t.string,
  content: lazy(t.string),
};

// ─────────────────────────────────────────────────────────────────────────────
// Recipient proto
// ─────────────────────────────────────────────────────────────────────────────

const RecipientProto = {
  ...baseObject,
  name: t.string,
  address: t.string,
};

// ─────────────────────────────────────────────────────────────────────────────
// Attachment proto
// ─────────────────────────────────────────────────────────────────────────────

const AttachmentProto = {
  ...baseObject,
  id: t.string,
  name: t.string,
  fileSize: t.number,
};

// ─────────────────────────────────────────────────────────────────────────────
// Message proto
// ─────────────────────────────────────────────────────────────────────────────

const _MessageProtoBase = {
  ...baseObject,
  id: t.number,
  messageId: t.string,
  subject: withSet(t.string),
  sender: computed<ParsedEmailAddress>(parseEmailAddress),
  replyTo: computed<ParsedEmailAddress>(parseEmailAddress),
  dateSent: t.date,
  dateReceived: t.date,
  content: lazy(t.string),
  readStatus: withSet(t.boolean),
  flaggedStatus: withSet(t.boolean),
  junkMailStatus: withSet(t.boolean),
  messageSize: t.number,
  toRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
  ccRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
  bccRecipients: collection(RecipientProto, [Accessor.Index, Accessor.Name]),
  attachments: withJxaName(
    collection(AttachmentProto, [Accessor.Index, Accessor.Name, Accessor.Id]),
    'mailAttachments'
  ),
};

// MessageProto with move and delete operations
const MessageProto = withDelete(messageDeleteHandler)(
  withMove(_MessageProtoBase, messageMoveHandler)(_MessageProtoBase)
);

// ─────────────────────────────────────────────────────────────────────────────
// Mailbox proto (recursive - interface required for self-reference)
// ─────────────────────────────────────────────────────────────────────────────

// Messages collection proto (used in MailboxProto and for type reference)
const MessagesProto = collection(MessageProto, [Accessor.Index, Accessor.Id]);

// Mailbox is self-referential (contains mailboxes), so needs forward declaration
// We define the collection proto separately to allow the self-reference
const MailboxesProto = collection(null as unknown as MailboxProtoType, [Accessor.Index, Accessor.Name]);

interface MailboxProtoType extends BaseProtoType<any> {
  name: typeof t.string;
  unreadCount: typeof t.number;
  messages: typeof MessagesProto & { readonly [LazyBrand]: true };
  mailboxes: typeof MailboxesProto & { readonly [LazyBrand]: true };
}

const MailboxProto: MailboxProtoType = {
  ...baseObject,
  name: t.string,
  unreadCount: t.number,
  messages: lazy(MessagesProto),
  mailboxes: lazy(MailboxesProto),
};

// Now fix up the self-reference in MailboxesProto
collectionItemProtos.set(MailboxesProto, MailboxProto);

// ─────────────────────────────────────────────────────────────────────────────
// Account proto
// ─────────────────────────────────────────────────────────────────────────────

const MailAccountProto = {
  ...baseObject,
  id: t.string,
  name: t.string,
  fullName: t.string,
  emailAddresses: t.stringArray,
  mailboxes: collection(MailboxProto, [Accessor.Index, Accessor.Name]),
  // Account inbox: find this account's mailbox in Mail.inbox.mailboxes()
  // (Can't use simple byName because inbox name varies: "INBOX", "Inbox", etc.)
  inbox: computedNav((d) => {
    if (!d.fromJxa) {
      // Mock delegate: fall back to mailboxes.byName('INBOX')
      return d.prop('mailboxes').byName('INBOX');
    }
    // JXA: Find inbox mailbox by matching account ID
    const jxaAccount = d._jxa() as { id(): string };
    const accountId = jxaAccount.id();
    const Mail = Application('Mail');
    const inboxMailboxes = Mail.inbox.mailboxes();
    const accountInbox = inboxMailboxes.find((mb: any) => mb.account.id() === accountId);
    if (!accountInbox) {
      throw new Error(`No inbox found for account ${accountId}`);
    }
    // Build path by parsing current URI and adding /inbox
    // URI is like "mail://accounts%5B0%5D" -> path segments for "accounts[0]/inbox"
    const currentUri = d.uri().href;
    const afterScheme = currentUri.replace('mail://', '');
    const decodedPath = decodeURIComponent(afterScheme);
    // Parse into segments: e.g., "accounts[0]" -> [{root}, {prop: accounts}, {index: 0}]
    const pathSegments = parsePathToSegments('mail', decodedPath);
    pathSegments.push({ kind: 'prop' as const, name: 'inbox' });
    return d.fromJxa(accountInbox, pathSegments);
  }, MailboxProto),
};

// Helper to parse a path string into PathSegment array
function parsePathToSegments(scheme: string, path: string): PathSegment[] {
  const segments: PathSegment[] = [{ kind: 'root', scheme }];
  const parts = path.split('/').filter(p => p);
  for (const part of parts) {
    const indexMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (indexMatch) {
      segments.push({ kind: 'prop', name: indexMatch[1] });
      segments.push({ kind: 'index', value: parseInt(indexMatch[2], 10) });
    } else {
      segments.push({ kind: 'prop', name: part });
    }
  }
  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings proto (namespace for app-level preferences)
// ─────────────────────────────────────────────────────────────────────────────

const MailSettingsProto = {
  ...passthrough,
  // App info (read-only)
  name: t.string,
  version: t.string,
  frontmost: t.boolean,
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
  ...passthrough,
  name: t.string,
  version: t.string,
  accounts: collection(MailAccountProto, [Accessor.Index, Accessor.Name, Accessor.Id]),
  rules: collection(RuleProto, [Accessor.Index, Accessor.Name]),
  signatures: collection(SignatureProto, [Accessor.Index, Accessor.Name]),
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

function getMailApp(delegate: Delegate): Specifier<typeof MailApplicationProto> {
  return createSpecifier(delegate, MailApplicationProto);
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
