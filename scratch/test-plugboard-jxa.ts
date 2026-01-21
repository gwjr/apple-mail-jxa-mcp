// Test the plugboard v4 model with JXA
//
// Compile: npx tsc scratch/plugboard-v4.ts scratch/jxa-backing.ts scratch/test-plugboard-jxa.ts --outFile scratch/test-jxa.js --target ES2020 --module None --lib ES2020 --strict
// Run: osascript -l JavaScript scratch/test-jxa.js

declare function Application(name: string): any;
declare var console: { log(...args: any[]): void };

// ─────────────────────────────────────────────────────────────────────────────
// Test - uses types from plugboard-v4.ts and JXADelegate from jxa-backing.ts
// ─────────────────────────────────────────────────────────────────────────────

function initMailScheme(): void {
  const jxaApp = Application('Mail');
  registerScheme('mail', () => createJXADelegate(jxaApp, 'mail'), ApplicationProto);
}

function run() {
  console.log('=== Plugboard v4 JXA Test ===\n');

  // Initialize mail scheme for URI resolution
  initMailScheme();

  const jxaApp = Application('Mail');
  const delegate = createJXADelegate(jxaApp, 'mail');
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

  // ─────────────────────────────────────────────────────────────────────────
  // URI Resolution Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- URI Resolution Tests ---');

  // Test resolving root
  const rootResult = resolveURI('mail://');
  if (rootResult.ok) {
    console.log('Resolve mail:// -> specifier:', rootResult.value.specifier().uri);
    console.log('  name:', rootResult.value.name.resolve());
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
  } else {
    console.log('ERROR resolving mail://accounts[0]/mailboxes[0]:', mailbox0Result.error);
  }

  // Test resolving by name
  const accountName = account0.name.resolve();
  const byNameResult = resolveURI(`mail://accounts/${accountName}`);
  if (byNameResult.ok) {
    console.log(`Resolve mail://accounts/${accountName} -> specifier:`, byNameResult.value.specifier().uri);
    console.log('  name:', byNameResult.value.name.resolve());
  } else {
    console.log(`ERROR resolving mail://accounts/${accountName}:`, byNameResult.error);
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

  console.log('\n--- Query Tests (In-Memory) ---');

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

  // ─────────────────────────────────────────────────────────────────────────
  // Query URI Tests
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n--- Query URI Resolution Tests ---');

  // Test resolving URI with filter
  const filterResult = resolveURI('mail://accounts?name.contains=Ex');
  if (filterResult.ok) {
    console.log('Resolve mail://accounts?name.contains=Ex');
    console.log('  specifier:', filterResult.value.specifier().uri);
  } else {
    console.log('ERROR:', filterResult.error);
  }

  // Test resolving URI with combined query params
  const combinedResult = resolveURI('mail://accounts?name.startsWith=Ex&sort=name.asc&limit=10');
  if (combinedResult.ok) {
    console.log('Resolve mail://accounts?name.startsWith=Ex&sort=name.asc&limit=10');
    console.log('  specifier:', combinedResult.value.specifier().uri);
  } else {
    console.log('ERROR:', combinedResult.error);
  }

  console.log('\n=== JXA Test Complete ===');
}

run();
