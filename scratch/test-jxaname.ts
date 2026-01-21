// Test jxaName mapping and computed properties with mock data
//
// Build: npx tsc scratch/framework.ts scratch/mock-backing.ts scratch/mail.ts scratch/test-jxaname.ts --outFile scratch/test-jxaname.js --module None --target ES2020 --lib ES2020 --strict
// Run: node scratch/test-jxaname.js

declare var console: { log(...args: any[]): void };

// Mock data uses JXA property names (mailAttachments, not attachments)
// and raw email strings for sender/replyTo (will be parsed by computed())
const mockMailData = {
  name: 'Mail',
  version: '16.0',
  // App-level settings (accessed via namespace)
  downloadHtmlAttachments: true,
  newMailSound: 'Glass',
  fetchInterval: 5,
  alwaysBccMyself: false,
  alwaysCcMyself: false,
  highlightSelectedConversation: true,
  // App-level standard mailboxes (JXA property names)
  inbox: { name: 'Inbox', unreadCount: 5, messages: [], mailboxes: [] },
  draftsMailbox: { name: 'Drafts', unreadCount: 0, messages: [], mailboxes: [] },
  junkMailbox: { name: 'Junk', unreadCount: 12, messages: [], mailboxes: [] },
  outbox: { name: 'Outbox', unreadCount: 0, messages: [], mailboxes: [] },
  sentMailbox: { name: 'Sent', unreadCount: 0, messages: [], mailboxes: [] },
  trashMailbox: { name: 'Trash', unreadCount: 0, messages: [], mailboxes: [] },
  accounts: [
    {
      id: 'acc-1',
      name: 'Test Account',
      fullName: 'Test User',
      mailboxes: [
        {
          name: 'INBOX',
          unreadCount: 2,
          messages: [
            {
              id: 1001,
              messageId: '<msg1@example.com>',
              subject: 'Test Message',
              // Raw email strings - computed() will parse these
              sender: 'John Doe <john@example.com>',
              replyTo: '"Jane Smith" <jane@example.com>',
              dateSent: '2024-01-15',
              dateReceived: '2024-01-15',
              readStatus: false,
              flaggedStatus: false,
              junkMailStatus: false,
              messageSize: 1234,
              content: 'Message body here',
              toRecipients: [{ name: 'Test User', address: 'test@example.com' }],
              ccRecipients: [],
              bccRecipients: [],
              // JXA name is 'mailAttachments', not 'attachments'
              mailAttachments: [
                { id: 'att-1', name: 'document.pdf', fileSize: 50000 },
                { id: 'att-2', name: 'image.png', fileSize: 25000 },
              ],
            },
            {
              id: 1002,
              messageId: '<msg2@example.com>',
              subject: 'Plain email test',
              // Plain email without name
              sender: 'plain@example.com',
              replyTo: '',
              dateSent: '2024-01-16',
              dateReceived: '2024-01-16',
              readStatus: true,
              flaggedStatus: false,
              junkMailStatus: false,
              messageSize: 500,
              content: 'Short message',
              toRecipients: [],
              ccRecipients: [],
              bccRecipients: [],
              mailAttachments: [],
            },
          ],
          mailboxes: [],
        },
        {
          name: 'Sent',
          unreadCount: 0,
          messages: [],
          mailboxes: [],
        },
      ],
    },
  ],
  rules: [],
  signatures: [],
};

