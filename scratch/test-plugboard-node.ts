// Test the plugboard v4 model with Node.js (mock data)
//
// Compile: npx tsc scratch/plugboard-v4.ts scratch/mock-backing.ts scratch/test-plugboard-node.ts --outFile scratch/test-node.js --target ES2020 --module None --lib ES2020 --strict
// Run: node scratch/test-node.js

declare var console: { log(...args: any[]): void };

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data - mirrors Mail.app hierarchy
// ─────────────────────────────────────────────────────────────────────────────

const mockMailData = {
  name: 'Mail',
  version: '16.0',
  accounts: [
    {
      id: 1,
      name: 'Exchange',
      email: 'user@example.com',
      mailboxes: [
        {
          id: 101,
          name: 'INBOX',
          unreadCount: 5,
          mailboxes: [],
          messages: [
            { id: 1001, subject: 'Hello World', sender: 'alice@example.com', dateSent: '2024-01-15', isRead: true, content: 'Hello!' },
            { id: 1002, subject: 'Meeting Tomorrow', sender: 'bob@example.com', dateSent: '2024-01-16', isRead: false, content: 'Meeting at 10am' },
            { id: 1003, subject: 'Project Update', sender: 'charlie@example.com', dateSent: '2024-01-17', isRead: false, content: 'Status update...' },
          ]
        },
        {
          id: 102,
          name: 'Sent',
          unreadCount: 0,
          mailboxes: [],
          messages: [
            { id: 1010, subject: 'Re: Hello World', sender: 'user@example.com', dateSent: '2024-01-15', isRead: true, content: 'Thanks!' },
          ]
        },
        {
          id: 103,
          name: 'Archive',
          unreadCount: 0,
          mailboxes: [
            { id: 1031, name: '2023', unreadCount: 0, mailboxes: [], messages: [] },
            { id: 1032, name: '2024', unreadCount: 0, mailboxes: [], messages: [] },
          ],
          messages: []
        }
      ]
    },
    {
      id: 2,
      name: 'Gmail',
      email: 'user@gmail.com',
      mailboxes: [
        {
          id: 201,
          name: 'INBOX',
          unreadCount: 12,
          mailboxes: [],
          messages: [
            { id: 2001, subject: 'Newsletter', sender: 'news@example.com', dateSent: '2024-01-18', isRead: false, content: 'Weekly update' },
          ]
        }
      ]
    }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// Test - uses types from plugboard-v4.ts and MockDelegate from mock-backing.ts
// ─────────────────────────────────────────────────────────────────────────────

function initMailScheme(): void {
  registerScheme('mail', () => createMockDelegate(mockMailData, 'mail'), ApplicationProto);
}

function run() {
  console.log('=== Plugboard v4 Node Test (Mock Data) ===\n');

  // Initialize mail scheme for URI resolution
  initMailScheme();

  const delegate = createMockDelegate(mockMailData, 'mail');
  const mail = getMailApp(delegate);

  // Test app-level specifier
  console.log('App specifier:', mail.specifier().uri);
  console.log('App name:', mail.name.resolve());
  console.log('App version:', mail.version.resolve());

  console.log('\n--- URI Generation Tests ---');

  const account0 = mail.accounts.byIndex(0);
  console.log('accounts[0] specifier:', account0.specifier().uri);
  console.log('accounts[0] name:', account0.name.resolve());

  const mailbox0 = account0.mailboxes.byIndex(0);
  console.log('accounts[0]/mailboxes[0] specifier:', mailbox0.specifier().uri);
  console.log('  mailbox name:', mailbox0.name.resolve());

  // Test byName
  const exchangeAccount = mail.accounts.byName('Exchange');
  console.log('accounts/Exchange specifier:', exchangeAccount.specifier().uri);
  console.log('  name:', exchangeAccount.name.resolve());

  // Test nested mailboxes
  const archiveMailbox = exchangeAccount.mailboxes.byName('Archive');
  console.log('Archive mailbox specifier:', archiveMailbox.specifier().uri);
  console.log('  unreadCount:', archiveMailbox.unreadCount.resolve());

  // ─────────────────────────────────────────────────────────────────────────
  // URI Resolution Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- URI Resolution Tests ---');

  // Test resolving root
  const rootResult = resolveURI('mail://');
  if (rootResult.ok) {
    console.log('Resolve mail:// -> specifier:', rootResult.value.specifier().uri);
    console.log('  name:', rootResult.value.name.resolve());
    console.log('  version:', rootResult.value.version.resolve());
  } else {
    console.log('ERROR resolving mail://:', rootResult.error);
  }

  // Test resolving accounts[0]
  const account0Result = resolveURI('mail://accounts[0]');
  if (account0Result.ok) {
    console.log('Resolve mail://accounts[0] -> specifier:', account0Result.value.specifier().uri);
    console.log('  name:', account0Result.value.name.resolve());
  } else {
    console.log('ERROR resolving mail://accounts[0]:', account0Result.error);
  }

  // Test resolving accounts[0]/mailboxes[0]
  const mailbox0Result = resolveURI('mail://accounts[0]/mailboxes[0]');
  if (mailbox0Result.ok) {
    console.log('Resolve mail://accounts[0]/mailboxes[0] -> specifier:', mailbox0Result.value.specifier().uri);
    console.log('  name:', mailbox0Result.value.name.resolve());
    console.log('  unreadCount:', mailbox0Result.value.unreadCount.resolve());
  } else {
    console.log('ERROR resolving mail://accounts[0]/mailboxes[0]:', mailbox0Result.error);
  }

  // Test resolving by name
  const byNameResult = resolveURI('mail://accounts/Gmail');
  if (byNameResult.ok) {
    console.log('Resolve mail://accounts/Gmail -> specifier:', byNameResult.value.specifier().uri);
    console.log('  name:', byNameResult.value.name.resolve());
  } else {
    console.log('ERROR resolving mail://accounts/Gmail:', byNameResult.error);
  }

  // Test error case - unknown segment
  const errorResult = resolveURI('mail://foobar');
  if (errorResult.ok) {
    console.log('Resolve mail://foobar -> unexpectedly succeeded');
  } else {
    console.log('Resolve mail://foobar -> ERROR (expected):', errorResult.error);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Query Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Query Tests (applyQueryState) ---');

  const testData = [
    { name: 'Alice', age: 30, email: 'alice@example.com' },
    { name: 'Bob', age: 25, email: 'bob@example.com' },
    { name: 'Charlie', age: 35, email: 'charlie@example.com' },
    { name: 'Diana', age: 28, email: 'diana@example.com' },
  ];

  console.log('Original data count:', testData.length);

  // Filter: age > 27
  const filtered = applyQueryState(testData, {
    filter: { age: gt(27) }
  });
  console.log('Filter age > 27:', filtered.map(x => x.name).join(', '));

  // Filter: name contains 'a'
  const containsA = applyQueryState(testData, {
    filter: { name: contains('a') }
  });
  console.log('Filter name contains "a":', containsA.map(x => x.name).join(', '));

  // Sort by age descending
  const sortedDesc = applyQueryState(testData, {
    sort: { by: 'age', direction: 'desc' }
  });
  console.log('Sort by age desc:', sortedDesc.map(x => `${x.name}(${x.age})`).join(', '));

  // Paginate: limit 2, offset 1
  const paginated = applyQueryState(testData, {
    pagination: { limit: 2, offset: 1 }
  });
  console.log('Paginate limit=2 offset=1:', paginated.map(x => x.name).join(', '));

  // Combined: filter + sort + paginate
  const combined = applyQueryState(testData, {
    filter: { age: gt(25) },
    sort: { by: 'name', direction: 'asc' },
    pagination: { limit: 2 }
  });
  console.log('Combined (age>25, sort name asc, limit 2):', combined.map(x => x.name).join(', '));

  // ─────────────────────────────────────────────────────────────────────────
  // Query URI Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Query URI Resolution Tests ---');

  // Test resolving URI with filter
  const filterResult = resolveURI('mail://accounts?name.contains=Ex');
  if (filterResult.ok) {
    console.log('Resolve mail://accounts?name.contains=Ex');
    console.log('  specifier:', filterResult.value.specifier().uri);
    // Resolve to get filtered data
    const resolved = filterResult.value.resolve();
    console.log('  result count:', resolved.length);
    console.log('  names:', resolved.map((x: any) => x.name).join(', '));
  } else {
    console.log('ERROR:', filterResult.error);
  }

  // Test resolving URI with sort
  const sortResult = resolveURI('mail://accounts?sort=name.desc');
  if (sortResult.ok) {
    console.log('Resolve mail://accounts?sort=name.desc');
    console.log('  specifier:', sortResult.value.specifier().uri);
    const resolved = sortResult.value.resolve();
    console.log('  names:', resolved.map((x: any) => x.name).join(', '));
  } else {
    console.log('ERROR:', sortResult.error);
  }

  // Test resolving URI with pagination
  const pageResult = resolveURI('mail://accounts?limit=1&offset=0');
  if (pageResult.ok) {
    console.log('Resolve mail://accounts?limit=1&offset=0');
    console.log('  specifier:', pageResult.value.specifier().uri);
    const resolved = pageResult.value.resolve();
    console.log('  result count:', resolved.length);
    console.log('  names:', resolved.map((x: any) => x.name).join(', '));
  } else {
    console.log('ERROR:', pageResult.error);
  }

  // Test resolving URI with combined query params
  const combinedResult = resolveURI('mail://accounts?sort=name.asc&limit=10');
  if (combinedResult.ok) {
    console.log('Resolve mail://accounts?sort=name.asc&limit=10');
    console.log('  specifier:', combinedResult.value.specifier().uri);
    const resolved = combinedResult.value.resolve();
    console.log('  names:', resolved.map((x: any) => x.name).join(', '));
  } else {
    console.log('ERROR:', combinedResult.error);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MockDelegate Verification - same proto code works
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Verification: Same Proto Code Works ---');

  // Navigate deep into the mock data structure
  const nestedResult = resolveURI('mail://accounts/Exchange/mailboxes/Archive/mailboxes');
  if (nestedResult.ok) {
    console.log('Resolve nested path: mail://accounts/Exchange/mailboxes/Archive/mailboxes');
    console.log('  specifier:', nestedResult.value.specifier().uri);
    const resolved = nestedResult.value.resolve();
    console.log('  result count:', resolved.length);
    console.log('  names:', resolved.map((x: any) => x.name).join(', '));
  } else {
    console.log('ERROR:', nestedResult.error);
  }

  console.log('\n=== Node Test Complete ===');
}

run();
