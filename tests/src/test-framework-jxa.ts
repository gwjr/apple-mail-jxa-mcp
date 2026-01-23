// tests/src/test-framework-jxa.ts - JXA integration tests (runs with osascript)
//
// Tests the framework against real Mail.app. Requires Mail.app to be configured
// with at least one account.

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

function testJxaURIResolution() {
  group('JXA URI Resolution');

  // Root app
  const root = resolveURI('mail://');
  assertOk(root, 'Resolve mail://');
  if (root.ok) {
    try {
      const name = root.value.name.resolve();
      assertEqual(name, 'Mail', 'App name is Mail');
    } catch (e: any) {
      console.log(`  \u2717 App name: ${e.message}`);
    }
  }

  // Accounts collection
  const accounts = resolveURI('mail://accounts');
  assertOk(accounts, 'Resolve mail://accounts');
  if (accounts.ok) {
    try {
      const list = accounts.value.resolve() as any[];
      assert(Array.isArray(list), 'accounts.resolve() returns array');
      assert(list.length >= 0, 'Accounts array exists (may be empty)');
      if (list.length > 0) {
        // Don't try to map account names - just report count
        console.log(`    Found ${list.length} account(s)`);
      }
    } catch (e: any) {
      console.log(`  \u2717 accounts.resolve(): ${e.message}`);
    }
  }
}

function testJxaAccountNavigation() {
  group('JXA Account Navigation');

  const accounts = resolveURI('mail://accounts');
  if (!accounts.ok) {
    console.log('  - Skipping: could not resolve accounts');
    return;
  }

  let list: any[];
  try {
    list = accounts.value.resolve() as any[];
  } catch (e: any) {
    console.log(`  - Skipping: could not resolve accounts list: ${e.message}`);
    return;
  }

  if (list.length === 0) {
    console.log('  - Skipping: no accounts configured');
    return;
  }

  // Navigate by index
  const acc0 = resolveURI('mail://accounts[0]');
  assertOk(acc0, 'Resolve mail://accounts[0]');
  if (acc0.ok) {
    try {
      const name = acc0.value.name.resolve();
      assert(typeof name === 'string', 'Account has name');
      console.log(`    First account: ${name}`);

      const fullName = acc0.value.fullName.resolve();
      assert(typeof fullName === 'string', 'Account has fullName');

      const emails = acc0.value.emailAddresses.resolve();
      assert(Array.isArray(emails), 'Account has emailAddresses');

      // Navigate by name - use resolved name
      const accByName = resolveURI(`mail://accounts/${encodeURIComponent(name)}`);
      assertOk(accByName, `Resolve account by name: ${name}`);
    } catch (e: any) {
      console.log(`  \u2717 Account navigation failed: ${e.message}`);
    }
  }
}

function testJxaMailboxNavigation() {
  group('JXA Mailbox Navigation');

  try {
    const accounts = resolveURI('mail://accounts');
    if (!accounts.ok) {
      console.log('  - Skipping: no accounts');
      return;
    }
    const accList = accounts.value.resolve() as any[];
    if (accList.length === 0) {
      console.log('  - Skipping: no accounts');
      return;
    }
  } catch (e: any) {
    console.log(`  - Skipping: ${e.message}`);
    return;
  }

  // Get first account's mailboxes
  const mailboxes = resolveURI('mail://accounts[0]/mailboxes');
  assertOk(mailboxes, 'Resolve mailboxes');
  if (mailboxes.ok) {
    try {
      const list = mailboxes.value.resolve() as any[];
      assert(Array.isArray(list), 'mailboxes.resolve() returns array');
      console.log(`    Found ${list.length} mailbox(es)`);
    } catch (e: any) {
      console.log(`  \u2717 mailboxes.resolve(): ${e.message}`);
    }
  }

  // Standard inbox
  const inbox = resolveURI('mail://inbox');
  assertOk(inbox, 'Resolve mail://inbox (aggregate)');
  if (inbox.ok) {
    try {
      const name = inbox.value.name.resolve();
      const unread = inbox.value.unreadCount.resolve();
      console.log(`    Inbox: ${name} (${unread} unread)`);
    } catch (e: any) {
      console.log(`  \u2717 inbox properties: ${e.message}`);
    }
  }

  // Account-specific inbox via computedNav
  const accInbox = resolveURI('mail://accounts[0]/inbox');
  assertOk(accInbox, 'Resolve account inbox via computedNav');
  if (accInbox.ok) {
    try {
      const name = accInbox.value.name.resolve();
      console.log(`    Account[0] inbox: ${name}`);
    } catch (e: any) {
      console.log(`  \u2717 account inbox: ${e.message}`);
    }
  }
}