function runTest() {
  console.log('=== Framework Extensions Test ===\n');

  // Create delegate with mock data
  const delegate = createMockDelegate(mockMailData, 'mail');
  const mail = getMailApp(delegate);

  // Register the mail scheme for URI resolution
  registerScheme('mail', () => createMockDelegate(mockMailData, 'mail'), MailApplicationProto);

  // Navigate to first message
  const message1 = mail.accounts.byIndex(0).mailboxes.byName('INBOX').messages.byIndex(0);

  console.log('--- jxaName Mapping Test ---');
  console.log('Message subject:', message1.subject.resolve());

  // Access attachments using schema name - should use JXA name internally
  const attachments = message1.attachments;
  console.log('Attachments specifier URI:', attachments.specifier().uri);

  const attachmentList = attachments.resolve();
  console.log('Attachment count:', attachmentList.length);
  console.log('First attachment name:', attachmentList[0].name);

  // Access by index
  const att0 = attachments.byIndex(0);
  console.log('Attachment[0] via byIndex:', att0.name.resolve());

  // Access by id
  const attById = attachments.byId('att-2');
  console.log('Attachment by id "att-2":', attById.name.resolve());

  console.log('\n--- Computed Properties Test ---');

  // Test computed sender parsing
  const sender1 = message1.sender.resolve();
  console.log('Message 1 sender (parsed):');
  console.log('  name:', sender1.name);
  console.log('  address:', sender1.address);

  const replyTo1 = message1.replyTo.resolve();
  console.log('Message 1 replyTo (parsed):');
  console.log('  name:', replyTo1.name);
  console.log('  address:', replyTo1.address);

  // Test plain email address (no name)
  const message2 = mail.accounts.byIndex(0).mailboxes.byName('INBOX').messages.byIndex(1);
  const sender2 = message2.sender.resolve();
  console.log('Message 2 sender (plain email):');
  console.log('  name:', JSON.stringify(sender2.name));
  console.log('  address:', sender2.address);

  // Test empty replyTo
  const replyTo2 = message2.replyTo.resolve();
  console.log('Message 2 replyTo (empty):');
  console.log('  name:', JSON.stringify(replyTo2.name));
  console.log('  address:', JSON.stringify(replyTo2.address));

  console.log('\n--- Standard Mailboxes Test (withJxaName) ---');

  // App-level inbox (jxaName matches schema name)
  console.log('mail.inbox.specifier().uri:', mail.inbox.specifier().uri);
  console.log('mail.inbox.name.resolve():', mail.inbox.name.resolve());

  // App-level drafts (jxaName differs from schema name)
  console.log('mail.drafts.specifier().uri:', mail.drafts.specifier().uri);
  console.log('mail.drafts.name.resolve():', mail.drafts.name.resolve());

  // App-level junk
  console.log('mail.junk.specifier().uri:', mail.junk.specifier().uri);
  console.log('mail.junk.unreadCount.resolve():', mail.junk.unreadCount.resolve());

  // App-level sent
  console.log('mail.sent.specifier().uri:', mail.sent.specifier().uri);

  // App-level trash
  console.log('mail.trash.specifier().uri:', mail.trash.specifier().uri);

  console.log('\n--- computedNav Test (Account Inbox) ---');

  // Account-level inbox via computedNav
  const account = mail.accounts.byIndex(0);
  console.log('account.inbox.specifier().uri:', account.inbox.specifier().uri);
  console.log('account.inbox.name.resolve():', account.inbox.name.resolve());
  console.log('account.inbox.unreadCount.resolve():', account.inbox.unreadCount.resolve());

  // Access messages through account inbox
  const accountInboxMessages = account.inbox.messages.resolve();
  console.log('account.inbox.messages count:', accountInboxMessages.length);

  // Access single message through account inbox
  const firstMsg = account.inbox.messages.byIndex(0);
  console.log('account.inbox.messages.byIndex(0).subject:', firstMsg.subject.resolve());

  console.log('\n--- URI Resolution Test (jxaName) ---');

  // Test 1: mail.drafts URI should use schema name, not JXA name
  const draftsUri = mail.drafts.specifier().uri;
  console.log('mail.drafts.specifier().uri:', draftsUri);
  const draftsUriExpected = draftsUri === 'mail://drafts';
  console.log('  Uses schema name (drafts, not draftsMailbox):', draftsUriExpected ? 'PASS' : 'FAIL');

  // Test 2: resolveURI('mail://drafts') should resolve successfully
  const resolvedDrafts = resolveURI('mail://drafts');
  if (resolvedDrafts.ok) {
    console.log('resolveURI("mail://drafts"):');
    console.log('  Resolved:', 'PASS');
    console.log('  name.resolve():', resolvedDrafts.value.name.resolve());
    // Verify it matches direct access
    const directDraftsName = mail.drafts.name.resolve();
    console.log('  Matches mail.drafts:', resolvedDrafts.value.name.resolve() === directDraftsName ? 'PASS' : 'FAIL');
  } else {
    console.log('resolveURI("mail://drafts"): FAIL -', resolvedDrafts.error);
  }

  // Test 3: Round-trip - resolveURI(mail.drafts.specifier().uri) should work
  const roundTripDrafts = resolveURI(mail.drafts.specifier().uri);
  if (roundTripDrafts.ok) {
    console.log('Round-trip resolveURI(mail.drafts.specifier().uri):');
    console.log('  Resolved:', 'PASS');
    console.log('  name.resolve():', roundTripDrafts.value.name.resolve());
  } else {
    console.log('Round-trip resolveURI(mail.drafts.specifier().uri): FAIL -', roundTripDrafts.error);
  }

  // Test 4: junk, sent, trash should also use schema names
  console.log('mail.junk.specifier().uri:', mail.junk.specifier().uri);
  console.log('mail.sent.specifier().uri:', mail.sent.specifier().uri);
  console.log('mail.trash.specifier().uri:', mail.trash.specifier().uri);

  console.log('\n--- URI Resolution Test (computedNav) ---');

  // Test 5: resolveURI('mail://accounts[0]/inbox') should resolve via computedNav
  const resolvedAccountInbox = resolveURI('mail://accounts[0]/inbox');
  if (resolvedAccountInbox.ok) {
    console.log('resolveURI("mail://accounts[0]/inbox"):');
    console.log('  Resolved:', 'PASS');
    console.log('  name.resolve():', resolvedAccountInbox.value.name.resolve());
    console.log('  unreadCount.resolve():', resolvedAccountInbox.value.unreadCount.resolve());
    // Verify it matches direct access via computedNav
    const directInboxName = account.inbox.name.resolve();
    console.log('  Matches account.inbox:', resolvedAccountInbox.value.name.resolve() === directInboxName ? 'PASS' : 'FAIL');
  } else {
    console.log('resolveURI("mail://accounts[0]/inbox"): FAIL -', resolvedAccountInbox.error);
  }

  // Test 6: resolveURI('mail://accounts[0]/mailboxes/INBOX') should resolve via normal path
  const resolvedJxaPath = resolveURI('mail://accounts[0]/mailboxes/INBOX');
  if (resolvedJxaPath.ok) {
    console.log('resolveURI("mail://accounts[0]/mailboxes/INBOX"):');
    console.log('  Resolved:', 'PASS');
    console.log('  name.resolve():', resolvedJxaPath.value.name.resolve());
    console.log('  unreadCount.resolve():', resolvedJxaPath.value.unreadCount.resolve());
  } else {
    console.log('resolveURI("mail://accounts[0]/mailboxes/INBOX"): FAIL -', resolvedJxaPath.error);
  }

  // Test 7: Both paths should yield equivalent data
  if (resolvedAccountInbox.ok && resolvedJxaPath.ok) {
    const inboxName1 = resolvedAccountInbox.value.name.resolve();
    const inboxName2 = resolvedJxaPath.value.name.resolve();
    console.log('Both paths yield same mailbox name:', inboxName1 === inboxName2 ? 'PASS' : 'FAIL');
  }

  // Test 8: Attachments URI should use schema name
  const attachmentsUri = message1.attachments.specifier().uri;
  console.log('\nmessage.attachments.specifier().uri:', attachmentsUri);
  const attachmentsUriExpected = attachmentsUri.includes('/attachments') && !attachmentsUri.includes('/mailAttachments');
  console.log('  Uses schema name (attachments, not mailAttachments):', attachmentsUriExpected ? 'PASS' : 'FAIL');

  // Test 9: resolveURI for attachments
  const resolvedAttachments = resolveURI(attachmentsUri);
  if (resolvedAttachments.ok) {
    console.log('resolveURI(attachmentsUri):');
    console.log('  Resolved:', 'PASS');
    const attachmentList2 = resolvedAttachments.value.resolve();
    console.log('  Attachment count:', attachmentList2.length);
  } else {
    console.log('resolveURI(attachmentsUri): FAIL -', resolvedAttachments.error);
  }

  console.log('\n--- Settings Namespace Test ---');

  // Test 1: mail.settings.fetchInterval should have correct URI
  const fetchIntervalUri = mail.settings.fetchInterval.specifier().uri;
  console.log('mail.settings.fetchInterval.specifier().uri:', fetchIntervalUri);
  const fetchIntervalUriExpected = fetchIntervalUri === 'mail://settings/fetchInterval';
  console.log('  Uses settings namespace in URI:', fetchIntervalUriExpected ? 'PASS' : 'FAIL');

  // Test 2: mail.settings.fetchInterval should resolve to app-level property
  const fetchInterval = mail.settings.fetchInterval.resolve();
  console.log('mail.settings.fetchInterval.resolve():', fetchInterval);
  const fetchIntervalExpected = fetchInterval === 5;
  console.log('  Resolves to correct value:', fetchIntervalExpected ? 'PASS' : 'FAIL');

  // Test 3: Other settings properties
  console.log('mail.settings.downloadHtmlAttachments.resolve():', mail.settings.downloadHtmlAttachments.resolve());
  console.log('mail.settings.newMailSound.resolve():', mail.settings.newMailSound.resolve());
  console.log('mail.settings.fetchInterval.resolve():', mail.settings.fetchInterval.resolve());

  // Test 4: resolveURI('mail://settings/fetchInterval') should work
  const resolvedSettings = resolveURI('mail://settings/fetchInterval');
  if (resolvedSettings.ok) {
    console.log('resolveURI("mail://settings/fetchInterval"):');
    console.log('  Resolved:', 'PASS');
    const resolvedValue = resolvedSettings.value.resolve();
    console.log('  resolve():', resolvedValue);
    console.log('  Matches direct access:', resolvedValue === fetchInterval ? 'PASS' : 'FAIL');
  } else {
    console.log('resolveURI("mail://settings/fetchInterval"): FAIL -', resolvedSettings.error);
  }

  // Test 5: Round-trip
  const roundTripSettings = resolveURI(mail.settings.fetchInterval.specifier().uri);
  if (roundTripSettings.ok) {
    console.log('Round-trip resolveURI(mail.settings.fetchInterval.specifier().uri):');
    console.log('  Resolved:', 'PASS');
    console.log('  resolve():', roundTripSettings.value.resolve());
  } else {
    console.log('Round-trip: FAIL -', roundTripSettings.error);
  }

  // Test 6: Settings namespace URI itself
  const settingsUri = mail.settings.specifier().uri;
  console.log('mail.settings.specifier().uri:', settingsUri);
  const settingsUriExpected = settingsUri === 'mail://settings';
  console.log('  Settings namespace URI:', settingsUriExpected ? 'PASS' : 'FAIL');

  console.log('\n=== All Tests Complete ===');
}

runTest();
