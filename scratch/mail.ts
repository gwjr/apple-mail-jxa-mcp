// scratch/mail.ts - Mail.app Schema
//
// Uses framework.ts building blocks. No framework code here.

// ─────────────────────────────────────────────────────────────────────────────
// Mail Schema - prototype composition
// ─────────────────────────────────────────────────────────────────────────────

// Attachment proto
interface AttachmentProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  size: typeof eagerScalar;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
}

const AttachmentProto: AttachmentProtoType = {
  ...baseScalar,
  name: eagerScalar,
  size: eagerScalar,
  content: makeLazy(baseScalar),
};

// Message proto
interface MessageProtoType extends BaseProtoType {
  subject: typeof eagerScalar;
  sender: typeof eagerScalar;
  dateSent: typeof eagerScalar;
  isRead: ReturnType<typeof withSet<typeof baseScalar>>;
  content: ReturnType<typeof makeLazy<typeof baseScalar>>;
  attachments: BaseProtoType & ByIndexProto<typeof AttachmentProto>;
}

const MessageProto: MessageProtoType = {
  ...baseScalar,
  subject: eagerScalar,
  sender: eagerScalar,
  dateSent: eagerScalar,
  isRead: withSet(baseScalar),
  content: makeLazy(baseScalar),
  attachments: pipe(baseCollection, withByIndex(AttachmentProto)),
};

const LazyMessageProto = makeLazy(MessageProto);

// Mailbox proto (recursive)
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

// Account proto
interface MailAccountProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  email: typeof eagerScalar;
  mailboxes: BaseProtoType & ByIndexProto<typeof MailboxProto> & ByNameProto<typeof MailboxProto>;
}

const MailAccountProto: MailAccountProtoType = {
  ...baseScalar,
  name: eagerScalar,
  email: eagerScalar,
  mailboxes: pipe2(baseCollection, withByIndex(MailboxProto), withByName(MailboxProto)),
};

// Application proto
interface MailApplicationProtoType extends BaseProtoType {
  name: typeof eagerScalar;
  version: typeof eagerScalar;
  accounts: BaseProtoType & ByIndexProto<typeof MailAccountProto> & ByNameProto<typeof MailAccountProto>;
}

const MailApplicationProto: MailApplicationProtoType = {
  ...baseScalar,
  name: eagerScalar,
  version: eagerScalar,
  accounts: pipe2(baseCollection, withByIndex(MailAccountProto), withByName(MailAccountProto)),
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
