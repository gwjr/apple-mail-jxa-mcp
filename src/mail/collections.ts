/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />

// ============================================================================
// Collections and Specifiers
// Lazy wrappers around JXA element arrays
// ============================================================================

// String coercion - JXA bridged strings have enumerable char keys
function str(val: unknown): string {
  return val == null ? '' : '' + val;
}

// ============================================================================
// AccountCollection
// Wraps JXAElementArray<JXAAccount>
// ============================================================================

interface AccountCollection {
  // Addressing modes (from sdef: name, index, id)
  byName(name: string): AccountSpecifier;
  byIndex(index: number): AccountSpecifier;
  byId(id: number): AccountSpecifier;

  // Resolve all to specifiers
  all(): AccountSpecifier[];
}

function AccountCollection(jxa: JXAElementArray<JXAAccount>): AccountCollection {
  return {
    byName(name: string): AccountSpecifier {
      return AccountSpecifier(jxa.byName(name));
    },

    byIndex(index: number): AccountSpecifier {
      return AccountSpecifier(jxa.at(index));
    },

    byId(id: number): AccountSpecifier {
      return AccountSpecifier(jxa.byId(id));
    },

    all(): AccountSpecifier[] {
      return jxa().map(a => AccountSpecifier(a));
    }
  };
}

// ============================================================================
// AccountSpecifier
// Wraps a single JXAAccount reference
// ============================================================================

interface AccountSpecifier {
  readonly _jxa: JXAAccount;

  // Properties (each triggers an Apple Event)
  name(): string;
  id(): number;

  // Navigation to child collections
  mailboxes(): MailboxCollection;
}

function AccountSpecifier(jxa: JXAAccount): AccountSpecifier {
  return {
    _jxa: jxa,

    name(): string {
      return str(jxa.name());
    },

    id(): number {
      return jxa.id();
    },

    mailboxes(): MailboxCollection {
      return MailboxCollection(jxa.mailboxes);
    }
  };
}

// ============================================================================
// MailboxCollection (stub for now)
// ============================================================================

interface MailboxCollection {
  byName(name: string): MailboxSpecifier;
  byIndex(index: number): MailboxSpecifier;
  all(): MailboxSpecifier[];
}

function MailboxCollection(jxa: JXAElementArray<JXAMailbox>): MailboxCollection {
  return {
    byName(name: string): MailboxSpecifier {
      return MailboxSpecifier(jxa.byName(name));
    },

    byIndex(index: number): MailboxSpecifier {
      return MailboxSpecifier(jxa.at(index));
    },

    all(): MailboxSpecifier[] {
      return jxa().map(m => MailboxSpecifier(m));
    }
  };
}

// ============================================================================
// MailboxSpecifier (stub for now)
// ============================================================================

interface MailboxSpecifier {
  readonly _jxa: JXAMailbox;
  name(): string;
}

function MailboxSpecifier(jxa: JXAMailbox): MailboxSpecifier {
  return {
    _jxa: jxa,

    name(): string {
      return str(jxa.name());
    }
  };
}
