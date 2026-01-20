/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />

// ============================================================================
// Collections and Specifiers
// ============================================================================

// ADDRESSING MODES (empirically verified for Mail.app):
//                name  index  id
// account         ✓      ✓     ✓
// mailbox         ✓      ✓     ✗
// message         ✗      ✓     ✓
// recipient       ✓      ✓     ✗
// attachment      ✓      ✓     ✓

// ============================================================================
// Helpers
// ============================================================================

function str(val: unknown): string {
  return val == null ? '' : '' + val;
}

function tryResolve<T>(fn: () => T, context: string): Result<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: `${context}: ${e}` };
  }
}

// ============================================================================
// Core Types
// ============================================================================

// A type that can be constructed from a JXA object
type JXAConstructable<T> = {
  fromJXA(jxa: any): T;
};

// Element specifier - just data
type ElementSpecifier<T> = {
  readonly uri: string;
  readonly ctor: JXAConstructable<T>;
};

// Collection base
interface Collection<T> {
  resolve(): Result<T[]>;
  uri(): string;
}

// ============================================================================
// Specifier Functions (operate on specifier data)
// ============================================================================

function resolve<T>(spec: ElementSpecifier<T>): Result<T> {
  return tryResolve(() => {
    const jxa = jxaFromUri(spec.uri);
    return spec.ctor.fromJXA(jxa);
  }, spec.uri);
}

function specUri<T>(spec: ElementSpecifier<T>): string {
  return spec.uri;
}

function specToJSON<T>(spec: ElementSpecifier<T>): string {
  return spec.uri;
}

// TODO: fix() - converts index-based specifier to id/name-based
// Needs to know what addressing modes the collection supports

// ============================================================================
// URI → JXA Navigation
// ============================================================================

function jxaFromUri(uri: string): any {
  // Parse URI and navigate JXA tree
  // e.g., "mail://accounts/Exchange" → Mail.app.accounts.byName("Exchange")
  // e.g., "mail://accounts[0]" → Mail.app.accounts.at(0)
  // e.g., "mail://accounts/Exchange/mailboxes/INBOX" → ...

  // TODO: implement properly
  const match = uri.match(/^mail:\/\/accounts\/([^/\[]+)$/);
  if (match) {
    return Mail.app.accounts.byName(decodeURIComponent(match[1]));
  }

  const indexMatch = uri.match(/^mail:\/\/accounts\[(\d+)\]$/);
  if (indexMatch) {
    return Mail.app.accounts.at(parseInt(indexMatch[1]));
  }

  throw new Error(`Cannot parse URI: ${uri}`);
}

// ============================================================================
// Addressing Traits (for building collections)
// ============================================================================

function withByName<T>(
  jxa: JXAElementArray<any>,
  baseUri: string,
  ctor: JXAConstructable<T>
) {
  return {
    byName(name: string): ElementSpecifier<T> {
      return {
        uri: `${baseUri}/${encodeURIComponent(name)}`,
        ctor
      };
    }
  };
}

function withByIndex<T>(
  jxa: JXAElementArray<any>,
  baseUri: string,
  ctor: JXAConstructable<T>
) {
  return {
    byIndex(i: number): ElementSpecifier<T> {
      return {
        uri: `${baseUri}[${i}]`,
        ctor
      };
    }
  };
}

function withById<T>(
  jxa: JXAElementArray<any>,
  baseUri: string,
  ctor: JXAConstructable<T>
) {
  return {
    byId(id: number | string): ElementSpecifier<T> {
      return {
        uri: `${baseUri}/${id}`,
        ctor
      };
    }
  };
}

// ============================================================================
// Account
// ============================================================================

class Account {
  private constructor(
    readonly id: string,
    readonly name: string,
    readonly fullName: string,
    readonly emailAddresses: string[]
  ) {}

  static fromJXA(jxa: JXAAccount): Account {
    return new Account(
      str(jxa.id()),
      str(jxa.name()),
      str(jxa.fullName()),
      jxa.emailAddresses().map(str)
    );
  }
}

type AccountSpecifier = ElementSpecifier<Account>;

type AccountCollection = Collection<Account> & {
  byName(name: string): AccountSpecifier;
  byIndex(i: number): AccountSpecifier;
  byId(id: string): AccountSpecifier;
};

function accountCollection(jxa: JXAElementArray<JXAAccount>): AccountCollection {
  const baseUri = 'mail://accounts';

  return {
    ...withByName(jxa, baseUri, Account),
    ...withByIndex(jxa, baseUri, Account),
    ...withById(jxa, baseUri, Account),

    resolve(): Result<Account[]> {
      return tryResolve(
        () => jxa().map(j => Account.fromJXA(j)),
        'accounts'
      );
    },

    uri(): string {
      return baseUri;
    }
  } as AccountCollection;
}

// ============================================================================
// Mail.app Entry Point
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

  accounts(): AccountCollection {
    return accountCollection(this.app.accounts);
  }
};

// Export to global scope for JXA
(globalThis as any).Mail = Mail;
(globalThis as any).resolve = resolve;
