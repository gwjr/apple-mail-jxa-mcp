/// <reference path="./types/jxa.d.ts" />
/// <reference path="./types/mail-app.d.ts" />

// ============================================================================
// Email Address Parsing (JS-based, no extra Apple Events)
// ============================================================================

type ParsedEmailAddress = { name: string; address: string };

function parseEmailAddress(raw: string): ParsedEmailAddress {
  if (!raw) return { name: '', address: '' };

  // Format: "Name" <email@domain.com> or Name <email@domain.com> or just email@domain.com
  const match = raw.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  if (match) {
    const name = (match[1] || '').trim();
    const address = (match[2] || '').trim();
    // If no name but we have something that looks like an email, check if address has a name component
    if (!name && address.includes('@')) {
      return { name: '', address };
    }
    // If the "address" doesn't have @, it might just be a name
    if (!address.includes('@')) {
      return { name: address, address: '' };
    }
    return { name, address };
  }
  // Fallback: treat the whole thing as the address
  return { name: '', address: raw.trim() };
}

// ============================================================================
// Apple Mail Schema Definitions
// ============================================================================

// ============================================================================
// Settings Schema (app-level preferences)
// ============================================================================

const SettingsBase = {
  // App info
  name: accessor<string, 'name'>('name'),
  version: accessor<string, 'version'>('version'),
  frontmost: accessor<boolean, 'frontmost'>('frontmost'),
  // Behavior
  alwaysBccMyself: accessor<boolean, 'alwaysBccMyself'>('alwaysBccMyself'),
  alwaysCcMyself: accessor<boolean, 'alwaysCcMyself'>('alwaysCcMyself'),
  downloadHtmlAttachments: accessor<boolean, 'downloadHtmlAttachments'>('downloadHtmlAttachments'),
  fetchInterval: accessor<number, 'fetchInterval'>('fetchInterval'),
  expandGroupAddresses: accessor<boolean, 'expandGroupAddresses'>('expandGroupAddresses'),
  // Composing
  defaultMessageFormat: accessor<string, 'defaultMessageFormat'>('defaultMessageFormat'),
  chooseSignatureWhenComposing: accessor<boolean, 'chooseSignatureWhenComposing'>('chooseSignatureWhenComposing'),
  quoteOriginalMessage: accessor<boolean, 'quoteOriginalMessage'>('quoteOriginalMessage'),
  sameReplyFormat: accessor<boolean, 'sameReplyFormat'>('sameReplyFormat'),
  includeAllOriginalMessageText: accessor<boolean, 'includeAllOriginalMessageText'>('includeAllOriginalMessageText'),
  // Display
  highlightSelectedConversation: accessor<boolean, 'highlightSelectedConversation'>('highlightSelectedConversation'),
  colorQuotedText: accessor<boolean, 'colorQuotedText'>('colorQuotedText'),
  levelOneQuotingColor: accessor<string, 'levelOneQuotingColor'>('levelOneQuotingColor'),
  levelTwoQuotingColor: accessor<string, 'levelTwoQuotingColor'>('levelTwoQuotingColor'),
  levelThreeQuotingColor: accessor<string, 'levelThreeQuotingColor'>('levelThreeQuotingColor'),
  // Fonts
  messageFont: accessor<string, 'messageFont'>('messageFont'),
  messageFontSize: accessor<number, 'messageFontSize'>('messageFontSize'),
  messageListFont: accessor<string, 'messageListFont'>('messageListFont'),
  messageListFontSize: accessor<number, 'messageListFontSize'>('messageListFontSize'),
  useFixedWidthFont: accessor<boolean, 'useFixedWidthFont'>('useFixedWidthFont'),
  fixedWidthFont: accessor<string, 'fixedWidthFont'>('fixedWidthFont'),
  fixedWidthFontSize: accessor<number, 'fixedWidthFontSize'>('fixedWidthFontSize'),
  // Sounds
  newMailSound: accessor<string, 'newMailSound'>('newMailSound'),
  shouldPlayOtherMailSounds: accessor<boolean, 'shouldPlayOtherMailSounds'>('shouldPlayOtherMailSounds'),
  // Spelling
  checkSpellingWhileTyping: accessor<boolean, 'checkSpellingWhileTyping'>('checkSpellingWhileTyping'),
} as const;

// ============================================================================
// Rule Condition Schema
// ============================================================================

