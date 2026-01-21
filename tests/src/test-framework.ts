// tests/src/test-framework.ts - Core framework tests (runs in Node with mock data)
//
// Tests URI parsing, proto composition, Res proxy behavior, and query operations.
// Uses MockDelegate - no Mail.app required.

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
                toRecipients: [{ name: 'John', address: 'john@work.com' }],
                ccRecipients: [],
                bccRecipients: [],
                mailAttachments: [],
              },
              {
                id: 1002,
                messageId: '<msg2@work.com>',
                subject: 'Meeting Tomorrow',
                sender: 'Bob Smith <bob@example.com>',
                dateSent: '2024-01-15T11:00:00Z',
                dateReceived: '2024-01-15T11:01:00Z',
                readStatus: true,
                flaggedStatus: true,
                messageSize: 2048,
                toRecipients: [{ name: 'John', address: 'john@work.com' }],
                ccRecipients: [{ name: 'Alice', address: 'alice@example.com' }],
                bccRecipients: [],
                mailAttachments: [{ id: 'att1', name: 'doc.pdf', fileSize: 10240 }],
              },
            ],
            mailboxes: [
              {
                name: 'Projects',
                unreadCount: 2,
                messages: [],
                mailboxes: [],
              },
            ],
          },
          {
            name: 'Archive',
            unreadCount: 0,
            messages: [],
            mailboxes: [],
          },
          {
            name: 'Sent',
            unreadCount: 0,
            messages: [],
            mailboxes: [],
          },
        ],
      },
      {
        id: 'acc2',
        name: 'Personal',
        fullName: 'John Doe',
        emailAddresses: ['john@personal.com'],
        mailboxes: [
          {
            name: 'INBOX',
            unreadCount: 3,
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
        ruleConditions: [
          { header: 'Subject', qualifier: 'contains', ruleType: 'header', expression: 'spam' },
        ],
      },
      {
        name: 'Work Rules',
        enabled: false,
        allConditionsMustBeMet: false,
        deleteMessage: false,
        markRead: true,
        markFlagged: false,
        ruleConditions: [],
      },
    ],
    signatures: [
      { name: 'Default', content: '-- \nJohn Doe' },
      { name: 'Work', content: '-- \nJohn Doe\nSenior Engineer' },
    ],
    // Standard mailboxes (aggregates)
    inbox: { name: 'All Inboxes', unreadCount: 8, messages: [], mailboxes: [] },
    sentMailbox: { name: 'All Sent', unreadCount: 0, messages: [], mailboxes: [] },
    draftsMailbox: { name: 'All Drafts', unreadCount: 0, messages: [], mailboxes: [] },
    trashMailbox: { name: 'All Trash', unreadCount: 0, messages: [], mailboxes: [] },
    junkMailbox: { name: 'All Junk', unreadCount: 0, messages: [], mailboxes: [] },
    outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
    // Settings (app-level properties)
    alwaysBccMyself: false,
    alwaysCcMyself: false,
    fetchInterval: 5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function testURIParsing() {
  group('URI Parsing');

  // Basic URIs
  const basic = lexURI('mail://accounts');
  assertOk(basic, 'Parse mail://accounts');
  if (basic.ok) {
    assertEqual(basic.value.scheme, 'mail', 'Scheme is mail');
    assertEqual(basic.value.segments.length, 1, 'One segment');
    assertEqual(basic.value.segments[0].head, 'accounts', 'Segment head is accounts');
  }

  // Index addressing
  const indexed = lexURI('mail://accounts[0]');
  assertOk(indexed, 'Parse mail://accounts[0]');
  if (indexed.ok) {
    assertEqual(indexed.value.segments[0].qualifier?.kind, 'index', 'Has index qualifier');
    if (indexed.value.segments[0].qualifier?.kind === 'index') {
      assertEqual(indexed.value.segments[0].qualifier.value, 0, 'Index is 0');
    }
  }

  // Nested path
  const nested = lexURI('mail://accounts[0]/mailboxes/INBOX/messages');
  assertOk(nested, 'Parse nested path');
  if (nested.ok) {
    assertEqual(nested.value.segments.length, 4, 'Four segments');
    assertEqual(nested.value.segments[2].head, 'INBOX', 'Third segment is INBOX');
  }

  // Query parameters
  const query = lexURI('mail://accounts[0]/mailboxes?name=Inbox&sort=unreadCount.desc');
  assertOk(query, 'Parse query parameters');
  if (query.ok) {
    const q = query.value.segments[1].qualifier;
    assertEqual(q?.kind, 'query', 'Has query qualifier');
    if (q?.kind === 'query') {
      assertEqual(q.filters.length, 1, 'One filter');
      assertEqual(q.filters[0].field, 'name', 'Filter field is name');
      assertEqual(q.sort?.field, 'unreadCount', 'Sort by unreadCount');
      assertEqual(q.sort?.direction, 'desc', 'Sort descending');
    }
  }

  // Pagination
  const paginated = lexURI('mail://accounts[0]/mailboxes?limit=10&offset=5');
  assertOk(paginated, 'Parse pagination');
  if (paginated.ok) {
    const q = paginated.value.segments[1].qualifier;
    if (q?.kind === 'query') {
      assertEqual(q.limit, 10, 'Limit is 10');
      assertEqual(q.offset, 5, 'Offset is 5');
    }
  }

  // Invalid URI
  const invalid = lexURI('not-a-uri');
  assertError(invalid, 'Reject invalid URI');
}

function testURIResolution() {
  group('URI Resolution');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // Root
  const root = resolveURI('mail://');
  assertOk(root, 'Resolve mail://');
  if (root.ok) {
    assertEqual(root.value._delegate.uri().href, 'mail://', 'Root URI is mail://');
  }

  // Accounts collection
  const accounts = resolveURI('mail://accounts');
  assertOk(accounts, 'Resolve mail://accounts');

  // Account by index
  const acc0 = resolveURI('mail://accounts[0]');
  assertOk(acc0, 'Resolve mail://accounts[0]');
  if (acc0.ok) {
    const name = acc0.value.name.resolve();
    assertEqual(name, 'Work', 'First account is Work');
  }

  // Account by name
  const accWork = resolveURI('mail://accounts/Work');
  assertOk(accWork, 'Resolve mail://accounts/Work');
  if (accWork.ok) {
    const name = accWork.value.name.resolve();
    assertEqual(name, 'Work', 'Account name is Work');
  }

  // Nested mailbox
  const inbox = resolveURI('mail://accounts[0]/mailboxes/INBOX');
  assertOk(inbox, 'Resolve mailbox by name');
  if (inbox.ok) {
    const unread = inbox.value.unreadCount.resolve();
    assertEqual(unread, 5, 'INBOX has 5 unread');
  }

  // Message by id
  const msg = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
  assertOk(msg, 'Resolve message by id');
  if (msg.ok) {
    const subject = msg.value.subject.resolve();
    assertEqual(subject, 'Hello World', 'Message subject correct');
  }

  // Standard mailboxes
  const inboxStd = resolveURI('mail://inbox');
  assertOk(inboxStd, 'Resolve mail://inbox');

  const sent = resolveURI('mail://sent');
  assertOk(sent, 'Resolve mail://sent');

  // Settings namespace
  const settings = resolveURI('mail://settings');
  assertOk(settings, 'Resolve mail://settings');

  const fetchInterval = resolveURI('mail://settings/fetchInterval');
  assertOk(fetchInterval, 'Resolve mail://settings/fetchInterval');
  if (fetchInterval.ok) {
    const val = fetchInterval.value.resolve();
    assertEqual(val, 5, 'fetchInterval is 5');
  }

  // Invalid path
  const invalid = resolveURI('mail://nonexistent');
  assertError(invalid, 'Reject unknown path');
}

function testResProxy() {
  group('Res Proxy Behavior');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  const result = resolveURI('mail://accounts[0]');
  if (!result.ok) {
    assert(false, 'Failed to resolve account');
    return;
  }

  const account = result.value;

  // Property access creates child Res
  const mailboxes = account.mailboxes;
  assert('_delegate' in mailboxes, 'mailboxes has _delegate');
  assert('byIndex' in mailboxes, 'mailboxes has byIndex method');
  assert('byName' in mailboxes, 'mailboxes has byName method');

  // byIndex returns Res
  const firstMailbox = mailboxes.byIndex(0);
  assert('_delegate' in firstMailbox, 'byIndex result has _delegate');
  assertEqual(firstMailbox.name.resolve(), 'INBOX', 'First mailbox is INBOX');

  // byName returns Res
  const inboxByName = mailboxes.byName('INBOX');
  assert('_delegate' in inboxByName, 'byName result has _delegate');
  assertEqual(inboxByName.name.resolve(), 'INBOX', 'Mailbox by name is INBOX');

  // Chained navigation
  const msg = account.mailboxes.byName('INBOX').messages.byId(1001);
  assert('_delegate' in msg, 'Chained navigation returns Res');
  assertEqual(msg.subject.resolve(), 'Hello World', 'Chained navigation works');
}

function testComputedProperties() {
  group('Computed Properties');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // sender is computed from raw email string
  const msg1 = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
  if (msg1.ok) {
    const sender = msg1.value.sender.resolve() as { name: string; address: string };
    assertEqual(sender.address, 'alice@example.com', 'Parsed email address');
    assertEqual(sender.name, '', 'No name in plain email');
  }

  const msg2 = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1002');
  if (msg2.ok) {
    const sender = msg2.value.sender.resolve() as { name: string; address: string };
    assertEqual(sender.address, 'bob@example.com', 'Parsed email address with name');
    assertEqual(sender.name, 'Bob Smith', 'Parsed display name');
  }
}

function testJxaNameMapping() {
  group('JXA Name Mapping');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // attachments maps to mailAttachments in JXA
  const msg = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1002');
  if (msg.ok) {
    const attachments = msg.value.attachments.resolve() as any[];
    assertEqual(attachments.length, 1, 'Message has 1 attachment');
    assertEqual(attachments[0].name, 'doc.pdf', 'Attachment name correct');
  }

  // sent maps to sentMailbox in JXA
  const sent = resolveURI('mail://sent');
  if (sent.ok) {
    const name = sent.value.name.resolve();
    assertEqual(name, 'All Sent', 'Sent mailbox name correct');
  }
}

function testQueryOperations() {
  group('Query Operations');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // Filter via URI
  const filtered = resolveURI('mail://accounts?name=Work');
  if (filtered.ok) {
    const accounts = filtered.value.resolve() as any[];
    assertEqual(accounts.length, 1, 'Filter returns 1 account');
    assertEqual(accounts[0].name, 'Work', 'Filtered account is Work');
  }

  // Sort via URI
  const sorted = resolveURI('mail://accounts[0]/mailboxes?sort=unreadCount.desc');
  if (sorted.ok) {
    const mailboxes = sorted.value.resolve() as any[];
    assert(mailboxes.length >= 2, 'At least 2 mailboxes');
    assert(mailboxes[0].unreadCount >= mailboxes[1].unreadCount, 'Sorted descending');
  }

  // Pagination via URI
  const paginated = resolveURI('mail://accounts[0]/mailboxes?limit=2');
  if (paginated.ok) {
    const mailboxes = paginated.value.resolve() as any[];
    assertEqual(mailboxes.length, 2, 'Limit to 2 mailboxes');
  }

  // Combined filter + sort + pagination
  const combo = resolveURI('mail://accounts[0]/mailboxes?unreadCount.gt=0&sort=name.asc&limit=5');
  if (combo.ok) {
    const mailboxes = combo.value.resolve() as any[];
    assert(mailboxes.every((m: any) => m.unreadCount > 0), 'All have unread > 0');
  }
}

function testSetOperation() {
  group('Set Operation');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // Get a rule and check initial state
  const rule = resolveURI('mail://rules[0]');
  if (rule.ok) {
    const enabled = rule.value.enabled.resolve();
    assertEqual(enabled, true, 'Rule initially enabled');

    // Set to false
    rule.value.enabled.set(false);
    const enabledAfter = rule.value.enabled.resolve();
    assertEqual(enabledAfter, false, 'Rule disabled after set');

    // Set back
    rule.value.enabled.set(true);
    assertEqual(rule.value.enabled.resolve(), true, 'Rule re-enabled');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('Framework Tests (Node/Mock)');
console.log('============================');

testURIParsing();
testURIResolution();
testResProxy();
testComputedProperties();
testJxaNameMapping();
testQueryOperations();
testSetOperation();

const frameworkTestResult = summary();
resetCounters();
