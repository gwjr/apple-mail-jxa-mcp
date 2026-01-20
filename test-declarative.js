#!/usr/bin/env osascript -l JavaScript

ObjC.import('stdlib');

const code = $.NSString.stringWithContentsOfFileEncodingError(
  'dist/mail.js',
  $.NSUTF8StringEncoding,
  null
).js;
eval(code);

console.log('=== Declarative Schema Test ===\n');

// Get accounts collection
const accounts = Mail.accounts();
console.log('accounts.uri:', accounts.uri);

// Get first account by index
const acc = accounts.byIndex(0);
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
      console.log('  sender:', msgResult.value.sender);
      console.log('  content._isSpecifier:', msgResult.value.content._isSpecifier);
      console.log('  content.uri:', msgResult.value.content.uri);

      // Now resolve content separately
      const contentResult = msgResult.value.content.resolve();
      console.log('  content length:', contentResult.ok ? contentResult.value.length : contentResult.error);
    }
  } else {
    console.log('No mailbox with unread messages found');
  }
}
