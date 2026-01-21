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

  console.log('\n=== All Tests Complete ===');
}

runTest();
