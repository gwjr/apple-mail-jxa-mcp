// Facade objects for Mail.app JXA types
// Wraps raw JXA references with cleaner APIs and JSON serialization

function Mailbox(jxaMailbox) {
    return {
        _jxa: jxaMailbox,
        get name() { return jxaMailbox.name(); },
        get path() {
            const s = Automation.getDisplayString(jxaMailbox);
            const m = s.match(/mailboxes\.byName\("([^"]+)"\)/);
            return m ? m[1] : jxaMailbox.name();
        },
        get accountName() { return jxaMailbox.account().name(); },
        get unreadCount() { return jxaMailbox.unreadCount(); },
        messages(opts) {
            opts = opts || {};
            let msgs = opts.unreadOnly
                ? jxaMailbox.messages.whose({ readStatus: { _equals: false } })()
                : jxaMailbox.messages();
            if (opts.limit) msgs = msgs.slice(0, opts.limit);
            return msgs.map(m => Message(m));
        },
        searchByMessageId(messageId) {
            try {
                const found = jxaMailbox.messages.whose({ messageId: { _equals: messageId } })();
                return found.length > 0 ? Message(found[0]) : null;
            } catch (e) { return null; }
        }
    };
}

function Message(jxaMsg) {
    const self = {
        _jxa: jxaMsg,
        get id() { return jxaMsg.id(); },
        get messageId() { return jxaMsg.messageId(); },
        get url() {
            const mid = self.messageId.replace(/%/g, '%25').replace(/ /g, '%20').replace(/#/g, '%23');
            return `message://<${mid}>`;
        },
        get subject() { return jxaMsg.subject(); },
        get sender() { return jxaMsg.sender(); },
        get dateReceived() { try { return jxaMsg.dateReceived().toISOString(); } catch(e) { return null; } },
        get dateSent() { try { return jxaMsg.dateSent().toISOString(); } catch(e) { return null; } },
        get read() { return jxaMsg.readStatus(); },
        set read(v) { jxaMsg.readStatus = v; },
        get flagged() { return jxaMsg.flaggedStatus(); },
        set flagged(v) { jxaMsg.flaggedStatus = v; },
        get mailbox() { return Mailbox(jxaMsg.mailbox()); },

        cache() {
            const mb = self.mailbox;
            Cache.store(self.messageId, mb.accountName, mb.path, self.id);
        },

        props(full) {
            self.cache();
            const p = {
                url: self.url,
                subject: self.subject,
                sender: self.sender,
                dateReceived: self.dateReceived,
                read: self.read,
                flagged: self.flagged
            };
            if (full) {
                p.dateSent = self.dateSent;
                p.replyTo = jxaMsg.replyTo();
                p.junk = jxaMsg.junkMailStatus();
                p.mailbox = self.mailbox.path;
                p.account = self.mailbox.accountName;
                p.content = jxaMsg.content();
                p.toRecipients = jxaMsg.toRecipients().map(r => ({ name: r.name(), address: r.address() }));
                p.ccRecipients = jxaMsg.ccRecipients().map(r => ({ name: r.name(), address: r.address() }));
                p.attachments = jxaMsg.mailAttachments().map((a, i) => ({
                    index: i,
                    name: a.name(),
                    mimeType: a.mimeType(),
                    fileSize: (() => { try { return a.fileSize(); } catch(e) { return null; } })(),
                    downloaded: a.downloaded()
                }));
            }
            return p;
        }
    };
    return self;
}
