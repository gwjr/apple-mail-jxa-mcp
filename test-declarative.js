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

// Get first mailbox
const mb = mailboxes.byIndex(0);
console.log('mb.uri:', mb.uri);

const mbResult = mb.resolve();
if (mbResult.ok) {
  console.log('Mailbox name:', mbResult.value.name);
}
