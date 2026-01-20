#!/usr/bin/env osascript -l JavaScript
// @ts-check

// ============================================================================
// Route Parsing Test Harness
// Tests URI parsing against the route table WITHOUT making JXA calls
// ============================================================================

/**
 * @typedef {Object} ExpectedResult
 * @property {string[]} [segments] - Expected parsed segments
 * @property {'collection'|'property'|'virtual'|'computed'|'element'|'root'} [type] - Expected final node type
 * @property {number} [depth] - Expected depth for nested paths
 * @property {boolean} [valid] - For query validation tests
 * @property {string} [reason] - Expected reason for invalid queries
 * @property {boolean} [error] - Whether an error is expected
 * @property {string[]} [available] - Expected available options on error
 * @property {Object} [query] - Expected parsed query object
 */

/**
 * @typedef {Object} TestCase
 * @property {string} uri - The URI to test
 * @property {ExpectedResult} expect - Expected result
 * @property {string} [description] - Optional description
 */

/** @type {TestCase[]} */
const testCases = [
  // ============================================================================
  // Basic Root and Collection Paths
  // ============================================================================
  {
    uri: 'mail://',
    expect: { type: 'root', segments: [] },
    description: 'Root URI'
  },
  {
    uri: 'mail://accounts',
    expect: { type: 'collection', segments: ['accounts'] },
    description: 'Top-level collection'
  },
  {
    uri: 'mail://rules',
    expect: { type: 'collection', segments: ['rules'] },
    description: 'Rules collection'
  },
  {
    uri: 'mail://signatures',
    expect: { type: 'collection', segments: ['signatures'] },
    description: 'Signatures collection'
  },

  // ============================================================================
  // Collection Element Addressing
  // ============================================================================
  {
    uri: 'mail://accounts[0]',
    expect: { type: 'element', segments: ['accounts', { index: 0 }] },
    description: 'Index addressing'
  },
  {
    uri: 'mail://accounts[-1]',
    expect: { type: 'element', segments: ['accounts', { index: -1 }] },
    description: 'Negative index addressing'
  },
  {
    uri: 'mail://accounts/Work',
    expect: { type: 'element', segments: ['accounts', { name: 'Work' }] },
    description: 'Name addressing'
  },
  {
    uri: 'mail://accounts/Work%20Email',
    expect: { type: 'element', segments: ['accounts', { name: 'Work Email' }] },
    description: 'URL-encoded name addressing'
  },

  // ============================================================================
  // Property Access
  // ============================================================================
  {
    uri: 'mail://accounts[0]/name',
    expect: { type: 'property', segments: ['accounts', { index: 0 }, 'name'] },
    description: 'Property on element'
  },
  {
    uri: 'mail://accounts[0]/id',
    expect: { type: 'property', segments: ['accounts', { index: 0 }, 'id'] },
    description: 'ID property'
  },
  {
    uri: 'mail://accounts[0]/fullName',
    expect: { type: 'property', segments: ['accounts', { index: 0 }, 'fullName'] },
    description: 'fullName property'
  },
  {
    uri: 'mail://accounts[0]/emailAddresses',
    expect: { type: 'property', segments: ['accounts', { index: 0 }, 'emailAddresses'] },
    description: 'Array property'
  },

  // ============================================================================
  // Nested Collections
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes',
    expect: { type: 'collection', segments: ['accounts', { index: 0 }, 'mailboxes'] },
    description: 'Nested collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX',
    expect: { type: 'element', segments: ['accounts', { index: 0 }, 'mailboxes', { name: 'INBOX' }] },
    description: 'Element in nested collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages',
    expect: { type: 'collection', segments: ['accounts', { index: 0 }, 'mailboxes', { name: 'INBOX' }, 'messages'] },
    description: 'Messages collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]',
    expect: { type: 'element' },
    description: 'Message element'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/subject',
    expect: { type: 'property' },
    description: 'Message property'
  },

  // ============================================================================
  // Virtual Mailboxes (Account Standard Mailboxes)
  // These should work via schema declaration, not hooks
  // ============================================================================
  {
    uri: 'mail://accounts[0]/inbox',
    expect: { type: 'virtual', segments: ['accounts', { index: 0 }, 'inbox'] },
    description: 'Account inbox (virtual mailbox)'
  },
  {
    uri: 'mail://accounts[0]/sent',
    expect: { type: 'virtual', segments: ['accounts', { index: 0 }, 'sent'] },
    description: 'Account sent (virtual mailbox)'
  },
  {
    uri: 'mail://accounts[0]/drafts',
    expect: { type: 'virtual', segments: ['accounts', { index: 0 }, 'drafts'] },
    description: 'Account drafts (virtual mailbox)'
  },
  {
    uri: 'mail://accounts[0]/junk',
    expect: { type: 'virtual', segments: ['accounts', { index: 0 }, 'junk'] },
    description: 'Account junk (virtual mailbox)'
  },
  {
    uri: 'mail://accounts[0]/trash',
    expect: { type: 'virtual', segments: ['accounts', { index: 0 }, 'trash'] },
    description: 'Account trash (virtual mailbox)'
  },
  {
    uri: 'mail://accounts[0]/inbox/messages',
    expect: { type: 'collection' },
    description: 'Messages in account inbox'
  },
  {
    uri: 'mail://accounts[0]/inbox/messages[0]/subject',
    expect: { type: 'property' },
    description: 'Subject of message in account inbox'
  },

  // ============================================================================
  // App-Level Standard Mailboxes (Aggregates)
  // ============================================================================
  {
    uri: 'mail://inbox',
    expect: { type: 'virtual', segments: ['inbox'] },
    description: 'App-level inbox (aggregate)'
  },
  {
    uri: 'mail://sent',
    expect: { type: 'virtual', segments: ['sent'] },
    description: 'App-level sent (aggregate)'
  },
  {
    uri: 'mail://drafts',
    expect: { type: 'virtual', segments: ['drafts'] },
    description: 'App-level drafts (aggregate)'
  },
  {
    uri: 'mail://junk',
    expect: { type: 'virtual', segments: ['junk'] },
    description: 'App-level junk (aggregate)'
  },
  {
    uri: 'mail://outbox',
    expect: { type: 'virtual', segments: ['outbox'] },
    description: 'App-level outbox (aggregate)'
  },
  {
    uri: 'mail://trash',
    expect: { type: 'virtual', segments: ['trash'] },
    description: 'App-level trash (aggregate)'
  },
  {
    uri: 'mail://inbox/messages',
    expect: { type: 'collection' },
    description: 'Messages in app-level inbox'
  },

  // ============================================================================
  // Recursive Nested Mailboxes
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes/Work/mailboxes',
    expect: { type: 'collection', depth: 4 },
    description: 'Nested mailboxes collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects',
    expect: { type: 'element', depth: 5 },
    description: 'Element in nested mailboxes'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects/messages',
    expect: { type: 'collection', depth: 6 },
    description: 'Messages in deeply nested mailbox'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/Work/mailboxes/Projects/mailboxes/Active',
    expect: { type: 'element', depth: 7 },
    description: 'Third-level nested mailbox'
  },

  // ============================================================================
  // Settings
  // ============================================================================
  {
    uri: 'mail://settings',
    expect: { type: 'virtual', segments: ['settings'] },
    description: 'Settings path'
  },
  {
    uri: 'mail://settings/fetchInterval',
    expect: { type: 'property' },
    description: 'Settings property'
  },

  // ============================================================================
  // Message Sub-Collections
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/toRecipients',
    expect: { type: 'collection' },
    description: 'Message recipients collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/attachments',
    expect: { type: 'collection' },
    description: 'Message attachments collection'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/toRecipients[0]/address',
    expect: { type: 'property' },
    description: 'Recipient address property'
  },

  // ============================================================================
  // Computed Properties
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/sender',
    expect: { type: 'computed' },
    description: 'Computed sender property'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/replyTo',
    expect: { type: 'computed' },
    description: 'Computed replyTo property'
  },
  {
    uri: 'mail://rules[0]/copyMessage',
    expect: { type: 'computed' },
    description: 'Computed copyMessage property'
  },

  // ============================================================================
  // Query String - Valid Cases
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes?name.contains=Inbox',
    expect: { valid: true, query: { filter: { name: { contains: 'Inbox' } } } },
    description: 'String contains filter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes?name=INBOX',
    expect: { valid: true, query: { filter: { name: { equals: 'INBOX' } } } },
    description: 'String equals filter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes?unreadCount.gt=0',
    expect: { valid: true, query: { filter: { unreadCount: { greaterThan: 0 } } } },
    description: 'Number greater-than filter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes?unreadCount.lt=100',
    expect: { valid: true, query: { filter: { unreadCount: { lessThan: 100 } } } },
    description: 'Number less-than filter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages?readStatus=false',
    expect: { valid: true },
    description: 'Boolean filter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages?sort=dateReceived.desc',
    expect: { valid: true, query: { sort: { by: 'dateReceived', direction: 'desc' } } },
    description: 'Sort parameter'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages?limit=10&offset=20',
    expect: { valid: true, query: { pagination: { limit: 10, offset: 20 } } },
    description: 'Pagination parameters'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages?expand=content',
    expect: { valid: true, query: { expand: ['content'] } },
    description: 'Expand lazy property'
  },

  // ============================================================================
  // Query String - Invalid Cases (Type Validation)
  // ============================================================================
  {
    uri: 'mail://accounts[0]/mailboxes?unreadCount.contains=5',
    expect: { valid: false, reason: 'contains operator not valid for number field' },
    description: 'Invalid: contains on number field'
  },
  {
    uri: 'mail://accounts[0]/mailboxes?unreadCount.startsWith=1',
    expect: { valid: false, reason: 'startsWith operator not valid for number field' },
    description: 'Invalid: startsWith on number field'
  },
  {
    uri: 'mail://accounts[0]/mailboxes?name.gt=foo',
    expect: { valid: false, reason: 'gt operator not valid for string field' },
    description: 'Invalid: gt on string field'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages?readStatus.contains=true',
    expect: { valid: false, reason: 'contains operator not valid for boolean field' },
    description: 'Invalid: contains on boolean field'
  },

  // ============================================================================
  // Error Cases - Unknown Segments
  // ============================================================================
  {
    uri: 'mail://accounts[0]/bogus',
    expect: {
      error: true,
      available: ['id', 'name', 'fullName', 'emailAddresses', 'mailboxes', 'inbox', 'sent', 'drafts', 'junk', 'trash']
    },
    description: 'Unknown segment on account'
  },
  {
    uri: 'mail://bogus',
    expect: {
      error: true,
      available: ['accounts', 'rules', 'signatures', 'inbox', 'sent', 'drafts', 'junk', 'outbox', 'trash', 'settings']
    },
    description: 'Unknown top-level segment'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/bogus',
    expect: {
      error: true,
      available: ['name', 'unreadCount', 'messages', 'mailboxes']
    },
    description: 'Unknown segment on mailbox'
  },
  {
    uri: 'mail://accounts[0]/mailboxes/INBOX/messages[0]/bogus',
    expect: {
      error: true,
      available: ['id', 'messageId', 'subject', 'sender', 'replyTo', 'dateSent', 'dateReceived',
                  'content', 'readStatus', 'flaggedStatus', 'junkMailStatus', 'messageSize',
                  'toRecipients', 'ccRecipients', 'bccRecipients', 'attachments']
    },
    description: 'Unknown segment on message'
  },

  // ============================================================================
  // Error Cases - Invalid Addressing
  // ============================================================================
  {
    uri: 'mail://accounts/123',
    expect: { type: 'element', segments: ['accounts', { name: '123' }] },
    description: 'Numeric name interpreted as name (accounts support by-name)'
  },
  {
    uri: 'mail://accounts[foo]',
    expect: { error: true },
    description: 'Invalid index syntax'
  },

  // ============================================================================
  // Scheme Handling
  // ============================================================================
  {
    uri: 'unknown://foo',
    expect: { error: true },
    description: 'Unknown scheme'
  },
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
      const result = parseURI(testCase.uri);

      // Check if error was expected
      if (testCase.expect.error) {
        if (result.ok) {
          failures.push({
            uri: testCase.uri,
            description: testCase.description,
            message: 'Expected error but got success',
            result
          });
          failed++;
          continue;
        }
        // Check available options if specified
        if (testCase.expect.available && result.availableOptions) {
          const missing = testCase.expect.available.filter(
            opt => !result.availableOptions.includes(opt)
          );
          if (missing.length > 0) {
            failures.push({
              uri: testCase.uri,
              description: testCase.description,
              message: `Missing expected options: ${missing.join(', ')}`,
              expected: testCase.expect.available,
              actual: result.availableOptions
            });
            failed++;
            continue;
          }
        }
        passed++;
        continue;
      }

      // Expected success
      if (!result.ok) {
        failures.push({
          uri: testCase.uri,
          description: testCase.description,
          message: `Unexpected error: ${result.error}`,
          availableOptions: result.availableOptions
        });
        failed++;
        continue;
      }

      // Check type if specified
      if (testCase.expect.type && result.type !== testCase.expect.type) {
        failures.push({
          uri: testCase.uri,
          description: testCase.description,
          message: `Wrong type: expected ${testCase.expect.type}, got ${result.type}`
        });
        failed++;
        continue;
      }

      // Check query validation if specified
      if (testCase.expect.valid !== undefined) {
        if (result.queryValid !== testCase.expect.valid) {
          failures.push({
            uri: testCase.uri,
            description: testCase.description,
            message: `Query validation: expected valid=${testCase.expect.valid}, got ${result.queryValid}`,
            queryError: result.queryError
          });
          failed++;
          continue;
        }
        if (!testCase.expect.valid && testCase.expect.reason) {
          if (!result.queryError || !result.queryError.includes(testCase.expect.reason)) {
            failures.push({
              uri: testCase.uri,
              description: testCase.description,
              message: `Query error reason mismatch`,
              expected: testCase.expect.reason,
              actual: result.queryError
            });
            failed++;
            continue;
          }
        }
      }

      // Check depth if specified
      if (testCase.expect.depth && result.depth !== testCase.expect.depth) {
        failures.push({
          uri: testCase.uri,
          description: testCase.description,
          message: `Wrong depth: expected ${testCase.expect.depth}, got ${result.depth}`
        });
        failed++;
        continue;
      }

      passed++;
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
  console.log(`Route Parsing Tests: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  if (failures.length > 0) {
    console.log('FAILURES:\n');
    for (const f of failures) {
      console.log(`  ${f.uri}`);
      console.log(`    ${f.description || ''}`);
      console.log(`    ${f.message}`);
      if (f.expected) console.log(`    Expected: ${JSON.stringify(f.expected)}`);
      if (f.actual) console.log(`    Actual: ${JSON.stringify(f.actual)}`);
      console.log();
    }
  }

  return failed === 0;
}

// ============================================================================
// Stub parseURI - will be replaced with actual implementation
// ============================================================================

/**
 * Parse URI against route table without JXA calls
 * @param {string} uri
 * @returns {{ok: boolean, type?: string, segments?: any[], depth?: number, queryValid?: boolean, queryError?: string, error?: string, availableOptions?: string[]}}
 */
function parseURI(uri) {
  // This is a stub - the actual implementation will come from routes.ts
  // For now, delegate to the compiled route table
  if (typeof globalThis.parseURIWithRoutes === 'function') {
    return globalThis.parseURIWithRoutes(uri);
  }

  // Fallback stub for initial testing
  return { ok: false, error: 'parseURIWithRoutes not implemented' };
}

// ============================================================================
// Entry Point
// ============================================================================

function run() {
  // Load the compiled routes module if available
  try {
    // Routes will be compiled and exported to globalThis
    // @ts-ignore
    if (typeof globalThis.compileRoutes === 'function') {
      const routes = globalThis.compileRoutes();
      globalThis.parseURIWithRoutes = (uri) => parseURIWithTable(uri, routes);
    }
  } catch (e) {
    console.log('Note: Routes not compiled yet. Run after implementing routes.ts');
  }

  const success = runTests();
  return success ? 'All tests passed!' : 'Some tests failed';
}

run();
