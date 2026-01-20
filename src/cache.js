// SQLite Cache for message lookups
// Stores message locations to avoid expensive mailbox scans

const CACHE_DIR = $.NSHomeDirectory().js + '/.cache/jxa-mail';
const CACHE_DB = CACHE_DIR + '/messages.db';
const ATTACHMENTS_DIR = CACHE_DIR + '/attachments';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    mailbox_path TEXT NOT NULL,
    internal_id INTEGER NOT NULL
);
CREATE VIEW IF NOT EXISTS mailbox_popularity AS
SELECT account, mailbox_path, COUNT(*) as message_count
FROM messages GROUP BY account, mailbox_path ORDER BY message_count DESC;
`;

const Cache = {
    init() {
        const fm = $.NSFileManager.defaultManager;
        if (!fm.fileExistsAtPath(CACHE_DIR)) {
            fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(CACHE_DIR, true, $(), $());
        }
        if (!fm.fileExistsAtPath(ATTACHMENTS_DIR)) {
            fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(ATTACHMENTS_DIR, true, $(), $());
        }
        this.sql(SCHEMA);
    },

    sql(query) {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;
        // Shell-safe escaping: single quotes prevent all interpolation
        const shellEsc = s => "'" + s.replace(/'/g, "'\\''") + "'";
        try {
            return app.doShellScript('sqlite3 ' + shellEsc(CACHE_DB) + ' ' + shellEsc(query));
        } catch (e) {
            return null;
        }
    },

    store(messageId, account, mailboxPath, internalId) {
        const esc = s => s.replace(/'/g, "''");
        this.sql(`INSERT OR REPLACE INTO messages VALUES ('${esc(messageId)}', '${esc(account)}', '${esc(mailboxPath)}', ${internalId})`);
    },

    lookup(messageId) {
        const result = this.sql(`SELECT account, mailbox_path, internal_id FROM messages WHERE message_id = '${messageId.replace(/'/g, "''")}'`);
        if (!result) return null;
        const [account, mailboxPath, internalId] = result.split('|');
        return internalId ? { account, mailboxPath, internalId: parseInt(internalId, 10) } : null;
    },

    popularMailboxes() {
        const result = this.sql('SELECT account, mailbox_path FROM mailbox_popularity');
        if (!result) return [];
        return result.split('\n').filter(l => l).map(l => {
            const [account, mailboxPath] = l.split('|');
            return { account, mailboxPath };
        });
    }
};

Cache.init();
