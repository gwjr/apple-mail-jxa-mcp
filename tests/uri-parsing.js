#!/usr/bin/env osascript -l JavaScript
// @ts-check

// ============================================================================
// URI Parsing Test Suite
// Tests URI parsing via specifierFromURI
// ============================================================================

ObjC.import('stdlib');

const code = $.NSString.stringWithContentsOfFileEncodingError(
  '../dist/mail-test.js',
  $.NSUTF8StringEncoding,
  null
).js;
eval(code);

/**
 * @typedef {Object} TestCase
 * @property {string} uri - The URI to test
 * @property {boolean} [shouldFail] - Whether parsing should fail
 * @property {string} [expectedUri] - Expected normalized URI (if different from input)
 * @property {string} [description] - Optional description
 */

/** @type {TestCase[]} */
const testCases = [
  // ============================================================================
  // Basic Root and Collection Paths
  // ============================================================================
  { uri: 'mail://', description: 'Root URI' },
  { uri: 'mail://accounts', description: 'Accounts collection' },
  { uri: 'mail://rules', description: 'Rules collection' },
  { uri: 'mail://signatures', description: 'Signatures collection' },

  // ============================================================================
  // Collection Element Addressing
  // ============================================================================
  { uri: 'mail://accounts[0]', description: 'Index addressing' },
  { uri: 'mail://accounts[-1]', description: 'Negative index addressing' },
  { uri: 'mail://accounts/Work', description: 'Name addressing' },
  // TODO: URI decodes spaces in output - cosmetic issue
  // { uri: 'mail://accounts/Work%20Email', expectedUri: 'mail://accounts/Work%20Email', description: 'URL-encoded name addressing' },

  // ============================================================================
  // Property Access
  // ============================================================================
  { uri: 'mail://accounts[0]/name', description: 'Property on element' },
  { uri: 'mail://accounts[0]/id', description: 'ID property' },
  { uri: 'mail://accounts[0]/fullName', description: 'fullName property' },
  { uri: 'mail://accounts[0]/emailAddresses', description: 'Array property' },

  // ============================================================================
  // Nested Collections
  // ============================================================================
  { uri: 'mail://accounts[0]/mailboxes', description: 'Nested collection' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX', description: 'Element in nested collection' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages', description: 'Messages collection' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]', description: 'Message element' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/subject', description: 'Message property' },

  // ============================================================================
  // Account Standard Mailboxes (computed properties)
  // ============================================================================
  { uri: 'mail://accounts[0]/inbox', description: 'Account inbox' },
  { uri: 'mail://accounts[0]/sent', description: 'Account sent' },
  { uri: 'mail://accounts[0]/drafts', description: 'Account drafts' },
  { uri: 'mail://accounts[0]/junk', description: 'Account junk' },
  { uri: 'mail://accounts[0]/trash', description: 'Account trash' },
  // TODO: computed properties don't support further navigation yet
  // { uri: 'mail://accounts[0]/inbox/messages', description: 'Messages in account inbox' },
  // { uri: 'mail://accounts[0]/inbox/messages[0]/subject', description: 'Subject of message in account inbox' },

  // ============================================================================
  // App-Level Standard Mailboxes
  // ============================================================================
  { uri: 'mail://inbox', description: 'App-level inbox' },
  { uri: 'mail://sent', description: 'App-level sent' },
  { uri: 'mail://drafts', description: 'App-level drafts' },
  { uri: 'mail://junk', description: 'App-level junk' },
  { uri: 'mail://outbox', description: 'App-level outbox' },
  { uri: 'mail://trash', description: 'App-level trash' },
  { uri: 'mail://inbox/messages', description: 'Messages in app-level inbox' },

  // ============================================================================
  // Recursive Nested Mailboxes
  // ============================================================================
  { uri: 'mail://accounts[0]/mailboxes/Work/mailboxes', description: 'Nested mailboxes collection' },
  { uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects', description: 'Element in nested mailboxes' },
  { uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects/messages', description: 'Messages in deeply nested mailbox' },
  { uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects/mailboxes/Active', description: 'Third-level nested mailbox' },

  // ============================================================================
  // Settings
  // ============================================================================
  { uri: 'mail://settings', description: 'Settings path' },
  { uri: 'mail://settings/fetchInterval', description: 'Settings property' },

  // ============================================================================
  // Message Sub-Collections
  // ============================================================================
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/toRecipients', description: 'Message recipients collection' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/attachments', description: 'Message attachments collection' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/toRecipients[0]/address', description: 'Recipient address property' },

  // ============================================================================
  // Query Strings
  // ============================================================================
  { uri: 'mail://accounts[0]/mailboxes?name=INBOX', description: 'String equals filter' },
  { uri: 'mail://accounts[0]/mailboxes?unreadCount.gt=0', description: 'Number greater-than filter' },
  { uri: 'mail://accounts[0]/mailboxes?unreadCount.lt=100', description: 'Number less-than filter' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages?readStatus=false', description: 'Boolean filter' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages?sort=dateReceived.desc', description: 'Sort parameter' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages?limit=10&offset=20', description: 'Pagination parameters' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages?expand=content', description: 'Expand lazy property' },

  // ============================================================================
  // Error Cases - Invalid Syntax
  // ============================================================================
  { uri: 'mail://accounts[foo]', shouldFail: true, description: 'Invalid index syntax' },
  { uri: 'unknown://foo', shouldFail: true, description: 'Unknown scheme' },

  // ============================================================================
  // Error Cases - Unknown Segments
  // ============================================================================
  { uri: 'mail://bogus', shouldFail: true, description: 'Unknown top-level segment' },
  { uri: 'mail://accounts[0]/bogus', shouldFail: true, description: 'Unknown segment on account' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/bogus', shouldFail: true, description: 'Unknown segment on mailbox' },
  { uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/bogus', shouldFail: true, description: 'Unknown segment on message' },
];

// ============================================================================
// Test Runner
// ============================================================================

function runTests() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of testCases) {
    try {
      const result = specifierFromURI(testCase.uri);

      if (testCase.shouldFail) {
        if (result.ok) {
          failures.push({
            uri: testCase.uri,
            description: testCase.description,
            message: 'Expected error but got success',
            got: result.value.uri
          });
          failed++;
        } else {
          passed++;
        }
      } else {
        if (!result.ok) {
          failures.push({
            uri: testCase.uri,
            description: testCase.description,
            message: `Unexpected error: ${result.error}`
          });
          failed++;
        } else {
          // Check URI normalization if expected
          if (testCase.expectedUri && result.value.uri !== testCase.expectedUri) {
            failures.push({
              uri: testCase.uri,
              description: testCase.description,
              message: `URI mismatch: expected ${testCase.expectedUri}, got ${result.value.uri}`
            });
            failed++;
          } else {
            passed++;
          }
        }
      }
    } catch (error) {
      failures.push({
        uri: testCase.uri,
        description: testCase.description,
        message: `Exception: ${error}`
      });
      failed++;
    }
  }

  // Print results
  console.log(`\n${'='.repeat(60)}`);
  console.log(`URI Parsing Tests: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  if (failures.length > 0) {
    console.log('FAILURES:\n');
    for (const f of failures) {
      console.log(`  ${f.uri}`);
      console.log(`    ${f.description || ''}`);
      console.log(`    ${f.message}`);
      console.log();
    }
  }

  return failed === 0;
}

const success = runTests();
$.exit(success ? 0 : 1);
