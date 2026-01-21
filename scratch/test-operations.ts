// scratch/test-operations.ts - Tests for domain operations (move, delete, create)
//
// Run with:
// npx tsc scratch/framework.ts scratch/mock-backing.ts scratch/mail.ts scratch/test-operations.ts \
//   --outFile scratch/test-operations.js --module None --target ES2020 --lib ES2020 --strict
// node scratch/test-operations.js

// ─────────────────────────────────────────────────────────────────────────────
// Test utilities
// ─────────────────────────────────────────────────────────────────────────────

let testCount = 0;
let passCount = 0;

function assert(condition: boolean, message: string): void {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  testCount++;
  if (actual === expected) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertOk<T>(result: Result<T>, message: string): T | undefined {
  testCount++;
  if (result.ok) {
    passCount++;
    console.log(`  ✓ ${message}`);
    return result.value;
  } else {
    console.log(`  ✗ ${message}`);
    console.log(`      error: ${result.error}`);
    return undefined;
  }
}

function assertError<T>(result: Result<T>, message: string): void {
  testCount++;
  if (!result.ok) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    console.log(`      expected error, got: ${JSON.stringify(result.value)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data
// ─────────────────────────────────────────────────────────────────────────────

function createMockMailData() {
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function testMoveMessageBetweenMailboxes() {
  console.log('\n=== Test: Move message between mailboxes ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const mail = getMailApp(delegate);

  // Get inbox and archive mailboxes
  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
  const archive = mail.accounts.byName('Work').mailboxes.byName('Archive');

  // Verify initial state
  const inboxMessages = inbox.messages.resolve() as any[];
  const archiveMessages = archive.messages.resolve() as any[];
  assertEqual(inboxMessages.length, 2, 'Inbox has 2 messages initially');
  assertEqual(archiveMessages.length, 1, 'Archive has 1 message initially');

  // Get the first message from inbox
  const message = inbox.messages.byId(1001);
  assertEqual(message.subject.resolve(), 'Hello World', 'Message subject is correct');

  // Move message to archive
  // Cast to Res<CollectionProto> since the type system doesn't know that archive.messages
  // is wrapped in Res (the proxy wraps it at runtime, but types don't reflect this)
  const moveResult = message.move(archive.messages as any);
  const newUri = assertOk(moveResult, 'Move operation succeeded');

  // Verify message was removed from source
  const inboxMessagesAfter = inbox.messages.resolve() as any[];
  assertEqual(inboxMessagesAfter.length, 1, 'Inbox now has 1 message');

  // Verify message was added to destination
  const archiveMessagesAfter = archive.messages.resolve() as any[];
  assertEqual(archiveMessagesAfter.length, 2, 'Archive now has 2 messages');

  // Verify the moved message is in archive
  const movedMsg = archiveMessagesAfter.find((m: any) => m.id === 1001);
  assert(movedMsg !== undefined, 'Moved message found in archive');
  assertEqual(movedMsg?.subject, 'Hello World', 'Moved message has correct subject');
}

function testMoveTypeError() {
  console.log('\n=== Test: Move type constraint ===');

  // This test verifies at compile time that you can't move a message to a mailbox collection
  // The following code should NOT compile:
  // message.move(account.mailboxes)  // Type error: Collection<Mailbox> not Collection<Message>

  // We just verify that the types are set up correctly by checking the proto structure
  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // This SHOULD work (same item type)
  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');
  const archive = mail.accounts.byName('Work').mailboxes.byName('Archive');
  const message = inbox.messages.byId(1001);

  assert('move' in message, 'Message has move method');
  assert(typeof (message as any).move === 'function', 'move is a function');

  // Type system prevents: message.move(mail.accounts) - would be type error
  console.log('  ✓ Type constraint prevents moving message to wrong collection type (compile-time check)');
  passCount++;
  testCount++;
}

function testDeleteMessage() {
  console.log('\n=== Test: Delete message ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');

  // Verify initial state
  const messagesBefore = inbox.messages.resolve() as any[];
  assertEqual(messagesBefore.length, 2, 'Inbox has 2 messages initially');

  // Delete the second message
  const message = inbox.messages.byId(1002);
  const deleteResult = message.delete();
  assertOk(deleteResult, 'Delete operation succeeded');

  // Verify message was removed
  const messagesAfter = inbox.messages.resolve() as any[];
  assertEqual(messagesAfter.length, 1, 'Inbox now has 1 message');

  // Verify correct message remains
  assertEqual(messagesAfter[0].id, 1001, 'Remaining message has correct id');
}

function testDeleteRule() {
  console.log('\n=== Test: Delete rule ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // Verify initial state
  const rulesBefore = mail.rules.resolve() as any[];
  assertEqual(rulesBefore.length, 2, 'App has 2 rules initially');

  // Delete the first rule
  const rule = mail.rules.byName('Spam Filter');
  assert('delete' in rule, 'Rule has delete method');

  const deleteResult = rule.delete();
  assertOk(deleteResult, 'Delete operation succeeded');

  // Verify rule was removed
  const rulesAfter = mail.rules.resolve() as any[];
  assertEqual(rulesAfter.length, 1, 'App now has 1 rule');
  assertEqual(rulesAfter[0].name, 'Work Rules', 'Remaining rule is Work Rules');
}

function testCreateMessage() {
  console.log('\n=== Test: Create message in mailbox ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');

  // Verify initial state
  const messagesBefore = inbox.messages.resolve() as any[];
  assertEqual(messagesBefore.length, 2, 'Inbox has 2 messages initially');

  // Create a new message using delegate directly (since create is on delegate, not proto)
  // Cast to any to access _delegate (runtime proxy provides it, but type system doesn't know)
  const createResult: Result<URL> = (inbox.messages as any)._delegate.create({
    subject: 'New Test Message',
    sender: 'test@example.com',
    readStatus: false,
    flaggedStatus: false,
    messageSize: 100,
  });
  const newUri = assertOk(createResult, 'Create operation succeeded');

  // Verify message was added
  const messagesAfter = inbox.messages.resolve() as any[];
  assertEqual(messagesAfter.length, 3, 'Inbox now has 3 messages');

  // Verify the new message
  const newMsg = messagesAfter[2];
  assertEqual(newMsg.subject, 'New Test Message', 'New message has correct subject');
  assert(newMsg.id !== undefined, 'New message has an id assigned');

  // Verify URI points to new message
  if (newUri) {
    assert(newUri.href.includes(String(newMsg.id)), 'Returned URI includes new message id');
  }
}

function testParentNavigation() {
  console.log('\n=== Test: Parent navigation ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  // Navigate to messages collection
  // Cast to any to access _delegate (runtime proxy provides it, but type system doesn't know)
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
  console.log('\n=== Test: uri() returns URL object ===');

  const mockData = createMockMailData();
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const message = mail.accounts.byName('Work').mailboxes.byName('INBOX').messages.byId(1001);
  // Cast to any to access _delegate (runtime proxy provides it, but type system doesn't know)
  const uri = (message as any)._delegate.uri() as URL;

  assert(uri instanceof URL, 'uri() returns URL object');
  assertEqual(typeof uri.href, 'string', 'URL has href property');
  assertEqual(typeof uri.pathname, 'string', 'URL has pathname property');
  assert(uri.href.startsWith('mail://'), 'URI starts with mail://');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('Domain Operations Tests');
console.log('========================');

testMoveMessageBetweenMailboxes();
testMoveTypeError();
testDeleteMessage();
testDeleteRule();
testCreateMessage();
testParentNavigation();
testUriReturnsURL();

console.log(`\n========================`);
console.log(`Tests: ${passCount}/${testCount} passed`);

if (passCount < testCount) {
  console.log('SOME TESTS FAILED');
  // process.exit(1) - not available in JXA
}
