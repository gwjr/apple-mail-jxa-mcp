#!/usr/bin/env osascript -l JavaScript

ObjC.import('stdlib');

const code = $.NSString.stringWithContentsOfFileEncodingError(
  'dist/mail-test.js',
  $.NSUTF8StringEncoding,
  null
).js;
eval(code);

console.log('=== Declarative Schema Test ===\n');

// Test specifierFromURI
console.log('=== URI Deserialization ===');
const uris = [
  'mail://',
  'mail://accounts',
  'mail://accounts[0]',
  'mail://accounts[0]/mailboxes',
  'mail://accounts[0]/mailboxes/INBOX',
  'mail://accounts[0]/mailboxes/INBOX/mailboxes',  // nested mailboxes
  'mail://accounts[0]/mailboxes?name=Inbox',  // whose filter
  'mail://accounts[0]/mailboxes?sort=name.asc',  // sort only
  'mail://accounts[0]/mailboxes?unreadCount.gt=0&sort=unreadCount.desc',  // filter + sort
  'mail://accounts[0]/mailboxes?limit=3',  // pagination: limit only
  'mail://accounts[0]/mailboxes?offset=2&limit=3',  // pagination: offset + limit
  'mail://accounts[0]/mailboxes?sort=name.asc&limit=5',  // sort + pagination
  // Standard mailboxes
  'mail://inbox',
  'mail://inbox/messages',
  'mail://inbox/messages?readStatus=false&limit=5',
  'mail://inbox/messages?limit=2&expand=content',  // expand content inline
  'mail://sent',
  'mail://drafts',
  'mail://trash',
  'mail://junk',
  'mail://outbox',
];

for (const uri of uris) {
  const result = specifierFromURI(uri);
  if (result.ok) {
    console.log(`${uri} → ${result.value.uri}`);
  } else {
    console.log(`${uri} → ERROR: ${result.error}`);
  }
}
console.log('');

// Test readResource
console.log('=== MCP Resource Handler ===');
const resource = readResource('mail://accounts[0]');
console.log('readResource(mail://accounts[0]):', resource.mimeType, typeof resource.text);
console.log('');

// Get accounts collection via URI
const accountsResult = specifierFromURI('mail://accounts');
const accounts = accountsResult.value;
console.log('accounts.uri:', accounts.uri);

// Get first account by index
const accResult2 = specifierFromURI('mail://accounts[0]');
const acc = accResult2.value;
console.log('acc.uri:', acc.uri);

// Resolve just the name
const nameResult = acc.name.resolve();
console.log('acc.name.resolve():', nameResult.ok ? nameResult.value : nameResult.error);

// Resolve the whole account
const accResult = acc.resolve();
if (accResult.ok) {
  console.log('\nResolved Account:');
  console.log('  id:', accResult.value.id);
  console.log('  name:', accResult.value.name);
  console.log('  fullName:', accResult.value.fullName);
  console.log('  mailboxes.uri:', accResult.value.mailboxes.uri);
}

// Navigate to mailboxes
const mailboxes = acc.mailboxes;
console.log('\nmailboxes.uri:', mailboxes.uri);

