#!/usr/bin/env osascript -l JavaScript

// Minimal test: get first account

ObjC.import('stdlib');

// Load the compiled code
const code = $.NSString.stringWithContentsOfFileEncodingError(
  'dist/mail.js',
  $.NSUTF8StringEncoding,
  null
).js;
eval(code);

// Test: get first account
const accounts = Mail.accounts();
const first = accounts.byIndex(0);
const result = first.resolve();

if (result.ok) {
  console.log('First account:');
  console.log(JSON.stringify(result.value, null, 2));
} else {
  console.log('Error:', result.error);
}
