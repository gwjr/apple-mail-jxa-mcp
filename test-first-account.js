#!/usr/bin/env osascript -l JavaScript

// Minimal test: get first account using the new specifier API

ObjC.import('stdlib');

// Load the compiled code (use mail-test.js which excludes server startup)
const code = $.NSString.stringWithContentsOfFileEncodingError(
  'dist/mail-test.js',
  $.NSUTF8StringEncoding,
  null
).js;
eval(code);

// Test: get first account via URI
const spec = specifierFromURI('mail://accounts[0]');
if (!spec.ok) {
  console.log('URI parse error:', spec.error);
  $.exit(1);
}

const result = spec.value.resolve();
if (result.ok) {
  console.log('First account:');
  console.log(JSON.stringify(result.value, null, 2));
} else {
  console.log('Error:', result.error);
  $.exit(1);
}