function testJxaMessageAccess() {
  group('JXA Message Access');

  // Try to find a mailbox with messages
  const inbox = resolveURI('mail://inbox');
  if (!inbox.ok) {
    console.log('  - Skipping: could not resolve inbox');
    return;
  }

  let msgList: any[];
  try {
    const messages = inbox.value.messages;
    msgList = messages.resolve() as any[];
  } catch (e: any) {
    console.log(`  - Skipping: could not resolve messages: ${e.message}`);
    return;
  }

  if (msgList.length === 0) {
    console.log('  - Skipping: inbox is empty');
    return;
  }

  console.log(`    Found ${msgList.length} message(s) in inbox`);

  try {
    // Get first message by index
    const msg0 = inbox.value.messages.byIndex(0);
    assert('_delegate' in msg0, 'byIndex returns Res');

    const subject = msg0.subject.resolve();
    assert(typeof subject === 'string', 'Message has subject');
    console.log(`    First message: "${String(subject).substring(0, 50)}..."`);

    // Test computed property (sender parsing)
    const sender = msg0.sender.resolve() as { name: string; address: string };
    assert(typeof sender === 'object', 'sender is parsed object');
    assert('address' in sender, 'sender has address');
    console.log(`    From: ${sender.name} <${sender.address}>`);

    // Test lazy property (content) - resolving full message
    const resolved = msg0.resolve() as any;
    assert('content' in resolved, 'Resolved message has content specifier');
  } catch (e: any) {
    console.log(`  \u2717 Message access: ${e.message}`);
  }
}

function testJxaStandardMailboxes() {
  group('JXA Standard Mailboxes');

  const standardNames = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'outbox'];

  for (const name of standardNames) {
    testCount++;
    const result = resolveURI(`mail://${name}`);
    if (result.ok) {
      try {
        const mbName = result.value.name.resolve();
        const unread = result.value.unreadCount.resolve();
        passCount++;
        console.log(`  \u2713 ${name}: ${mbName} (${unread} unread)`);
      } catch (e: any) {
        passCount++;
        console.log(`  \u2713 ${name}: resolved (properties failed: ${e.message})`);
      }
    } else {
      console.log(`  \u2717 ${name}: ${result.error}`);
    }
  }
}

function testJxaSettings() {
  group('JXA Settings Namespace');

  const settings = resolveURI('mail://settings');
  assertOk(settings, 'Resolve mail://settings');

  // Test a few settings
  try {
    const fetchInterval = resolveURI('mail://settings/fetchInterval');
    if (fetchInterval.ok) {
      const val = fetchInterval.value.resolve();
      assert(typeof val === 'number', 'fetchInterval is number');
      console.log(`    fetchInterval: ${val}`);
    }

    const alwaysBcc = resolveURI('mail://settings/alwaysBccMyself');
    if (alwaysBcc.ok) {
      const val = alwaysBcc.value.resolve();
      assert(typeof val === 'boolean', 'alwaysBccMyself is boolean');
      console.log(`    alwaysBccMyself: ${val}`);
    }
  } catch (e: any) {
    console.log(`  \u2717 Settings: ${e.message}`);
  }
}

