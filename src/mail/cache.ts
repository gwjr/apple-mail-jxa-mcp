/// <reference path="../types/jxa.d.ts" />

// ============================================================================
// SQLite Cache for message lookups
// Stores message locations to avoid expensive mailbox scans
// ============================================================================

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
CREATE INDEX IF NOT EXISTS idx_messages_account_mailbox ON messages(account, mailbox_path);
CREATE VIEW IF NOT EXISTS mailbox_popularity AS
SELECT account, mailbox_path, COUNT(*) as message_count
FROM messages GROUP BY account, mailbox_path ORDER BY message_count DESC;
`;

interface CacheLookupResult {
  account: string;
  mailboxPath: string;
  internalId: number;
}

interface PopularMailbox {
  account: string;
  mailboxPath: string;
}

const Cache = {
  _initialized: false,

  init(): void {
    if (this._initialized) return;

    const fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(CACHE_DIR)) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        CACHE_DIR, true, $(), $()
      );
    }
    if (!fm.fileExistsAtPath(ATTACHMENTS_DIR)) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        ATTACHMENTS_DIR, true, $(), $()
      );
    }
    this.sql(SCHEMA);
    this._initialized = true;
  },

  sql(query: string): string | null {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    // Shell-safe escaping: single quotes prevent all interpolation
    const shellEsc = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
    try {
      return app.doShellScript('sqlite3 ' + shellEsc(CACHE_DB) + ' ' + shellEsc(query));
    } catch {
      return null;
    }
  },

  store(messageId: string, account: string, mailboxPath: string, internalId: number): void {
    this.init();
    const esc = (s: string): string => s.replace(/'/g, "''");
    this.sql(
      `INSERT OR REPLACE INTO messages VALUES ('${esc(messageId)}', '${esc(account)}', '${esc(mailboxPath)}', ${internalId})`
    );
  },

  lookup(messageId: string): CacheLookupResult | null {
    this.init();
    const result = this.sql(
      `SELECT account, mailbox_path, internal_id FROM messages WHERE message_id = '${messageId.replace(/'/g, "''")}'`
    );
    if (!result) return null;
    const parts = result.split('|');
    if (parts.length < 3) return null;
    const [account, mailboxPath, internalIdStr] = parts;
    const internalId = parseInt(internalIdStr, 10);
    return !isNaN(internalId) ? { account, mailboxPath, internalId } : null;
  },

  popularMailboxes(): PopularMailbox[] {
    this.init();
    const result = this.sql('SELECT account, mailbox_path FROM mailbox_popularity');
    if (!result) return [];
    return result.split('\n').filter(l => l).map(l => {
      const [account, mailboxPath] = l.split('|');
      return { account, mailboxPath };
    });
  },

  getAttachmentsDir(): string {
    this.init();
    return ATTACHMENTS_DIR;
  }
};
