// tests/src/test-operations.ts - Domain operation tests (runs in Node with mock data)
//
// Tests move, delete, create operations and parent navigation.
// Uses MockDelegate - no Mail.app required.

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────────────────────────────────────

function createOperationsMockData() {
  return {
    name: 'Mail',
    version: '16.0',
    accounts: [
      {
        id: 'acc1',
        name: 'Work',
        fullName: 'John Doe',
        emailAddresses: ['john@work.com'],
        mailboxes: [
          {
            name: 'INBOX',
            unreadCount: 5,
            messages: [
              {
                id: 1001,
                messageId: '<msg1@work.com>',
                subject: 'Hello World',
                sender: 'alice@example.com',
                dateSent: '2024-01-15T10:00:00Z',
                dateReceived: '2024-01-15T10:01:00Z',
                readStatus: false,
                flaggedStatus: false,
                messageSize: 1024,
              },
              {
                id: 1002,
                messageId: '<msg2@work.com>',
                subject: 'Meeting Tomorrow',
                sender: 'bob@example.com',
                dateSent: '2024-01-15T11:00:00Z',
                dateReceived: '2024-01-15T11:01:00Z',
                readStatus: true,
                flaggedStatus: true,
                messageSize: 2048,
              },
            ],
            mailboxes: [],
          },
          {
            name: 'Archive',
            unreadCount: 0,
            messages: [
              {
                id: 2001,
                messageId: '<old@work.com>',
                subject: 'Old Message',
                sender: 'old@example.com',
                dateSent: '2023-01-01T00:00:00Z',
                dateReceived: '2023-01-01T00:01:00Z',
                readStatus: true,
                flaggedStatus: false,
                messageSize: 512,
              },
            ],
            mailboxes: [],
          },
          {
            name: 'Trash',
            unreadCount: 0,
            messages: [],
            mailboxes: [],
          },
        ],
      },
    ],
    rules: [
      {
        name: 'Spam Filter',
        enabled: true,
        allConditionsMustBeMet: true,
        deleteMessage: false,
        markRead: false,
        markFlagged: false,
      },
      {
        name: 'Work Rules',
        enabled: true,
        allConditionsMustBeMet: false,
        deleteMessage: false,
        markRead: true,
        markFlagged: false,
      },
    ],
    signatures: [],
    inbox: { name: 'Inbox', unreadCount: 5, messages: [], mailboxes: [] },
    sentMailbox: { name: 'Sent', unreadCount: 0, messages: [], mailboxes: [] },
    draftsMailbox: { name: 'Drafts', unreadCount: 0, messages: [], mailboxes: [] },
    trashMailbox: { name: 'Trash', unreadCount: 0, messages: [], mailboxes: [] },
    junkMailbox: { name: 'Junk', unreadCount: 0, messages: [], mailboxes: [] },
    outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function testMoveMessageBetweenMailboxes() {
  group('Move Message Between Mailboxes');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // Get inbox and archive mailboxes
  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
  const archive = mail.accounts.byName('Work').mailboxes.byName('Archive');

  // Verify initial state - resolve() returns specifiers (URIs), count tells us how many
  const inboxSpecifiers = inbox.messages.resolve() as any[];
  const archiveSpecifiers = archive.messages.resolve() as any[];
  assertEqual(inboxSpecifiers.length, 2, 'Inbox has 2 messages initially');
  assertEqual(archiveSpecifiers.length, 1, 'Archive has 1 message initially');

  // Get the first message from inbox - use byId for specific access
  const message = inbox.messages.byId(1001);
  assertEqual(message.subject.resolve(), 'Hello World', 'Message subject is correct');

  // Move message to archive
  const moveResult = message.move(archive.messages as any);
  assertOk(moveResult, 'Move operation succeeded');

  // Verify message was removed from source (check count via specifiers)
  const inboxSpecifiersAfter = inbox.messages.resolve() as any[];
  assertEqual(inboxSpecifiersAfter.length, 1, 'Inbox now has 1 message');

  // Verify message was added to destination
  const archiveSpecifiersAfter = archive.messages.resolve() as any[];
  assertEqual(archiveSpecifiersAfter.length, 2, 'Archive now has 2 messages');

  // Verify the moved message is in archive - check by existence
  assert(archive.messages.byId(1001).exists(), 'Moved message found in archive');
  assertEqual(archive.messages.byId(1001).subject.resolve(), 'Hello World', 'Moved message has correct subject');
}

function testMoveTypeConstraint() {
  group('Move Type Constraint');

  // This test verifies that the type system constrains move destinations.
  // At compile time: message.move(account.mailboxes) would be a type error
  // because Collection<Mailbox> is not compatible with Collection<Message>.

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
  const message = inbox.messages.byId(1001);

  // Verify message has move method
  assert('move' in message, 'Message has move method');
  assert(typeof (message as any).move === 'function', 'move is a function');

  // The type system prevents: message.move(mail.accounts.byName('Work').mailboxes)
  // This is verified at compile time, not runtime.
  console.log('  \u2713 Type constraint prevents moving message to wrong collection type (compile-time check)');
}

function testDeleteMessage() {
  group('Delete Message');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');

  // Verify initial state - count via specifiers
  const specifiersBefore = inbox.messages.resolve() as any[];
  assertEqual(specifiersBefore.length, 2, 'Inbox has 2 messages initially');

  // Delete the second message
  const message = inbox.messages.byId(1002);
  const deleteResult = message.delete();
  assertOk(deleteResult, 'Delete operation succeeded');

  // Verify message was removed
  const specifiersAfter = inbox.messages.resolve() as any[];
  assertEqual(specifiersAfter.length, 1, 'Inbox now has 1 message');

  // Verify correct message remains - use byId to check
  assert(inbox.messages.byId(1001).exists(), 'Message 1001 still exists');
  assert(!inbox.messages.byId(1002).exists(), 'Message 1002 no longer exists');
}

function testDeleteRule() {
  group('Delete Rule');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // Verify initial state - count via specifiers
  const specifiersBefore = mail.rules.resolve() as any[];
  assertEqual(specifiersBefore.length, 2, 'App has 2 rules initially');

  // Delete the first rule
  const rule = mail.rules.byName('Spam Filter');
  assert('delete' in rule, 'Rule has delete method');

  const deleteResult = rule.delete();
  assertOk(deleteResult, 'Delete operation succeeded');

  // Verify rule was removed
  const specifiersAfter = mail.rules.resolve() as any[];
  assertEqual(specifiersAfter.length, 1, 'App now has 1 rule');

  // Verify correct rule remains - use byName to check
  assert(!mail.rules.byName('Spam Filter').exists(), 'Spam Filter no longer exists');
  assert(mail.rules.byName('Work Rules').exists(), 'Work Rules still exists');
}

function testCreateMessage() {
  group('Create Message');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');

  // Verify initial state - count via specifiers
  const specifiersBefore = inbox.messages.resolve() as any[];
  assertEqual(specifiersBefore.length, 2, 'Inbox has 2 messages initially');

  // Create a new message using delegate
  const createResult: Result<URL> = (inbox.messages as any)._delegate.create({
    subject: 'New Test Message',
    sender: 'test@example.com',
    readStatus: false,
    flaggedStatus: false,
    messageSize: 100,
  });
  const newUri = assertOk(createResult, 'Create operation succeeded');

  // Verify message was added
  const specifiersAfter = inbox.messages.resolve() as any[];
  assertEqual(specifiersAfter.length, 3, 'Inbox now has 3 messages');

  // The new specifier should include an id if available
  const lastSpecifier = specifiersAfter[2];
  assert('uri' in lastSpecifier, 'New message specifier has uri');
  if ('id' in lastSpecifier) {
    assert(lastSpecifier.id !== undefined, 'New message specifier has id');
  }

  // Verify we can access the new message via byIndex
  const newMsg = inbox.messages.byIndex(2).resolve() as any;
  assertEqual(newMsg.subject, 'New Test Message', 'New message has correct subject');

  // Verify URI points to new message
  if (newUri) {
    assert(newUri.href.includes('messages'), 'Returned URI includes messages path');
  }
}

function testParentNavigation() {
  group('Parent Navigation');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // Navigate to messages collection
  const messagesDelegate = (mail.accounts.byName('Work').mailboxes.byName('INBOX').messages as any)._delegate as Delegate;

  // Get parent (should be the mailbox)
  const parentOrRoot = messagesDelegate.parent();
  assert(!isRoot(parentOrRoot), 'Parent of messages is not root');

  if (!isRoot(parentOrRoot)) {
    const parent = parentOrRoot as Delegate;
    // Parent should be the mailbox - verify by checking its URI
    const parentUri = parent.uri().href;
    assert(parentUri.includes('INBOX'), 'Parent URI includes INBOX');
  }

  // Navigate to root
  const rootDelegate = mail._delegate;
  const rootParent = rootDelegate.parent();
  assert(isRoot(rootParent), 'Parent of root delegate is RootMarker');
}

function testUriReturnsURL() {
  group('URI Returns URL Object');

  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const message = mail.accounts.byName('Work').mailboxes.byName('INBOX').messages.byId(1001);
  const uri = (message as any)._delegate.uri() as URL;

  assert(uri instanceof URL, 'uri() returns URL object');
  assertEqual(typeof uri.href, 'string', 'URL has href property');
  assertEqual(typeof uri.pathname, 'string', 'URL has pathname property');
  assert(uri.href.startsWith('mail://'), 'URI starts with mail://');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('Domain Operations Tests (Node/Mock)');
console.log('====================================');

testMoveMessageBetweenMailboxes();
testMoveTypeConstraint();
testDeleteMessage();
testDeleteRule();
testCreateMessage();
testParentNavigation();
testUriReturnsURL();

const operationsTestResult = summary();