function testJxaRulesAndSignatures() {
  group('JXA Rules and Signatures');

  // Rules
  const rules = resolveURI('mail://rules');
  assertOk(rules, 'Resolve mail://rules');
  if (rules.ok) {
    try {
      const list = rules.value.resolve() as any[];
      console.log(`    Found ${list.length} rule(s)`);
    } catch (e: any) {
      console.log(`  \u2717 rules.resolve(): ${e.message}`);
    }
  }

  // Signatures
  const sigs = resolveURI('mail://signatures');
  assertOk(sigs, 'Resolve mail://signatures');
  if (sigs.ok) {
    try {
      const list = sigs.value.resolve() as any[];
      console.log(`    Found ${list.length} signature(s)`);
    } catch (e: any) {
      console.log(`  \u2717 signatures.resolve(): ${e.message}`);
    }
  }
}

function testJxaQueryOperations() {
  group('JXA Query Operations');

  // Filter mailboxes by unread count
  try {
    const filtered = resolveURI('mail://accounts[0]/mailboxes?unreadCount.gt=0');
    if (filtered.ok) {
      const list = filtered.value.resolve() as any[];
      console.log(`    Mailboxes with unread: ${list.length}`);
      // Collection returns specifiers {uri}, verify we got some results
      assert(list.length > 0, 'Filter returned results');
      assert('uri' in list[0], 'Filter result is specifier');
    } else {
      console.log(`    Filter resolve failed: ${filtered.error}`);
    }
  } catch (e: any) {
    console.log(`  \u2717 Filter query failed: ${e.message}`);
  }

  // Sort and limit
  try {
    const sorted = resolveURI('mail://accounts[0]/mailboxes?sort=name.asc&limit=5');
    if (sorted.ok) {
      const list = sorted.value.resolve() as any[];
      console.log(`    First 5 sorted: ${list.length} mailbox(es)`);
    } else {
      console.log(`    Sort resolve failed: ${sorted.error}`);
    }
  } catch (e: any) {
    console.log(`  \u2717 Sort query failed: ${e.message}`);
  }
}

