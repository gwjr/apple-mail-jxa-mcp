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
                content: 'Hello, this is the message body content.',
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
                content: 'Let us meet tomorrow at 10am to discuss the project.',
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
    // Collection returns {uri} specifiers - use byIndex to get actual data
    const firstAttachment = msg.value.attachments.byIndex(0).resolve() as any;
    assertEqual(firstAttachment.name, 'doc.pdf', 'Attachment name correct');
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

function testObjectResolution() {
  group('Object Resolution (baseObject vs baseScalar)');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // Mailbox uses baseObject - resolve() should return a plain object with properties
  const inboxResult = resolveURI('mail://accounts[0]/mailboxes/INBOX');
  if (inboxResult.ok) {
    const resolved = inboxResult.value.resolve();
    assert(typeof resolved === 'object', 'Mailbox resolves to object');
    assertEqual(resolved.name, 'INBOX', 'Resolved mailbox has name property');
    assertEqual(resolved.unreadCount, 5, 'Resolved mailbox has unreadCount property');
    // Lazy collections return Specifiers when resolved as part of parent
    assert(typeof resolved.messages === 'object' && 'uri' in resolved.messages, 'Resolved mailbox has messages specifier');
    assert(typeof resolved.mailboxes === 'object' && 'uri' in resolved.mailboxes, 'Resolved mailbox has mailboxes specifier');
  }

  // Message uses baseScalar - resolve() should also return object with properties
  // This test will FAIL with current code because MessageProto uses baseScalar
  const msgResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
  if (msgResult.ok) {
    const resolved = msgResult.value.resolve();
    assert(typeof resolved === 'object', 'Message resolves to object');
    assertEqual(resolved.id, 1001, 'Resolved message has id property');
    assertEqual(resolved.subject, 'Hello World', 'Resolved message has subject property');
    // sender should be the computed value (parsed email), not raw string
    assert(typeof resolved.sender === 'object', 'Resolved message has parsed sender');
    assertEqual(resolved.sender.address, 'alice@example.com', 'Sender address is parsed');
  }

  // Rule uses baseScalar - should also return object with properties
  const ruleResult = resolveURI('mail://rules[0]');
  if (ruleResult.ok) {
    const resolved = ruleResult.value.resolve();
    assert(typeof resolved === 'object', 'Rule resolves to object');
    assertEqual(resolved.name, 'Spam Filter', 'Resolved rule has name property');
    assertEqual(resolved.enabled, true, 'Resolved rule has enabled property');
  }

  // Account uses baseScalar - should also return object with properties
  const accResult = resolveURI('mail://accounts[0]');
  if (accResult.ok) {
    const resolved = accResult.value.resolve();
    assert(typeof resolved === 'object', 'Account resolves to object');
    assertEqual(resolved.name, 'Work', 'Resolved account has name property');
    assertEqual(resolved.fullName, 'John Doe', 'Resolved account has fullName property');
  }
}

function testCollectionResolution() {
  group('Collection Resolution');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // messages collection resolve() should return array of specifiers (URIs)
  const messagesResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages');
  if (messagesResult.ok) {
    const resolved = messagesResult.value.resolve() as any[];
    assert(Array.isArray(resolved), 'Messages collection resolves to array');
    assertEqual(resolved.length, 2, 'Messages array has 2 items');

    // Each item should be a specifier with uri property (just uri, no id/name)
    assert(resolved[0] !== null, 'First message specifier is not null');
    assert('uri' in resolved[0], 'First message specifier has uri');
    assert(resolved[0].uri.href.includes('messages%5B0%5D'), 'First message URI has correct index');
    assert('uri' in resolved[1], 'Second message specifier has uri');
  }

  // To get actual data, use byIndex() or byId() then resolve()
  if (messagesResult.ok) {
    const firstMsg = messagesResult.value.byIndex(0).resolve() as any;
    assertEqual(firstMsg.subject, 'Hello World', 'First message has subject via byIndex');

    const secondMsg = messagesResult.value.byIndex(1).resolve() as any;
    assertEqual(secondMsg.subject, 'Meeting Tomorrow', 'Second message has subject via byIndex');
  }

  // Rules collection should resolve to array of specifiers
  const rulesResult = resolveURI('mail://rules');
  if (rulesResult.ok) {
    const resolved = rulesResult.value.resolve() as any[];
    assert(Array.isArray(resolved), 'Rules collection resolves to array');
    assertEqual(resolved.length, 2, 'Rules array has 2 items');
    assert('uri' in resolved[0], 'First rule specifier has uri');

    // To get actual data, use byIndex/byName then resolve
    const firstRule = rulesResult.value.byIndex(0).resolve() as any;
    assertEqual(firstRule.name, 'Spam Filter', 'First rule name via byIndex');
  }

  // Accounts collection
  const accountsResult = resolveURI('mail://accounts');
  if (accountsResult.ok) {
    const resolved = accountsResult.value.resolve() as any[];
    assert(Array.isArray(resolved), 'Accounts collection resolves to array');
    assertEqual(resolved.length, 2, 'Accounts array has 2 items');
    assert('uri' in resolved[0], 'First account specifier has uri');

    // To get actual data, use byIndex/byName then resolve
    const firstAccount = accountsResult.value.byIndex(0).resolve() as any;
    assertEqual(firstAccount.name, 'Work', 'First account name via byIndex');
  }
}