// List mailbox names
const mailboxesResult = mailboxes.resolve();
if (mailboxesResult.ok) {
  console.log('Mailboxes:', mailboxesResult.value.map(m => `${m.name} (${m.unreadCount})`).slice(0, 5));

  // Find a mailbox with messages
  const withMessages = mailboxesResult.value.find(m => m.unreadCount > 0);
  if (withMessages) {
    console.log('\n=== Messages in', withMessages.name, '===');
    console.log('messages.uri:', withMessages.messages.uri);

    // Get first message
    const msgSpec = withMessages.messages.byIndex(0);
    console.log('msgSpec.uri:', msgSpec.uri);

    // Resolve just the subject (one Apple Event)
    const subjectResult = msgSpec.subject.resolve();
    console.log('subject:', subjectResult.ok ? subjectResult.value : subjectResult.error);

    // Resolve the whole message (content stays lazy)
    const msgResult = msgSpec.resolve();
    if (msgResult.ok) {
      console.log('\nResolved Message:');
      console.log('  id:', msgResult.value.id);
      console.log('  subject:', msgResult.value.subject);
      console.log('  sender.name:', msgResult.value.sender.name);
      console.log('  sender.address:', msgResult.value.sender.address);
      console.log('  content._isSpecifier:', msgResult.value.content._isSpecifier);
      console.log('  content.uri:', msgResult.value.content.uri);

      // Now resolve content separately
      const contentResult = msgResult.value.content.resolve();
      console.log('  content length:', contentResult.ok ? contentResult.value.length : contentResult.error);

      // Test recipients
      console.log('\n=== Recipients ===');
      const toResult = msgResult.value.toRecipients.resolve();
      if (toResult.ok && toResult.value.length > 0) {
        console.log('To:', toResult.value.map(r => `${r.name} <${r.address}>`).join(', '));
      }

      // Test attachments
      const attResult = msgResult.value.attachments.resolve();
      if (attResult.ok) {
        console.log('Attachments:', attResult.value.length);
        if (attResult.value.length > 0) {
          console.log('First:', attResult.value[0].name, attResult.value[0].fileSize, 'bytes');
        }
      }
    }
  } else {
    console.log('No mailbox with unread messages found');
  }

  // Test whose filter
  console.log('\n=== Whose Filter Test ===');
  const inboxFilter = mailboxes.whose({ name: { equals: 'Inbox' } });
  console.log('whose({ name: equals Inbox }).uri:', inboxFilter.uri);
  const inboxResult = inboxFilter.resolve();
  if (inboxResult.ok) {
    console.log('Found:', inboxResult.value.length, 'mailbox(es)');
    if (inboxResult.value.length > 0) {
      console.log('First match:', inboxResult.value[0].name);
    }
  } else {
    console.log('Error:', inboxResult.error);
  }

  // Test sort
  console.log('\n=== Sort Test ===');
  const sorted = mailboxes.sortBy({ by: 'unreadCount', direction: 'desc' });
  console.log('sortBy({ by: unreadCount, direction: desc }).uri:', sorted.uri);
  const sortedResult = sorted.resolve();
  if (sortedResult.ok) {
    console.log('Top 5 by unread:');
    sortedResult.value.slice(0, 5).forEach(m => {
      console.log(`  ${m.name}: ${m.unreadCount}`);
    });
  } else {
    console.log('Error:', sortedResult.error);
  }

  // Test filter + sort via URI
  console.log('\n=== Filter + Sort via URI ===');
  const comboResult = specifierFromURI('mail://accounts[0]/mailboxes?unreadCount.gt=0&sort=unreadCount.desc');
  if (comboResult.ok) {
    console.log('URI:', comboResult.value.uri);
    const resolved = comboResult.value.resolve();
    if (resolved.ok) {
      console.log('Mailboxes with unread, sorted desc:');
      resolved.value.slice(0, 5).forEach(m => {
        console.log(`  ${m.name}: ${m.unreadCount}`);
      });
    } else {
      console.log('Resolve error:', resolved.error);
    }
  } else {
    console.log('URI error:', comboResult.error);
  }

  // Test pagination via API
  console.log('\n=== Pagination Test (API) ===');
  const paginated = mailboxes.paginate({ limit: 3 });
  console.log('paginate({ limit: 3 }).uri:', paginated.uri);
  const paginatedResult = paginated.resolve();
  if (paginatedResult.ok) {
    console.log('Got', paginatedResult.value.length, 'mailboxes (limit 3):');
    paginatedResult.value.forEach(m => console.log(`  ${m.name}`));
  }

  // Test pagination with offset via API
  console.log('\n=== Pagination with Offset (API) ===');
  const paginatedOffset = mailboxes.paginate({ offset: 2, limit: 3 });
  console.log('paginate({ offset: 2, limit: 3 }).uri:', paginatedOffset.uri);
  const paginatedOffsetResult = paginatedOffset.resolve();
  if (paginatedOffsetResult.ok) {
    console.log('Got', paginatedOffsetResult.value.length, 'mailboxes (offset 2, limit 3):');
    paginatedOffsetResult.value.forEach(m => console.log(`  ${m.name}`));
  }

  // Test pagination via URI
  console.log('\n=== Pagination via URI ===');
  const paginatedUriResult = specifierFromURI('mail://accounts[0]/mailboxes?sort=name.asc&limit=5');
  if (paginatedUriResult.ok) {
    console.log('URI:', paginatedUriResult.value.uri);
    const resolved = paginatedUriResult.value.resolve();
    if (resolved.ok) {
      console.log('Sorted + paginated (limit 5):');
      resolved.value.forEach(m => console.log(`  ${m.name}`));
    }
  }
}

// Test standard mailboxes
console.log('\n=== Standard Mailboxes ===');

const standardMailboxes = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'outbox'];
for (const name of standardMailboxes) {
  const result = specifierFromURI(`mail://${name}`);
  if (result.ok) {
    const resolved = result.value.resolve();
    if (resolved.ok) {
      console.log(`${name}: ${resolved.value.name} (${resolved.value.unreadCount} unread)`);
    } else {
      console.log(`${name}: resolve error - ${resolved.error}`);
    }
  } else {
    console.log(`${name}: URI error - ${result.error}`);
  }
}

// Test inbox messages
console.log('\n=== Inbox Messages (first 3) ===');
const inboxMsgsResult = specifierFromURI('mail://inbox/messages?limit=3');
if (inboxMsgsResult.ok) {
  console.log('URI:', inboxMsgsResult.value.uri);
  const msgs = inboxMsgsResult.value.resolve();
  if (msgs.ok) {
    msgs.value.forEach(m => {
      console.log(`  ${m.subject.substring(0, 50)}... (from: ${m.sender.name} <${m.sender.address}>)`);
    });
  } else {
    console.log('Error:', msgs.error);
  }
}

// Test expand parameter
console.log('\n=== Expand Parameter Test ===');
const expandResult = specifierFromURI('mail://inbox/messages?limit=1&expand=content');
if (expandResult.ok) {
  console.log('URI:', expandResult.value.uri);
  const msgs = expandResult.value.resolve();
  if (msgs.ok && msgs.value.length > 0) {
    const m = msgs.value[0];
    console.log('Subject:', m.subject);
    console.log('Content is specifier?', m.content._isSpecifier === true);
    console.log('Content type:', typeof m.content);
    if (typeof m.content === 'string') {
      console.log('Content length:', m.content.length, '(expanded inline)');
    }
  }
}