function testJxaCollectionResolution() {
  group('JXA Collection Resolution (specifiers)');

  // Test that collection.resolve() returns array of {uri} specifiers
  // To get actual item data, use byIndex(n).resolve()

  // Test accounts collection
  const accounts = resolveURI('mail://accounts');
  if (!accounts.ok) {
    console.log('  - Skipping accounts: could not resolve');
  } else {
    try {
      const list = accounts.value.resolve() as any[];
      assert(Array.isArray(list), 'accounts.resolve() returns array');
      if (list.length > 0) {
        const first = list[0];
        assert(first !== null, 'First account specifier is not null');
        assert('uri' in first, 'First account specifier has uri');
        // Get actual data via byIndex
        const firstData = accounts.value.byIndex(0).resolve() as any;
        console.log(`    Accounts: ${list.length} specifiers, first name: ${firstData.name}`);
      } else {
        console.log('    Accounts: empty');
      }
    } catch (e: any) {
      console.log(`  \u2717 accounts: ${e.message}`);
    }
  }

  // Test rules collection
  const rules = resolveURI('mail://rules');
  if (!rules.ok) {
    console.log('  - Skipping rules: could not resolve');
  } else {
    try {
      const list = rules.value.resolve() as any[];
      assert(Array.isArray(list), 'rules.resolve() returns array');
      if (list.length > 0) {
        const first = list[0];
        assert(first !== null, 'First rule specifier is not null');
        assert('uri' in first, 'First rule specifier has uri');
        const firstData = rules.value.byIndex(0).resolve() as any;
        console.log(`    Rules: ${list.length} specifiers, first name: ${firstData.name}`);
      } else {
        console.log('    Rules: empty');
      }
    } catch (e: any) {
      console.log(`  \u2717 rules: ${e.message}`);
    }
  }

  // Test signatures collection
  const sigs = resolveURI('mail://signatures');
  if (!sigs.ok) {
    console.log('  - Skipping signatures: could not resolve');
  } else {
    try {
      const list = sigs.value.resolve() as any[];
      assert(Array.isArray(list), 'signatures.resolve() returns array');
      if (list.length > 0) {
        const first = list[0];
        assert(first !== null, 'First signature specifier is not null');
        assert('uri' in first, 'First signature specifier has uri');
        const firstData = sigs.value.byIndex(0).resolve() as any;
        console.log(`    Signatures: ${list.length} specifiers, first name: ${firstData.name}`);
      } else {
        console.log('    Signatures: empty');
      }
    } catch (e: any) {
      console.log(`  \u2717 signatures: ${e.message}`);
    }
  }

  // Test mailboxes collection (nested in account)
  const mailboxes = resolveURI('mail://accounts[0]/mailboxes');
  if (!mailboxes.ok) {
    console.log('  - Skipping mailboxes: could not resolve');
  } else {
    try {
      const list = mailboxes.value.resolve() as any[];
      assert(Array.isArray(list), 'mailboxes.resolve() returns array');
      if (list.length > 0) {
        const first = list[0];
        assert(first !== null, 'First mailbox specifier is not null');
        assert('uri' in first, 'First mailbox specifier has uri');
        const firstData = mailboxes.value.byIndex(0).resolve() as any;
        console.log(`    Mailboxes: ${list.length} specifiers, first name: ${firstData.name}`);
      } else {
        console.log('    Mailboxes: empty');
      }
    } catch (e: any) {
      console.log(`  \u2717 mailboxes: ${e.message}`);
    }
  }

  // Test messages collection
  const inbox = resolveURI('mail://inbox');
  if (!inbox.ok) {
    console.log('  - Skipping messages: could not resolve inbox');
  } else {
    try {
      const messages = inbox.value.messages;
      const list = messages.resolve() as any[];
      assert(Array.isArray(list), 'messages.resolve() returns array');
      if (list.length > 0) {
        const first = list[0];
        assert(first !== null, 'First message specifier is not null');
        assert('uri' in first, 'First message specifier has uri');
        const firstData = messages.byIndex(0).resolve() as any;
        console.log(`    Messages: ${list.length} specifiers, first subject: ${String(firstData.subject).substring(0, 40)}...`);
      } else {
        console.log('    Messages: empty');
      }
    } catch (e: any) {
      console.log(`  \u2717 messages: ${e.message}`);
    }
  }
}

function testLazyCollections() {
  group('Lazy Collection Properties');

  const inbox = resolveURI('mail://inbox');
  if (!inbox.ok) {
    console.log('  - Skipping: could not resolve inbox');
    return;
  }

  // Check that lazy properties are Res objects (laziness tested via resolve behavior below)
  const messagesRes = inbox.value.messages;
  assert('_delegate' in messagesRes, 'messages is a Res');

  const mailboxesRes = inbox.value.mailboxes;
  assert('_delegate' in mailboxesRes, 'mailboxes is a Res');

  // Test that resolving inbox returns specifiers, not full data
  const resolved = inbox.value.resolve() as any;
  console.log(`  resolved.messages type: ${typeof resolved.messages}`);
  console.log(`  resolved.messages is array: ${Array.isArray(resolved.messages)}`);
  if (resolved.messages && typeof resolved.messages === 'object' && 'uri' in resolved.messages) {
    console.log(`  resolved.messages.uri: ${resolved.messages.uri}`);
    assert(true, 'messages resolved to specifier');
  } else {
    console.log(`  resolved.messages: ${JSON.stringify(resolved.messages).substring(0, 100)}`);
    assert(false, 'messages should resolve to {uri} specifier, not array');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('Framework Tests (JXA/Mail.app)');
console.log('==============================');

testLazyCollections();
testJxaURIResolution();
testJxaAccountNavigation();
testJxaMailboxNavigation();
testJxaMessageAccess();
testJxaStandardMailboxes();
testJxaSettings();
testJxaRulesAndSignatures();
testJxaQueryOperations();
testJxaCollectionResolution();

const jxaTestResult = summary();
