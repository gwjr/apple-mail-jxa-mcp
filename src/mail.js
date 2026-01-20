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

    messageFromUrl(url) {
        const match = url.match(/^message:\/\/<(.+)>$/);
        if (!match) return null;
        // Decode URL escapes (must decode %25 first to handle literal % in message IDs)
        const messageId = match[1].replace(/%25/g, '%').replace(/%23/g, '#').replace(/%20/g, ' ');

        // 1. Cache lookup
        const cached = Cache.lookup(messageId);
        if (cached) {
            const mb = this.findMailbox(cached.account, cached.mailboxPath);
            if (mb) {
                try {
                    const found = mb._jxa.messages.whose({ id: { _equals: cached.internalId } })();
                    if (found.length && found[0].messageId() === messageId) {
                        return Message(found[0]);
                    }
                } catch (e) {}
            }
        }

        // 2. Search inboxes
        for (const acc of this.app.accounts()) {
            const inbox = this.findMailboxByName(acc.name(), 'INBOX') || this.findMailboxByName(acc.name(), 'Inbox');
            if (inbox) {
                const msg = inbox.searchByMessageId(messageId);
                if (msg) { msg.cache(); return msg; }
            }
        }

        // 3. Search by popularity
        const searched = new Set();
        for (const { account, mailboxPath } of Cache.popularMailboxes()) {
            if (mailboxPath.toLowerCase() === 'inbox') continue;
            const key = `${account}:${mailboxPath}`;
            if (searched.has(key)) continue;
            searched.add(key);
            const mb = this.findMailbox(account, mailboxPath);
            if (mb) {
                const msg = mb.searchByMessageId(messageId);
                if (msg) { msg.cache(); return msg; }
            }
        }

        // 4. Full enumeration disabled - too expensive
        return null;
    },

    checkForNewMail() { this.app.checkForNewMail(); },
    move(msg, toMailbox) { this.app.move(msg._jxa, { to: toMailbox._jxa }); },
    delete(msg) { this.app.delete(msg._jxa); }
};
