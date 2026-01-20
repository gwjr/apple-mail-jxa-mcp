/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mail-app.d.ts" />
/// <reference path="collections.ts" />

// ============================================================================
// Mail.app Singleton
// Central interface to Apple Mail via JXA
// ============================================================================

const Mail = {
  _app: null as MailApplication | null,

  get app(): MailApplication {
    if (!this._app) {
      this._app = Application('Mail') as MailApplication;
    }
    return this._app;
  },

  accounts(): AccountCollection {
    return AccountCollection(this.app.accounts);
  }

  // ============================================================================
  // COMMENTED OUT - to be rebuilt using collection pattern
  // ============================================================================

  /*
  getAccounts(): AccountSpecifierType[] {
    try {
      return this.app.accounts().map((a: JXAAccount) => AccountSpecifier(a));
    } catch {
      return [];
    }
  },

  getAccount(name: string): AccountSpecifierType | null {
    try {
      const acc = this.app.accounts.byName(name);
      acc.name();
      return AccountSpecifier(acc);
    } catch {
      return null;
    }
  },

  findMailbox(accountName: string, mailboxPath: string): MailboxSpecifierType | null {
    const account = this.getAccount(accountName);
    if (!account) return null;
    return account.findMailbox(mailboxPath);
  },

  findMailboxByName(accountName: string | null, name: string): MailboxSpecifierType | null {
    const accounts = accountName
      ? [this.getAccount(accountName)].filter((a): a is AccountSpecifierType => a !== null)
      : this.getAccounts();

    for (const acc of accounts) {
      for (const mb of acc.getAllMailboxes()) {
        if (mb.name === name) return mb;
      }
    }
    return null;
  },

  findMailboxByPath(accountName: string, pathParts: string[]): MailboxSpecifierType | null {
    if (pathParts.length === 0) return null;
    const account = this.getAccount(accountName);
    if (!account) return null;
    const fullPath = pathParts.join('/');
    return account.findMailbox(fullPath);
  },

  findMessageById(accountName: string, mailboxPath: string[], messageId: number): MessageSpecifierType | null {
    const mb = this.findMailboxByPath(accountName, mailboxPath);
    if (!mb) return null;
    return mb.getMessageById(messageId);
  },

  messageFromUrl(url: string): MessageSpecifierType | null {
    const match = url.match(/^message:\/\/<(.+)>$/);
    if (!match) return null;

    const messageId = match[1]
      .replace(/%25/g, '%')
      .replace(/%23/g, '#')
      .replace(/%20/g, ' ');

    const cached = Cache.lookup(messageId);
    if (cached) {
      const mb = this.findMailbox(cached.account, cached.mailboxPath);
      if (mb) {
        const msg = mb.searchByMessageId(messageId);
        if (msg) return msg;
      }
    }

    for (const acc of this.getAccounts()) {
      const inbox = this.findMailboxByName(acc.name, 'INBOX')
        || this.findMailboxByName(acc.name, 'Inbox');
      if (inbox) {
        const msg = inbox.searchByMessageId(messageId);
        if (msg) {
          msg.cache();
          return msg;
        }
      }
    }

    return null;
  },

  get inbox(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.inbox, '__unified__', ['INBOX']);
    } catch {
      return null;
    }
  },

  get drafts(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.drafts, '__unified__', ['Drafts']);
    } catch {
      return null;
    }
  },

  get sentMailbox(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.sentMailbox, '__unified__', ['Sent']);
    } catch {
      return null;
    }
  },

  get junkMailbox(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.junkMailbox, '__unified__', ['Junk']);
    } catch {
      return null;
    }
  },

  get trash(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.trash, '__unified__', ['Trash']);
    } catch {
      return null;
    }
  },

  get outbox(): MailboxSpecifierType | null {
    try {
      return MailboxSpecifier(this.app.outbox, '__unified__', ['Outbox']);
    } catch {
      return null;
    }
  },

  checkForNewMail(): void {
    try {
      this.app.checkForNewMail();
    } catch {
    }
  },

  moveMessage(msg: MessageSpecifierType, toMailbox: MailboxSpecifierType): void {
    this.app.move(msg._jxa, { to: toMailbox._jxa });
  },

  deleteMessage(msg: MessageSpecifierType): void {
    this.app.delete(msg._jxa);
  },

  getRules(): JXARule[] {
    return getOr(() => this.app.rules(), []);
  },

  getSignatures(): JXASignature[] {
    return getOr(() => this.app.signatures(), []);
  }
  */
};
