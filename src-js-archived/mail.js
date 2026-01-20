// Mail.app singleton
// Central interface to Apple Mail via JXA

const Mail = {
    _app: null,
    get app() { return this._app || (this._app = Application('Mail')); },

    accounts() {
        return this.app.accounts().map(a => ({
            name: a.name(),
            mailboxes: () => a.mailboxes().map(m => Mailbox(m))
        }));
    },

    findMailbox(accountName, mailboxPath) {
        try {
            const acc = this.app.accounts.byName(accountName);
            const mb = acc.mailboxes.byName(mailboxPath);
            mb.name(); // verify exists
            return Mailbox(mb);
        } catch (e) { return null; }
    },

    findMailboxByName(accountName, name) {
        for (const acc of this.app.accounts()) {
            if (accountName && acc.name() !== accountName) continue;
            for (const mb of acc.mailboxes()) {
                if (mb.name() === name) return Mailbox(mb);
            }
        }
        return null;
    },

    // Best-effort message lookup - returns quickly if not found in cache/inbox
    // For reliable message access, browse via mailbox:// resources first
    messageFromUrl(url) {
        const match = url.match(/^message:\/\/<(.+)>$/);
        if (!match) return null;
        // Decode URL escapes (must decode %25 first to handle literal % in message IDs)
        const messageId = match[1].replace(/%25/g, '%').replace(/%23/g, '#').replace(/%20/g, ' ');

        // 1. Cache lookup (fast path) - check cached mailbox location
        const cached = Cache.lookup(messageId);
        if (cached) {
            const mb = this.findMailbox(cached.account, cached.mailboxPath);
            if (mb) {
                const msg = mb.searchByMessageId(messageId);
                if (msg) return msg;
            }
        }

        // 2. Quick inbox search across all accounts
        for (const acc of this.app.accounts()) {
            const inbox = this.findMailboxByName(acc.name(), 'INBOX') || this.findMailboxByName(acc.name(), 'Inbox');
            if (inbox) {
                const msg = inbox.searchByMessageId(messageId);
                if (msg) { msg.cache(); return msg; }
            }
        }

        // Not found - no exhaustive search to keep response fast
        return null;
    },

    checkForNewMail() { this.app.checkForNewMail(); },
    move(msg, toMailbox) { this.app.move(msg._jxa, { to: toMailbox._jxa }); },
    delete(msg) { this.app.delete(msg._jxa); }
};
