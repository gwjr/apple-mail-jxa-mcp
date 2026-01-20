/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />

// ============================================================================
// Proof of Concept: Specifier Type System
// ============================================================================

// Helper
function str(val: unknown): string {
  return val == null ? '' : '' + val;
}

// ============================================================================
// Helpers
// ============================================================================

function tryResolve<T>(fn: () => T, context: string): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: `${context}: ${e}` };
  }
}

// ============================================================================
// Core Type System
// ============================================================================

// Marker for specifier types (used for flattening detection)
declare const specifierBrand: unique symbol;

// Lift: scalar → Specifier<scalar>, Specifier<X> → Specifier<X>
type Lift<T> = T extends { [specifierBrand]: any }
  ? T  // Already a specifier, return as-is
  : Specifier<T>;  // Wrap in specifier

// Specifier: wraps T, exposes lifted properties, has resolve()
type Specifier<T> = {
  readonly [specifierBrand]: true;
  readonly uri: string;
  resolve(): Result<T>;
} & {
  readonly [K in keyof T]: Lift<T[K]>;
};

// CollectionSpecifier: a specifier for a collection
// Has addressing methods + resolve() → T[]
type CollectionSpecifier<T> = {
  readonly [specifierBrand]: true;
  readonly uri: string;
  resolve(): Result<T[]>;
  byIndex(i: number): Specifier<T>;
} & CollectionAddressing<T>;

// Addressing modes vary by type - this is the union of possibilities
type CollectionAddressing<T> = {
  byName?(name: string): Specifier<T>;
  byId?(id: string | number): Specifier<T>;
};

// ============================================================================
// Domain Types
// ============================================================================

// Mailbox - simplified, just has a name
type Mailbox = {
  name: string;
};

// Account - has scalars and navigation to mailboxes
type Account = {
  id: string;
  name: string;
  fullName: string;
  emailAddresses: string[];
  mailboxes: CollectionSpecifier<Mailbox>;  // Navigation is a specifier
};

// ============================================================================
// JXA Constructors
// ============================================================================

const MailboxFromJXA = {
  fromJXA(jxa: JXAMailbox): Mailbox {
    return {
      name: str(jxa.name())
    };
  }
};

const AccountFromJXA = {
  fromJXA(jxa: JXAAccount, mailboxesSpec: CollectionSpecifier<Mailbox>): Account {
    return {
      id: str(jxa.id()),
      name: str(jxa.name()),
      fullName: str(jxa.fullName()),
      emailAddresses: jxa.emailAddresses().map(str),
      mailboxes: mailboxesSpec  // Pass through the specifier
    };
  }
};

// ============================================================================
// Specifier Factories
// ============================================================================

function mailboxSpecifier(uri: string, jxa: JXAMailbox): Specifier<Mailbox> {
  return {
    [specifierBrand]: true as const,
    uri,

    resolve(): Result<Mailbox> {
      return tryResolve(() => MailboxFromJXA.fromJXA(jxa), uri);
    },

    // Lifted property: name → Specifier<string>
    get name(): Specifier<string> {
      return scalarSpecifier(`${uri}/name`, () => str(jxa.name()));
    }
  } as Specifier<Mailbox>;
}

function mailboxCollectionSpecifier(
  uri: string,
  jxa: JXAElementArray<JXAMailbox>
): CollectionSpecifier<Mailbox> {
  return {
    [specifierBrand]: true as const,
    uri,

    resolve(): Result<Mailbox[]> {
      return tryResolve(
        () => jxa().map(j => MailboxFromJXA.fromJXA(j)),
        uri
      );
    },

    byIndex(i: number): Specifier<Mailbox> {
      return mailboxSpecifier(`${uri}[${i}]`, jxa.at(i));
    },

    byName(name: string): Specifier<Mailbox> {
      return mailboxSpecifier(
        `${uri}/${encodeURIComponent(name)}`,
        jxa.byName(name)
      );
    }
  };
}

function accountSpecifier(uri: string, jxa: JXAAccount): Specifier<Account> {
  const mailboxesUri = `${uri}/mailboxes`;
  const mailboxesSpec = mailboxCollectionSpecifier(mailboxesUri, jxa.mailboxes);

  return {
    [specifierBrand]: true as const,
    uri,

    resolve(): Result<Account> {
      return tryResolve(
        () => AccountFromJXA.fromJXA(jxa, mailboxesSpec),
        uri
      );
    },

    // Lifted scalar properties
    get id(): Specifier<string> {
      return scalarSpecifier(`${uri}/id`, () => str(jxa.id()));
    },

    get name(): Specifier<string> {
      return scalarSpecifier(`${uri}/name`, () => str(jxa.name()));
    },

    get fullName(): Specifier<string> {
      return scalarSpecifier(`${uri}/fullName`, () => str(jxa.fullName()));
    },

    get emailAddresses(): Specifier<string[]> {
      return scalarSpecifier(`${uri}/emailAddresses`, () => jxa.emailAddresses().map(str));
    },

    // Navigation property - already a specifier
    get mailboxes(): CollectionSpecifier<Mailbox> {
      return mailboxesSpec;
    }
  } as Specifier<Account>;
}

function accountCollectionSpecifier(
  uri: string,
  jxa: JXAElementArray<JXAAccount>
): CollectionSpecifier<Account> {
  return {
    [specifierBrand]: true as const,
    uri,

    resolve(): Result<Account[]> {
      return tryResolve(
        () => jxa().map(j => {
          const mailboxesSpec = mailboxCollectionSpecifier(
            `mail://accounts/${encodeURIComponent(str(j.name()))}/mailboxes`,
            j.mailboxes
          );
          return AccountFromJXA.fromJXA(j, mailboxesSpec);
        }),
        uri
      );
    },

    byIndex(i: number): Specifier<Account> {
      return accountSpecifier(`${uri}[${i}]`, jxa.at(i));
    },

    byName(name: string): Specifier<Account> {
      return accountSpecifier(`${uri}/${encodeURIComponent(name)}`, jxa.byName(name));
    },

    byId(id: string | number): Specifier<Account> {
      return accountSpecifier(`${uri}/${id}`, jxa.byId(id as number));
    }
  };
}

// Helper for scalar specifiers
function scalarSpecifier<T>(uri: string, getValue: () => T): Specifier<T> {
  return {
    [specifierBrand]: true as const,
    uri,
    resolve(): Result<T> {
      return tryResolve(getValue, uri);
    }
  } as Specifier<T>;
}

// ============================================================================
// Entry Point
// ============================================================================

var Mail = {
  _app: null as MailApplication | null,

  get app(): MailApplication {
    if (!this._app) {
      const app = Application('Mail');
      if (typeof app.accounts === 'undefined') {
        throw new Error('Not connected to Mail.app');
      }
      this._app = app as MailApplication;
    }
    return this._app;
  },

  accounts(): CollectionSpecifier<Account> {
    return accountCollectionSpecifier('mail://accounts', this.app.accounts);
  }
};

// Export for JXA
(globalThis as any).Mail = Mail;