const RuleConditionBase = {
  header: accessor<string, 'header'>('header'),
  qualifier: accessor<string, 'qualifier'>('qualifier'),
  ruleType: accessor<string, 'ruleType'>('ruleType'),
  expression: accessor<string, 'expression'>('expression'),
} as const;

// ============================================================================
// Rule Schema
// ============================================================================

const RuleBase = {
  name: accessor<string, 'name'>('name'),
  enabled: accessor<boolean, 'enabled'>('enabled'),
  allConditionsMustBeMet: accessor<boolean, 'allConditionsMustBeMet'>('allConditionsMustBeMet'),
  // Actions - simple properties
  deleteMessage: accessor<boolean, 'deleteMessage'>('deleteMessage'),
  markRead: accessor<boolean, 'markRead'>('markRead'),
  markFlagged: accessor<boolean, 'markFlagged'>('markFlagged'),
  markFlagIndex: accessor<number, 'markFlagIndex'>('markFlagIndex'),
  stopEvaluatingRules: accessor<boolean, 'stopEvaluatingRules'>('stopEvaluatingRules'),
  // Actions - string properties
  forwardMessage: accessor<string, 'forwardMessage'>('forwardMessage'),
  redirectMessage: accessor<string, 'redirectMessage'>('redirectMessage'),
  replyText: accessor<string, 'replyText'>('replyText'),
  playSound: accessor<string, 'playSound'>('playSound'),
  highlightTextUsingColor: accessor<string, 'highlightTextUsingColor'>('highlightTextUsingColor'),
  // Mailbox actions (computed to get mailbox name, lazy to avoid upfront resolution)
  copyMessage: computed<string | null>((jxa) => {
    try { const mb = jxa.copyMessage(); return mb ? mb.name() : null; } catch { return null; }
  }),
  moveMessage: computed<string | null>((jxa) => {
    try { const mb = jxa.moveMessage(); return mb ? mb.name() : null; } catch { return null; }
  }),
  // Conditions collection
  ruleConditions: collection('ruleConditions', RuleConditionBase, ['index'] as const),
} as const;

// ============================================================================
// Signature Schema
// ============================================================================

const SignatureBase = {
  name: accessor<string, 'name'>('name'),
  content: lazyAccessor<string, 'content'>('content'),  // lazy - can be large
} as const;

// ============================================================================
// Recipient Schema
// ============================================================================

const RecipientBase = {
  name: accessor<string, 'name'>('name'),
  address: accessor<string, 'address'>('address'),
} as const;

const AttachmentBase = {
  id: accessor<string, 'id'>('id'),
  name: accessor<string, 'name'>('name'),
  fileSize: accessor<number, 'fileSize'>('fileSize'),
} as const;

const MessageBase = {
  id: accessor<number, 'id'>('id'),
  messageId: accessor<string, 'messageId'>('messageId'),
  subject: accessor<string, 'subject'>('subject'),
  sender: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.sender()))),
  replyTo: computed<ParsedEmailAddress>((jxa) => parseEmailAddress(str(jxa.replyTo()))),
  dateSent: accessor<Date, 'dateSent'>('dateSent'),
  dateReceived: accessor<Date, 'dateReceived'>('dateReceived'),
  content: lazyAccessor<string, 'content'>('content'),  // lazy - expensive to fetch
  readStatus: accessor<boolean, 'readStatus'>('readStatus'),
  flaggedStatus: accessor<boolean, 'flaggedStatus'>('flaggedStatus'),
  junkMailStatus: accessor<boolean, 'junkMailStatus'>('junkMailStatus'),
  messageSize: accessor<number, 'messageSize'>('messageSize'),
  toRecipients: collection('toRecipients', RecipientBase, ['name', 'index'] as const),
  ccRecipients: collection('ccRecipients', RecipientBase, ['name', 'index'] as const),
  bccRecipients: collection('bccRecipients', RecipientBase, ['name', 'index'] as const),
  attachments: collection('mailAttachments', AttachmentBase, ['name', 'index', 'id'] as const),
} as const;

const MailboxBase: any = {
  name: accessor<string, 'name'>('name'),
  unreadCount: accessor<number, 'unreadCount'>('unreadCount'),
  messages: collection('messages', MessageBase, ['index', 'id'] as const)
};
// Self-referential: mailboxes contain mailboxes
MailboxBase.mailboxes = collection('mailboxes', MailboxBase, ['name', 'index'] as const);

