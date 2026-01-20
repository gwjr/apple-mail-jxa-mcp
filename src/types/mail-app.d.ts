/// <reference path="jxa.d.ts" />

// ============================================================================
// Mail.app JXA Scripting Types
// Based on Mail.app's scripting dictionary (sdef)
// ============================================================================

// ============================================================================
// JXA Specifier Types
// ============================================================================

// Note: Result<T> is now defined in framework/specifier.ts

// JXA collection specifier - must be called to resolve
interface JXAElementArray<T> {
  (): T[];
  at(index: number): T;
  byId(id: number): T;
  byName(name: string): T;
  whose(predicate: WhoseClause): JXAElementArray<T>;
  length: number;
}

// Whose clause for filtering
interface WhoseClause {
  [property: string]: {
    _equals?: any;
    _contains?: string;
    _beginsWith?: string;
    _endsWith?: string;
    _lessThan?: number;
    _greaterThan?: number;
  } | any;
}

// ============================================================================
// Mail Application
// ============================================================================

interface MailApplication {
  // Standard Suite
  name(): string;
  version(): string;
  frontmost(): boolean;

  // Mail-specific
  applicationVersion(): string;

  // Behavior properties
  alwaysBccMyself(): boolean;
  alwaysCcMyself(): boolean;
  downloadHtmlAttachments(): boolean;
  fetchInterval(): number;
  expandGroupAddresses(): boolean;

  // Composing properties
  defaultMessageFormat(): string;
  chooseSignatureWhenComposing(): boolean;
  selectedSignature(): JXASignature | null;
  quoteOriginalMessage(): boolean;
  sameReplyFormat(): boolean;
  includeAllOriginalMessageText(): boolean;

  // Display properties
  highlightSelectedConversation(): boolean;
  colorQuotedText(): boolean;
  levelOneQuotingColor(): string;
  levelTwoQuotingColor(): string;
  levelThreeQuotingColor(): string;

  // Font properties
  messageFont(): string;
  messageFontSize(): number;
  messageListFont(): string;
  messageListFontSize(): number;
  useFixedWidthFont(): boolean;
  fixedWidthFont(): string;
  fixedWidthFontSize(): number;

  // Sound properties
  newMailSound(): string;
  shouldPlayOtherMailSounds(): boolean;

  // Spelling
  checkSpellingWhileTyping(): boolean;

  // Collections
  accounts: JXAElementArray<JXAAccount>;
  rules(): JXARule[];
  signatures(): JXASignature[];

  // Unified mailboxes (cross-account)
  inbox: JXAMailbox;
  drafts: JXAMailbox;
  sentMailbox: JXAMailbox;
  junkMailbox: JXAMailbox;
  trash: JXAMailbox;
  outbox: JXAMailbox;

  // Commands
  checkForNewMail(): void;
  move(message: JXAMessage, options: { to: JXAMailbox }): void;
  delete(message: JXAMessage): void;
}

// ============================================================================
// Account
// ============================================================================

interface JXAAccount {
  id(): number;
  name(): string;
  emailAddresses(): string[];
  fullName(): string;
  enabled(): boolean;
  userName(): string;

  // Authentication
  port(): number;
  serverName(): string;
  usesSsl(): boolean;
  authentication(): string;

  // Collections
  mailboxes: JXAElementArray<JXAMailbox>;
}

// ============================================================================
// Mailbox
// ============================================================================

interface JXAMailbox {
  id?(): number;
  name(): string;
  unreadCount(): number;
  totalMessageCount?(): number;

  // Relationships
  account(): JXAAccount;
  container?(): JXAMailbox | null;

  // Collections
  messages: JXAElementArray<JXAMessage>;
  mailboxes: JXAElementArray<JXAMailbox>;
}

// ============================================================================
// Message
// ============================================================================

interface JXAMessage {
  // Identity
  id(): number;
  messageId(): string;  // RFC 2822 Message-ID header

  // Content
  subject(): string;
  content(): string;
  source(): string;

  // Addressing
  sender(): string;
  replyTo(): string;
  toRecipients(): JXARecipient[];
  ccRecipients(): JXARecipient[];
  bccRecipients(): JXARecipient[];

  // Timestamps
  dateReceived(): Date;
  dateSent(): Date;

  // Status
  readStatus: boolean;
  flaggedStatus: boolean;
  junkMailStatus(): boolean;
  wasForwarded(): boolean;
  wasRepliedTo(): boolean;
  wasRedirected(): boolean;

  // Classification
  messageSize(): number;

  // Relationships
  mailbox(): JXAMailbox;
  mailAttachments(): JXAAttachment[];

  // Headers
  allHeaders(): string;
}

// ============================================================================
// Recipient
// ============================================================================

interface JXARecipient {
  name(): string;
  address(): string;
}

// ============================================================================
// Attachment
// ============================================================================

interface JXAAttachment {
  name(): string;
  mimeType(): string;
  fileSize(): number;
  downloaded(): boolean;

  // Save to disk (returns path)
  saveAs?(path: string): void;
}

// ============================================================================
// Rule
// ============================================================================

interface JXARule {
  name(): string;
  enabled(): boolean;
  allConditionsMustBeMet(): boolean;

  // Actions
  copyMessage(): JXAMailbox | null;
  moveMessage(): JXAMailbox | null;
  forwardMessage(): string;
  redirectMessage(): string;
  replyText(): string;
  runScript(): any;
  highlightTextUsingColor(): string;
  deleteMessage(): boolean;
  markFlagged(): boolean;
  markFlagIndex(): number;
  markRead(): boolean;
  playSound(): string;
  stopEvaluatingRules(): boolean;

  // Conditions
  ruleConditions(): JXARuleCondition[];
}

interface JXARuleCondition {
  header(): string;
  qualifier(): string;
  ruleType(): string;
  expression(): string;
}

// ============================================================================
// Signature
// ============================================================================

interface JXASignature {
  name(): string;
  content(): string;
}

// ============================================================================
// Parsed URI Type (simplified)
// ============================================================================

interface MessageQuery {
  limit: number;
  offset: number;
  unread?: boolean;
}

type ParsedURI =
  | { type: 'properties'; uri: string }
  | { type: 'rules'; uri: string; index?: number }
  | { type: 'signatures'; uri: string; name?: string }
  | { type: 'accounts'; uri: string }
  | { type: 'account'; uri: string; account: string }
  | { type: 'account-mailboxes'; uri: string; account: string }
  | { type: 'mailbox'; uri: string; account: string; path: string[] }
  | { type: 'mailbox-mailboxes'; uri: string; account: string; path: string[] }
  | { type: 'mailbox-messages'; uri: string; account: string; path: string[]; query: MessageQuery }
  | { type: 'message'; uri: string; account: string; path: string[]; id: number }
  | { type: 'message-attachments'; uri: string; account: string; path: string[]; id: number }
  | { type: 'unknown'; uri: string };
