/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="../core/uri-router.ts" />
/// <reference path="collections.ts" />
/// <reference path="mailbox.ts" />

// ============================================================================
// Account Specifier
// Lazy navigation with explicit resolution
// ============================================================================

interface AccountSpecifierType {
  readonly _jxa: JXAAccount;
  readonly name: string;
  readonly emailAddresses: string[];
  readonly enabled: boolean;
  readonly fullName: string;

  // URI building (no Apple Events)
  uri(): string;

  // Resolution
  info(): AccountInfo;

  // Mailbox access
  getAllMailboxes(): MailboxSpecifierType[];
  getTopLevelMailboxes(): MailboxSpecifierType[];
  findMailbox(path: string): MailboxSpecifierType | null;
}

function AccountSpecifier(jxa: JXAAccount): AccountSpecifierType {
  // Cache the name since it's used frequently
  let _name: string | null = null;

  const self: AccountSpecifierType = {
    _jxa: jxa,

    get name(): string {
      if (_name === null) {
        _name = str(getOr(() => jxa.name(), ''));
      }
      return _name;
    },

    get emailAddresses(): string[] {
      return getOr(() => jxa.emailAddresses(), []);
    },

    get enabled(): boolean {
      return getOr(() => jxa.enabled(), false);
    },

    get fullName(): string {
      return str(getOr(() => jxa.fullName(), ''));
    },

    uri(): string {
      return URIBuilder.account(self.name);
    },

    info(): AccountInfo {
      return {
        name: self.name,
        uri: self.uri(),
        mailboxesUri: URIBuilder.accountMailboxes(self.name),
        emailAddresses: self.emailAddresses,
        enabled: self.enabled
      };
    },

    getAllMailboxes(): MailboxSpecifierType[] {
      try {
        return jxa.mailboxes().map((m: JXAMailbox) => {
          // Extract path from JXA specifier display string
          const displayStr = Automation.getDisplayString(m);
          const match = displayStr.match(/mailboxes\.byName\("([^"]+)"\)/);
          const mailboxPath = match ? match[1] : str(getOr(() => m.name(), ''));
          const pathParts = mailboxPath.split('/');
          return MailboxSpecifier(m, self.name, pathParts);
        });
      } catch {
        return [];
      }
    },

    getTopLevelMailboxes(): MailboxSpecifierType[] {
      const all = self.getAllMailboxes();
      // Top-level mailboxes have single-element paths
      return all.filter(mb => mb.path.length === 1);
    },

    findMailbox(path: string): MailboxSpecifierType | null {
      try {
        const mb = jxa.mailboxes.byName(path);
        // Verify it exists
        mb.name();
        const pathParts = path.split('/');
        return MailboxSpecifier(mb, self.name, pathParts);
      } catch {
        return null;
      }
    }
  };

  return self;
}