const AccountBase = {
  id: accessor<string, 'id'>('id'),
  name: accessor<string, 'name'>('name'),
  fullName: accessor<string, 'fullName'>('fullName'),
  emailAddresses: accessor<string[], 'emailAddresses'>('emailAddresses'),
  mailboxes: collection('mailboxes', MailboxBase, ['name', 'index'] as const)
} as const;

// Standard mailbox schemas (same structure as Mailbox but different accessors)
const StandardMailboxBase = {
  name: accessor<string, 'name'>('name'),
  unreadCount: accessor<number, 'unreadCount'>('unreadCount'),
  messages: collection('messages', MessageBase, ['index', 'id'] as const)
} as const;

const MailAppBase = {
  accounts: collection('accounts', AccountBase, ['name', 'index', 'id'] as const),
  rules: collection('rules', RuleBase, ['name', 'index'] as const),
  signatures: collection('signatures', SignatureBase, ['name', 'index'] as const),
  // Standard mailboxes (aggregate across all accounts)
  inbox: { _standardMailbox: true, _jxaName: 'inbox' },
  drafts: { _standardMailbox: true, _jxaName: 'draftsMailbox' },
  junk: { _standardMailbox: true, _jxaName: 'junkMailbox' },
  outbox: { _standardMailbox: true, _jxaName: 'outbox' },
  sent: { _standardMailbox: true, _jxaName: 'sentMailbox' },
  trash: { _standardMailbox: true, _jxaName: 'trashMailbox' }
} as const;

// ============================================================================
// Create Derived Types
// ============================================================================

const Settings = createDerived(SettingsBase, 'Settings');
const RuleCondition = createDerived(RuleConditionBase, 'RuleCondition');
const Rule = createDerived(RuleBase, 'Rule');
const Signature = createDerived(SignatureBase, 'Signature');
const Recipient = createDerived(RecipientBase, 'Recipient');
const Attachment = createDerived(AttachmentBase, 'Attachment');
const Message = createDerived(MessageBase, 'Message');
const Mailbox = createDerived(MailboxBase, 'Mailbox');
const Account = createDerived(AccountBase, 'Account');

// ============================================================================
// Type Aliases for Export
// ============================================================================

type Settings = InstanceType<typeof Settings>;
type RuleCondition = InstanceType<typeof RuleCondition>;
type Rule = InstanceType<typeof Rule>;
type Signature = InstanceType<typeof Signature>;
type Recipient = InstanceType<typeof Recipient>;
type Attachment = InstanceType<typeof Attachment>;
type Message = InstanceType<typeof Message>;
type Mailbox = InstanceType<typeof Mailbox>;
type Account = InstanceType<typeof Account>;

// ============================================================================
// Entry Point
// ============================================================================

const MailApp = createDerived(MailAppBase, 'Mail');
type MailApp = InstanceType<typeof MailApp>;

// Create derived type for standard mailboxes
const StandardMailbox = createDerived(StandardMailboxBase, 'StandardMailbox');

// Helper to create standard mailbox specifier
function createStandardMailboxSpecifier(
  uri: string,
  jxaMailbox: any
): any {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve(): Result<any> {
      return tryResolve(() => StandardMailbox.fromJXA(jxaMailbox, uri), uri);
    }
  };

  // Add properties from StandardMailboxBase
  for (const [key, descriptor] of Object.entries(StandardMailboxBase)) {
    if ('_accessor' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxaMailbox[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    } else if ('_collection' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const desc = descriptor as any;
          return createCollectionSpecifier(
            `${uri}/${key}`,
            jxaMailbox[desc._jxaName],
            desc._elementBase,
            desc._addressing,
            'StandardMailbox_' + key
          );
        },
        enumerable: true
      });
    }
  }

  return spec;
}

// Helper to create settings specifier (singleton, not a collection)
function createSettingsSpecifier(uri: string, jxaApp: any): any {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve(): Result<any> {
      return tryResolve(() => Settings.fromJXA(jxaApp, uri), uri);
    },
    fix(): Result<any> {
      return { ok: true, value: spec };  // Settings is a singleton, already stable
    }
  };

  // Add properties from SettingsBase as navigable specifiers
  for (const [key, descriptor] of Object.entries(SettingsBase)) {
    if ('_accessor' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxaApp[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    }
  }

  return spec;
}