function testLazyContentResolution() {
  group('Lazy Content Resolution (specifierFor)');

  const mockData = createMockMailData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);

  // Test 1: When resolving a message, content should be a specifier (lazy)
  const msgResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001');
  if (msgResult.ok) {
    const message = msgResult.value.resolve() as any;
    assert(typeof message.content === 'object', 'Content in message is an object (specifier)');
    assert('uri' in message.content, 'Content has uri property (is a specifier)');
    assert(message.content.uri.href.includes('content'), 'Content specifier URI includes "content"');
  }

  // Test 2: Direct resolution of content should return actual value
  const contentResult = resolveURI('mail://accounts[0]/mailboxes/INBOX/messages/1001/content');
  if (contentResult.ok) {
    const content = contentResult.value.resolve();
    assertEqual(content, 'Hello, this is the message body content.', 'Direct content resolution returns actual text');
  }

  // Test 3: readResource on content should return actual value
  const readResult = readResource(new URL('mail://accounts[0]/mailboxes/INBOX/messages/1001/content'));
  if (assertReadOk(readResult, 'readResource on content succeeds') && readResult.ok) {
    assertEqual(readResult.text, 'Hello, this is the message body content.', 'readResource returns actual content');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time type tests
// ─────────────────────────────────────────────────────────────────────────────
// These use @ts-expect-error to verify that unsupported patterns are type errors.
// If the pattern becomes valid, TypeScript will error on the @ts-expect-error comment.

function compileTimeTypeTests() {
  // These tests don't run - they verify type checking at compile time
  const mockData = createOperationsMockData();
  registerScheme('mail', () => createMockDelegate(mockData, 'mail'), MailApplicationProto);
  const delegate = createMockDelegate(mockData, 'mail');
  const mail = getMailApp(delegate);

  const inbox = mail.accounts.byName('Work').mailboxes.byName('INBOX');

  // VALID: collection.resolve() returns CollectionResolveResult
  // (array of {uri: URL} possibly with extra fields)
  const specifiers = inbox.messages.resolve();
  // Can access uri on first element
  if (specifiers.length > 0) {
    const firstUri: URL = specifiers[0].uri;
  }

  // VALID: item.resolve() returns data
  const message = inbox.messages.byId(1001);
  const subject: string = message.subject.resolve();

  // @ts-expect-error - resolve_eager() no longer exists
  inbox.messages.resolve_eager();

  // @ts-expect-error - resolve_eager() no longer exists on items
  message.resolve_eager();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination Tests
// ─────────────────────────────────────────────────────────────────────────────

function createLargeCollectionMockData() {
  // Generate 150 messages for pagination testing
  const messages: any[] = [];
  for (let i = 0; i < 150; i++) {
    messages.push({
      id: 2000 + i,
      messageId: `<msg${i}@test.com>`,
      subject: `Test Message ${i}`,
      sender: `sender${i}@example.com`,
      dateSent: `2024-01-${String(15 + (i % 15)).padStart(2, '0')}T10:00:00Z`,
      dateReceived: `2024-01-${String(15 + (i % 15)).padStart(2, '0')}T10:01:00Z`,
      readStatus: i % 2 === 0,
      flaggedStatus: false,
      messageSize: 1024 + i,
      toRecipients: [{ name: 'Test', address: 'test@test.com' }],
      ccRecipients: [],
      bccRecipients: [],
      mailAttachments: [],
    });
  }

  return {
    name: 'Mail',
    version: '16.0',
    accounts: [
      {
        id: 'acc1',
        name: 'TestAccount',
        fullName: 'Test User',
        emailAddresses: ['test@test.com'],
        mailboxes: [
          {
            name: 'LargeMailbox',
            unreadCount: 75,
            messages,
            mailboxes: [],
          },
        ],
      },
    ],
    rules: [],
    signatures: [],
    inbox: { name: 'All Inboxes', unreadCount: 0, messages: [], mailboxes: [] },
    sentMailbox: { name: 'All Sent', unreadCount: 0, messages: [], mailboxes: [] },
    draftsMailbox: { name: 'All Drafts', unreadCount: 0, messages: [], mailboxes: [] },
    trashMailbox: { name: 'All Trash', unreadCount: 0, messages: [], mailboxes: [] },
    junkMailbox: { name: 'All Junk', unreadCount: 0, messages: [], mailboxes: [] },
    outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
    alwaysBccMyself: false,
    alwaysCcMyself: false,
    fetchInterval: 5,
  };
}

function assertReadOk(result: ReadResourceResult, message: string): boolean {
  testCount++;
  if (result.ok) {
    passCount++;
    console.log(`  \u2713 ${message}`);
    return true;
  } else {
    console.log(`  \u2717 ${message}`);
    console.log(`      error: ${result.error}`);
    return false;
  }
}

function testPagination() {
  group('Collection Pagination');

  // Use factory function for fresh data each time
  const freshLargeData = () => createMockDelegate(createLargeCollectionMockData(), 'mail');
  registerScheme('mail', freshLargeData, MailApplicationProto);

  // Test 1: Default limit (20) applied to large collection
  const defaultResult = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages'));
  if (assertReadOk(defaultResult, 'Read large collection without limit') && defaultResult.ok) {
    const data = defaultResult.text as any;
    assert('_pagination' in data, 'Response has _pagination metadata');
    assertEqual(data._pagination.total, 150, 'Total count is 150');
    assertEqual(data._pagination.returned, 20, 'Default returns 20 items');
    assertEqual(data._pagination.limit, 20, 'Default limit is 20');
    assertEqual(data._pagination.offset, 0, 'Default offset is 0');
    assertEqual(data.items.length, 20, 'Items array has 20 elements');
    assert(data._pagination.next !== null, 'Has next page URL');
    assert(data._pagination.next.includes('offset=20'), 'Next URL has offset=20');
  }

  // Test 2: Explicit limit=50 - framework applies it, we see 50 items (no extra truncation)
  registerScheme('mail', freshLargeData, MailApplicationProto);
  const limit50Result = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=50'));
  if (assertReadOk(limit50Result, 'Read with limit=50') && limit50Result.ok) {
    const data = limit50Result.text as any;
    // When limit is explicitly requested and honored, no pagination wrapper needed
    assert(Array.isArray(data), 'With explicit limit=50, returns plain array');
    assertEqual(data.length, 50, 'Returns exactly 50 items');
  }

  // Test 3: Limit over max (100) gets capped - framework returns 500 but we cap to 100
  registerScheme('mail', freshLargeData, MailApplicationProto);
  const limit500Result = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=500'));
  if (assertReadOk(limit500Result, 'Read with limit=500 (should cap to 100)') && limit500Result.ok) {
    const data = limit500Result.text as any;
    assert('_pagination' in data, 'Over-limit request has pagination wrapper');
    assertEqual(data._pagination.returned, 100, 'Capped to 100 items');
    assertEqual(data._pagination.limit, 100, 'Limit capped to 100');
    assertEqual(data.items.length, 100, 'Items array has 100 elements');
  }

  // Test 4: Small collection (under default limit) returns all items without pagination
  registerScheme('mail', () => createMockDelegate(createMockMailData(), 'mail'), MailApplicationProto);
  const smallResult = readResource(new URL('mail://accounts[0]/mailboxes/INBOX/messages'));
  if (assertReadOk(smallResult, 'Read small collection') && smallResult.ok) {
    const data = smallResult.text as any;
    assert(!('_pagination' in data), 'Small collection has no pagination wrapper');
    assert(Array.isArray(data), 'Small collection returns plain array');
  }

  // Test 5: Offset pagination works (with limit under max)
  registerScheme('mail', freshLargeData, MailApplicationProto);
  const offsetResult = readResource(new URL('mail://accounts[0]/mailboxes/LargeMailbox/messages?limit=20&offset=140'));
  if (assertReadOk(offsetResult, 'Read with offset=140, limit=20') && offsetResult.ok) {
    const data = offsetResult.text as any;
    // With explicit limit=20 at offset 140, we get 10 items (150-140=10)
    assert(Array.isArray(data), 'With explicit limit, returns plain array');
    assertEqual(data.length, 10, 'Returns remaining 10 items');
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
testObjectResolution();
testCollectionResolution();
testPagination();
testLazyContentResolution();

const frameworkTestResult = summary();
resetCounters();