// Lazily initialized app specifier
let _mailApp: any = null;
function getMailApp() {
  if (!_mailApp) {
    const jxa = Application('Mail');
    const app = MailApp.fromJXA(jxa, 'mail://');
    // Add specifier-like properties
    (app as any).uri = 'mail://';
    (app as any)._isSpecifier = true;
    (app as any).resolve = () => ({ ok: true, value: app });

    // Add standard mailbox specifiers
    const standardMailboxes = [
      { name: 'inbox', jxaName: 'inbox' },
      { name: 'drafts', jxaName: 'draftsMailbox' },
      { name: 'junk', jxaName: 'junkMailbox' },
      { name: 'outbox', jxaName: 'outbox' },
      { name: 'sent', jxaName: 'sentMailbox' },
      { name: 'trash', jxaName: 'trashMailbox' }
    ];

    for (const { name, jxaName } of standardMailboxes) {
      Object.defineProperty(app, name, {
        get() {
          return createStandardMailboxSpecifier(`mail://${name}`, jxa[jxaName]);
        },
        enumerable: true
      });
    }

    // Add settings specifier (app-level preferences)
    Object.defineProperty(app, 'settings', {
      get() {
        return createSettingsSpecifier('mail://settings', jxa);
      },
      enumerable: true
    });

    _mailApp = app;
  }
  return _mailApp;
}

// Register mail:// scheme
registerScheme('mail', getMailApp);

// Standard mailbox aliases for accounts
// Handles mail://accounts[X]/inbox, /sent, /drafts, /junk, /trash
const accountStandardMailboxes: Record<string, string> = {
  inbox: 'inbox',
  sent: 'sentMailbox',
  drafts: 'draftsMailbox',
  junk: 'junkMailbox',
  trash: 'trashMailbox'
};

// Completion hook for account standard mailboxes
registerCompletionHook((specifier: any, partial: string) => {
  // Only applies to account specifiers (check if URI matches accounts[X])
  if (!specifier || !specifier.uri || !specifier.uri.match(/^mail:\/\/accounts\[\d+\]$/)) {
    return [];
  }

  return Object.keys(accountStandardMailboxes)
    .filter(name => name.startsWith(partial.toLowerCase()))
    .map(name => ({
      value: `${name}/`,
      label: name,
      description: 'Standard mailbox'
    }));
});

registerNavigationHook((parent: any, name: string, uri: string) => {
  // Check if this is an account specifier navigating to a standard mailbox
  const jxaAppName = accountStandardMailboxes[name];
  if (!jxaAppName) return undefined;

  // Check if parent has an id (accounts have id)
  if (!parent || !parent._isSpecifier) return undefined;

  // Try to get the account's JXA object and find its standard mailbox
  try {
    const parentResult = parent.resolve();
    if (!parentResult.ok) return undefined;

    const accountId = parentResult.value.id;
    if (!accountId) return undefined;

    // Get the app-level standard mailbox and find the one for this account
    const jxa = Application('Mail');
    const appMailbox = jxa[jxaAppName]();
    const accountMailbox = appMailbox.mailboxes().find((m: any) => {
      try {
        return m.account().id() === accountId;
      } catch {
        return false;
      }
    });

    if (!accountMailbox) return undefined;

    // Create a mailbox specifier for it
    return createMailboxSpecifier(uri, accountMailbox);
  } catch {
    return undefined;
  }
});

// Helper to create a mailbox specifier for a JXA mailbox
function createMailboxSpecifier(uri: string, jxaMailbox: any): any {
  const spec: any = {
    _isSpecifier: true,
    uri,
    resolve(): Result<any> {
      return tryResolve(() => Mailbox.fromJXA(jxaMailbox, uri), uri);
    }
  };

  // Add properties from MailboxBase
  for (const [key, descriptor] of Object.entries(MailboxBase)) {
    if ('_accessor' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const jxaName = (descriptor as any)._jxaName;
          return scalarSpecifier(`${uri}/${key}`, () => {
            const value = jxaMailbox[jxaName]();
            return value == null ? '' : value;
          });
        },
        enumerable: true
      });
    } else if ('_collection' in (descriptor as any)) {
      Object.defineProperty(spec, key, {
        get() {
          const desc = descriptor as any;
          return createCollectionSpecifier(
            `${uri}/${key}`,
            jxaMailbox[desc._jxaName],
            desc._elementBase,
            desc._addressing,
            'Mailbox_' + key
          );
        },
        enumerable: true
      });
    }
  }

  return spec;
}

// Export for JXA
(globalThis as any).specifierFromURI = specifierFromURI;
(globalThis as any).getCompletions = getCompletions;
