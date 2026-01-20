// === src/framework.js (lines 1-400) ===
// MCP Framework for JXA
// Provides JSON-RPC 2.0 over stdio with NSRunLoop-based I/O

ObjC.import('Foundation');

function createMCPServer(options) {
    const serverName = options.name || 'jxa-mcp-server';
    const serverVersion = options.version || '1.0.0';
    const protocolVersion = options.protocolVersion || '2024-11-05';
    const debug = options.debug !== false;

    const stdin = $.NSFileHandle.fileHandleWithStandardInput;
    const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
    const stderr = $.NSFileHandle.fileHandleWithStandardError;

    const tools = [];
    const toolHandlers = {};
    let resourceLister = null;
    let resourceReader = null;

    function log(msg) {
        if (!debug) return;
        const data = $.NSString.alloc.initWithUTF8String('[' + serverName + '] ' + msg + '\n')
            .dataUsingEncoding($.NSUTF8StringEncoding);
        stderr.writeData(data);
    }

    function writeLine(obj) {
        const str = JSON.stringify(obj) + '\n';
        const data = $.NSString.alloc.initWithUTF8String(str)
            .dataUsingEncoding($.NSUTF8StringEncoding);
        stdout.writeData(data);
    }

    function sendResult(id, result) {
        writeLine({ jsonrpc: '2.0', id: id, result: result });
    }

    function sendError(id, code, message) {
        writeLine({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
    }

    function sendToolResult(id, text, isError) {
        sendResult(id, {
            content: [{ type: 'text', text: String(text) }],
            isError: isError || false
        });
    }

    function handleRequest(request) {
        const { id, method, params } = request;

        switch (method) {
            case 'initialize':
                log('Initialize from: ' + (params?.clientInfo?.name || 'unknown'));
                const capabilities = { tools: {} };
                if (resourceLister) capabilities.resources = {};
                sendResult(id, {
                    protocolVersion: protocolVersion,
                    capabilities: capabilities,
                    serverInfo: { name: serverName, version: serverVersion }
                });
                break;

            case 'notifications/initialized':
                log('Client initialized');
                break;

            case 'tools/list':
                log('Tools list (' + tools.length + ')');
                sendResult(id, { tools: tools });
                break;

            case 'tools/call':
                const toolName = params?.name;
                const args = params?.arguments || {};
                log('Call: ' + toolName);

                const handler = toolHandlers[toolName];
                if (!handler) {
                    sendError(id, -32601, 'Unknown tool: ' + toolName);
                    break;
                }

                try {
                    const result = handler(args);
                    if (result && result._error) {
                        sendToolResult(id, result._error, true);
                    } else {
                        sendToolResult(id, result ?? 'OK');
                    }
                } catch (e) {
                    sendToolResult(id, 'Error: ' + e.message, true);
                }
                break;

            case 'resources/list':
                log('Resources list');
                if (!resourceLister) {
                    sendResult(id, { resources: [] });
                } else {
                    try {
                        sendResult(id, { resources: resourceLister() });
                    } catch (e) {
                        sendError(id, -32000, 'Resource list error: ' + e.message);
                    }
                }
                break;

            case 'resources/read':
                const uri = params?.uri;
                log('Resource read: ' + uri);
                if (!resourceReader) {
                    sendError(id, -32601, 'Resources not supported');
                } else {
                    try {
                        const content = resourceReader(uri);
                        if (content === null || content === undefined) {
                            sendError(id, -32002, 'Resource not found: ' + uri);
                        } else {
                            sendResult(id, {
                                contents: [{
                                    uri: uri,
                                    mimeType: content.mimeType || 'application/json',
                                    text: typeof content.text === 'string' ? content.text : JSON.stringify(content.text, null, 2)
                                }]
                            });
                        }
                    } catch (e) {
                        sendError(id, -32000, 'Resource read error: ' + e.message);
                    }
                }
                break;

            default:
                if (id !== undefined && !method?.startsWith('notifications/')) {
                    sendError(id, -32601, 'Method not found: ' + method);
                }
        }
    }

    return {
        addTool: function(def) {
            tools.push({
                name: def.name,
                description: def.description || '',
                inputSchema: def.inputSchema || { type: 'object', properties: {}, required: [] }
            });
            toolHandlers[def.name] = def.handler;
            return this;
        },

        setResources: function(lister, reader) {
            resourceLister = lister;
            resourceReader = reader;
            return this;
        },

        error: function(msg) { return { _error: msg }; },

        run: function() {
            log('Starting');

            let buffer = '';
            let dataAvailable = false;
            let shouldQuit = false;

            const handlerName = 'H' + Date.now();
            ObjC.registerSubclass({
                name: handlerName,
                methods: {
                    'h:': {
                        types: ['void', ['id']],
                        implementation: function() { dataAvailable = true; }
                    }
                }
            });

            const handler = $[handlerName].alloc.init;
            $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
                handler, 'h:', 'NSFileHandleDataAvailableNotification', stdin
            );

            stdin.waitForDataInBackgroundAndNotify;

            while (!shouldQuit) {
                $.NSRunLoop.currentRunLoop.runUntilDate(
                    $.NSDate.dateWithTimeIntervalSinceNow(1.0)
                );

                if (dataAvailable) {
                    dataAvailable = false;
                    const data = stdin.availableData;

                    if (data.length === 0) {
                        shouldQuit = true;
                        break;
                    }

                    buffer += $.NSString.alloc.initWithDataEncoding(
                        data, $.NSUTF8StringEncoding
                    ).js;

                    let lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            handleRequest(JSON.parse(line));
                        } catch (e) {
                            sendError(null, -32700, 'Parse error');
                        }
                    }

                    if (!shouldQuit) stdin.waitForDataInBackgroundAndNotify;
                }
            }

            $.NSNotificationCenter.defaultCenter.removeObserverNameObject(
                handler, 'NSFileHandleDataAvailableNotification', stdin
            );
            log('Done');
        }
    };
}













































































































































































// === src/cache.js (lines 401-800) ===
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
        try {
            return app.doShellScript(`sqlite3 "${CACHE_DB}" "${query.replace(/"/g, '\\"')}"`);
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















































































































































































































































































































































// === src/facades.js (lines 801-1200) ===
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
























































































































































































































































































































// === src/mail.js (lines 1201-1600) ===
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
        const messageId = match[1].replace(/%23/g, '#').replace(/%20/g, ' ').replace(/%25/g, '%');

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




























































































































































































































































































































// === src/resources.js (lines 1601-2000) ===
// MCP Server instance and Resource handlers
// Hierarchical resource structure for Mail.app

const server = createMCPServer({
    name: 'jxa-mail',
    version: '1.0.0'
});

// Resources: hierarchical structure
// - mail://properties - app properties
// - mail://rules - mail rules (can drill into individual rules)
// - mail://signatures - email signatures
// - unified://inbox etc. - cross-account mailboxes
// - mailaccount://Name - accounts → mailboxes → nested mailboxes

server.setResources(
    // Lister: app-level resources + unified mailboxes + accounts
    () => {
        const appResources = [
            { uri: 'mail://properties', name: 'App Properties', description: 'Mail.app properties' },
            { uri: 'mail://rules', name: 'Rules', description: 'Mail filtering rules' },
            { uri: 'mail://signatures', name: 'Signatures', description: 'Email signatures' }
        ];

        const unified = [
            { key: 'inbox', name: 'All Inboxes' },
            { key: 'drafts', name: 'All Drafts' },
            { key: 'sent', name: 'All Sent' },
            { key: 'junk', name: 'All Junk' },
            { key: 'trash', name: 'All Trash' },
            { key: 'outbox', name: 'Outbox' }
        ].map(u => ({
            uri: `unified://${u.key}`,
            name: u.name,
            description: 'Cross-account mailbox'
        }));

        const accounts = Mail.accounts().map(acc => ({
            uri: `mailaccount://${encodeURIComponent(acc.name)}`,
            name: acc.name,
            description: 'Mail account'
        }));

        return [...appResources, ...unified, ...accounts];
    },

    // Reader: app resources, unified mailboxes, accounts, or individual mailboxes
    (uri) => {
        const app = Mail.app;

        // App properties: mail://properties
        if (uri === 'mail://properties') {
            const get = (fn) => { try { return fn(); } catch(e) { return null; } };
            return {
                mimeType: 'application/json',
                text: {
                    name: get(() => app.name()),
                    version: get(() => app.version()),
                    applicationVersion: get(() => app.applicationVersion()),
                    frontmost: get(() => app.frontmost()),
                    // Mail behavior
                    alwaysBccMyself: get(() => app.alwaysBccMyself()),
                    alwaysCcMyself: get(() => app.alwaysCcMyself()),
                    downloadHtmlAttachments: get(() => app.downloadHtmlAttachments()),
                    fetchInterval: get(() => app.fetchInterval()),
                    expandGroupAddresses: get(() => app.expandGroupAddresses()),
                    // Composing
                    defaultMessageFormat: get(() => app.defaultMessageFormat()),
                    chooseSignatureWhenComposing: get(() => app.chooseSignatureWhenComposing()),
                    selectedSignature: get(() => app.selectedSignature()?.name()),
                    quoteOriginalMessage: get(() => app.quoteOriginalMessage()),
                    sameReplyFormat: get(() => app.sameReplyFormat()),
                    includeAllOriginalMessageText: get(() => app.includeAllOriginalMessageText()),
                    // Display
                    highlightSelectedConversation: get(() => app.highlightSelectedConversation()),
                    colorQuotedText: get(() => app.colorQuotedText()),
                    levelOneQuotingColor: get(() => app.levelOneQuotingColor()),
                    levelTwoQuotingColor: get(() => app.levelTwoQuotingColor()),
                    levelThreeQuotingColor: get(() => app.levelThreeQuotingColor()),
                    // Fonts
                    messageFont: get(() => app.messageFont()),
                    messageFontSize: get(() => app.messageFontSize()),
                    messageListFont: get(() => app.messageListFont()),
                    messageListFontSize: get(() => app.messageListFontSize()),
                    useFixedWidthFont: get(() => app.useFixedWidthFont()),
                    fixedWidthFont: get(() => app.fixedWidthFont()),
                    fixedWidthFontSize: get(() => app.fixedWidthFontSize()),
                    // Sounds
                    newMailSound: get(() => app.newMailSound()),
                    shouldPlayOtherMailSounds: get(() => app.shouldPlayOtherMailSounds()),
                    // Spelling
                    checkSpellingWhileTyping: get(() => app.checkSpellingWhileTyping())
                }
            };
        }

        // Rules: mail://rules or mail://rules/index
        let match = uri.match(/^mail:\/\/rules(?:\/(\d+))?$/);
        if (match) {
            const rules = app.rules();
            if (match[1] !== undefined) {
                // Individual rule
                const idx = parseInt(match[1], 10);
                if (idx < 0 || idx >= rules.length) return null;
                const r = rules[idx];
                const get = (fn) => { try { return fn(); } catch(e) { return null; } };
                let conditions = [];
                try {
                    conditions = r.ruleConditions().map(c => ({
                        header: get(() => c.header()),
                        qualifier: get(() => c.qualifier()),
                        ruleType: get(() => c.ruleType()),
                        expression: get(() => c.expression())
                    }));
                } catch(e) {}
                return {
                    mimeType: 'application/json',
                    text: {
                        index: idx,
                        name: get(() => r.name()),
                        enabled: get(() => r.enabled()),
                        allConditionsMustBeMet: get(() => r.allConditionsMustBeMet()),
                        copyMessage: get(() => r.copyMessage()?.name()),
                        moveMessage: get(() => r.moveMessage()?.name()),
                        forwardMessage: get(() => r.forwardMessage()),
                        redirectMessage: get(() => r.redirectMessage()),
                        replyText: get(() => r.replyText()),
                        runScript: get(() => r.runScript()?.name()),
                        highlightTextUsingColor: get(() => r.highlightTextUsingColor()),
                        deleteMessage: get(() => r.deleteMessage()),
                        markFlagged: get(() => r.markFlagged()),
                        markFlagIndex: get(() => r.markFlagIndex()),
                        markRead: get(() => r.markRead()),
                        playSound: get(() => r.playSound()),
                        stopEvaluatingRules: get(() => r.stopEvaluatingRules()),
                        ruleConditions: conditions
                    }
                };
            }
            // List all rules
            return {
                mimeType: 'application/json',
                text: {
                    count: rules.length,
                    rules: rules.map((r, i) => ({
                        uri: `mail://rules/${i}`,
                        name: r.name(),
                        enabled: r.enabled()
                    }))
                }
            };
        }

        // Signatures: mail://signatures or mail://signatures/name
        match = uri.match(/^mail:\/\/signatures(?:\/(.+))?$/);
        if (match) {
            const sigs = app.signatures();
            if (match[1] !== undefined) {
                // Individual signature by name
                const sigName = decodeURIComponent(match[1]);
                const sig = sigs.find(s => s.name() === sigName);
                if (!sig) return null;
                return {
                    mimeType: 'application/json',
                    text: {
                        name: sig.name(),
                        content: sig.content()
                    }
                };
            }
            // List all signatures
            return {
                mimeType: 'application/json',
                text: {
                    count: sigs.length,
                    signatures: sigs.map(s => ({
                        uri: `mail://signatures/${encodeURIComponent(s.name())}`,
                        name: s.name()
                    }))
                }
            };
        }

        // Unified: unified://inbox, unified://sent, etc.
        match = uri.match(/^unified:\/\/(\w+)$/);
        if (match) {
            const key = match[1];
            const mailApp = Mail.app;
            const mailboxMap = {
                inbox: () => mailApp.inbox,
                drafts: () => mailApp.drafts,
                sent: () => mailApp.sentMailbox,
                junk: () => mailApp.junkMailbox,
                trash: () => mailApp.trash,
                outbox: () => mailApp.outbox
            };
            const getter = mailboxMap[key];
            if (!getter) return null;
            try {
                const mb = getter();
                return {
                    mimeType: 'application/json',
                    text: {
                        name: key,
                        unreadCount: mb.unreadCount(),
                        messageCount: mb.messages().length
                    }
                };
            } catch (e) {
                return { mimeType: 'application/json', text: { name: key, error: e.message } };
            }
        }

        // Account: mailaccount://Name → top-level mailboxes only
        match = uri.match(/^mailaccount:\/\/([^\/]+)$/);
        if (match) {
            const accountName = decodeURIComponent(match[1]);
            const account = Mail.accounts().find(a => a.name === accountName);
            if (!account) return null;
            const allMailboxes = account.mailboxes();
            const topLevel = allMailboxes.filter(mb => !mb.path.includes('/'));
            const mailboxes = topLevel.map(mb => ({
                uri: `mailbox://${encodeURIComponent(accountName)}/${encodeURIComponent(mb.path)}`,
                name: mb.name,
                unreadCount: mb.unreadCount,
                hasChildren: allMailboxes.some(other => other.path.startsWith(mb.path + '/'))
            }));
            return { mimeType: 'application/json', text: { account: accountName, mailboxes } };
        }

        // Mailbox: mailbox://Account/Path → children if any, otherwise info
        match = uri.match(/^mailbox:\/\/([^\/]+)\/(.+)$/);
        if (match) {
            const accountName = decodeURIComponent(match[1]);
            const mailboxPath = decodeURIComponent(match[2]);
            const mb = Mail.findMailbox(accountName, mailboxPath);
            if (!mb) return null;

            // Find direct children
            const account = Mail.accounts().find(a => a.name === accountName);
            const allMailboxes = account ? account.mailboxes() : [];
            const prefix = mailboxPath + '/';
            const children = allMailboxes.filter(other => {
                if (!other.path.startsWith(prefix)) return false;
                const remainder = other.path.slice(prefix.length);
                return !remainder.includes('/'); // direct child only
            });

            if (children.length > 0) {
                return {
                    mimeType: 'application/json',
                    text: {
                        account: accountName,
                        path: mb.path,
                        unreadCount: mb.unreadCount,
                        children: children.map(c => ({
                            uri: `mailbox://${encodeURIComponent(accountName)}/${encodeURIComponent(c.path)}`,
                            name: c.name,
                            unreadCount: c.unreadCount,
                            hasChildren: allMailboxes.some(other => other.path.startsWith(c.path + '/'))
                        }))
                    }
                };
            }

            // Leaf mailbox - just info
            return { mimeType: 'application/json', text: { account: accountName, path: mb.path, unreadCount: mb.unreadCount } };
        }

        return null;
    }
);































































































































// === src/tools-messages.js (lines 2001-2400) ===
// MCP Tools: Message operations
// list, get, mark, flag, move, delete, send, check, selection, windows

server.addTool({
    name: 'list_messages',
    description: 'List messages in a mailbox. Returns summary info with message:// URLs.',
    inputSchema: {
        type: 'object',
        properties: {
            mailbox: { type: 'string', description: 'Mailbox name or path (e.g., "INBOX", "Archive/Projects")' },
            account: { type: 'string', description: 'Account name (optional)' },
            limit: { type: 'number', description: 'Max messages to return (default: 20)' },
            unreadOnly: { type: 'boolean', description: 'Only return unread messages' }
        },
        required: ['mailbox']
    },
    handler: (args) => {
        const mb = Mail.findMailboxByName(args.account, args.mailbox);
        if (!mb) return server.error(`Mailbox not found: ${args.mailbox}`);

        const messages = mb.messages({ limit: args.limit || 20, unreadOnly: args.unreadOnly });
        return JSON.stringify(messages.map(m => m.props()), null, 2);
    }
});

server.addTool({
    name: 'get_message',
    description: 'Get full details of a message including its content',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Message URL (message://...)' }
        },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        return JSON.stringify(msg.props(true), null, 2);
    }
});

server.addTool({
    name: 'send_email',
    description: 'Create and send an email message',
    inputSchema: {
        type: 'object',
        properties: {
            to: { type: 'array', items: { type: 'string' }, description: 'Recipient addresses' },
            cc: { type: 'array', items: { type: 'string' }, description: 'CC addresses' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'BCC addresses' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body' },
            sendNow: { type: 'boolean', description: 'Send immediately (default: true)' }
        },
        required: ['to', 'subject', 'body']
    },
    handler: (args) => {
        const app = Mail.app;
        const msg = app.OutgoingMessage({
            subject: args.subject,
            content: args.body,
            visible: args.sendNow === false
        });
        app.outgoingMessages.push(msg);

        for (const addr of args.to) msg.toRecipients.push(app.ToRecipient({ address: addr }));
        if (args.cc) for (const addr of args.cc) msg.ccRecipients.push(app.CcRecipient({ address: addr }));
        if (args.bcc) for (const addr of args.bcc) msg.bccRecipients.push(app.BccRecipient({ address: addr }));

        if (args.sendNow !== false) {
            msg.send();
            return `Email sent to ${args.to.join(', ')}`;
        }
        return `Draft created: ${args.subject}`;
    }
});

server.addTool({
    name: 'mark_read',
    description: 'Mark a message as read',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Message URL' } },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        msg.read = true;
        return 'Marked as read';
    }
});

server.addTool({
    name: 'mark_unread',
    description: 'Mark a message as unread',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Message URL' } },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        msg.read = false;
        return 'Marked as unread';
    }
});

server.addTool({
    name: 'toggle_flag',
    description: 'Toggle the flagged status of a message',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Message URL' } },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        msg.flagged = !msg.flagged;
        return msg.flagged ? 'Flagged' : 'Unflagged';
    }
});

server.addTool({
    name: 'move_message',
    description: 'Move a message to a different mailbox',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Message URL' },
            toMailbox: { type: 'string', description: 'Destination mailbox' },
            toAccount: { type: 'string', description: 'Destination account (optional)' }
        },
        required: ['url', 'toMailbox']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);

        const dest = Mail.findMailboxByName(args.toAccount, args.toMailbox);
        if (!dest) return server.error(`Mailbox not found: ${args.toMailbox}`);

        Mail.move(msg, dest);
        msg.cache(); // Update cache with new location
        return `Moved to ${dest.path}`;
    }
});

server.addTool({
    name: 'delete_message',
    description: 'Delete a message (moves to Trash)',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Message URL' } },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        Mail.delete(msg);
        return 'Deleted';
    }
});

server.addTool({
    name: 'check_mail',
    description: 'Check for new mail across all accounts',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => {
        Mail.checkForNewMail();
        return 'Checking...';
    }
});

server.addTool({
    name: 'get_selection',
    description: 'Get currently selected messages in Mail.app',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => {
        const app = Mail.app;
        const selection = app.selection();
        if (!selection || selection.length === 0) {
            return JSON.stringify({ count: 0, messages: [] });
        }
        const messages = selection.map(m => Message(m).props());
        return JSON.stringify({ count: messages.length, messages }, null, 2);
    }
});

server.addTool({
    name: 'get_windows',
    description: 'Get info about open Mail windows',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => {
        const app = Mail.app;
        const windows = [];
        try {
            for (const w of app.windows()) {
                try {
                    const info = { name: w.name(), id: w.id(), index: w.index() };
                    try { info.visible = w.visible(); } catch(e) {}
                    try { info.bounds = w.bounds(); } catch(e) {}
                    // Message viewer windows have selectedMessages
                    try {
                        const msgs = w.selectedMessages();
                        if (msgs && msgs.length > 0) {
                            info.selectedMessages = msgs.map(m => Message(m).props());
                        }
                    } catch(e) {}
                    windows.push(info);
                } catch (e) {
                    // Window reference became stale, skip it
                }
            }
        } catch (e) {
            return server.error('Failed to enumerate windows: ' + e.message);
        }
        return JSON.stringify(windows, null, 2);
    }
});
















































































































































































// === src/tools-crud.js (lines 2401-2800) ===
// MCP Tools: Attachments, Rules, and Signatures CRUD
// Attachment handling with sandbox workaround
// Full CRUD for mail rules and signatures

server.addTool({
    name: 'list_attachments',
    description: 'List attachments of a message',
    inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Message URL' } },
        required: ['url']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);
        const attachments = msg._jxa.mailAttachments().map((a, i) => ({
            index: i,
            name: a.name(),
            mimeType: a.mimeType(),
            fileSize: (() => { try { return a.fileSize(); } catch(e) { return null; } })(),
            downloaded: a.downloaded()
        }));
        return JSON.stringify({ messageUrl: args.url, count: attachments.length, attachments }, null, 2);
    }
});

server.addTool({
    name: 'save_attachment',
    description: 'Save a message attachment to disk. Returns the file path.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Message URL' },
            index: { type: 'number', description: 'Attachment index (from list_attachments)' },
            destPath: { type: 'string', description: 'Destination path (optional, defaults to cache dir)' }
        },
        required: ['url', 'index']
    },
    handler: (args) => {
        const msg = Mail.messageFromUrl(args.url);
        if (!msg) return server.error(`Message not found: ${args.url}`);

        const attachments = msg._jxa.mailAttachments();
        if (args.index < 0 || args.index >= attachments.length) {
            return server.error(`Invalid attachment index: ${args.index}`);
        }

        const attachment = attachments[args.index];
        if (!attachment.downloaded()) {
            return server.error(`Attachment not downloaded yet: ${attachment.name()}`);
        }

        const fileName = attachment.name();
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;

        // Get Mail's temp folder (sandbox-accessible)
        const mailTempFolder = app.pathTo('temporary items', { from: 'user domain' });
        const mailTempPath = $.NSString.alloc.initWithUTF8String(
            mailTempFolder.toString()
        ).stringByResolvingSymlinksInPath.js + '/';

        // Save to Mail's temp folder first
        const tempFile = mailTempPath + fileName;
        attachment.saveIn(Path(tempFile));

        // Determine final destination
        const destPath = args.destPath || (ATTACHMENTS_DIR + '/' + fileName);

        // Move from Mail's temp to destination (handles sandbox)
        const shellEsc = s => "'" + s.replace(/'/g, "'\\''") + "'";
        app.doShellScript('mv ' + shellEsc(tempFile) + ' ' + shellEsc(destPath));

        return JSON.stringify({ saved: true, path: destPath, name: fileName }, null, 2);
    }
});

// === Rule CRUD ===

server.addTool({
    name: 'create_rule',
    description: 'Create a new mail rule',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Rule name' },
            enabled: { type: 'boolean', description: 'Whether rule is enabled (default: true)' },
            allConditionsMustBeMet: { type: 'boolean', description: 'All conditions must match (default: true)' },
            conditions: {
                type: 'array',
                description: 'Rule conditions',
                items: {
                    type: 'object',
                    properties: {
                        ruleType: { type: 'string', description: 'Type: from header, to header, subject header, etc.' },
                        qualifier: { type: 'string', description: 'Qualifier: does contain value, does not contain value, etc.' },
                        expression: { type: 'string', description: 'Value to match' }
                    }
                }
            },
            // Actions
            moveMessage: { type: 'string', description: 'Mailbox name to move message to' },
            copyMessage: { type: 'string', description: 'Mailbox name to copy message to' },
            markRead: { type: 'boolean', description: 'Mark message as read' },
            markFlagged: { type: 'boolean', description: 'Mark message as flagged' },
            deleteMessage: { type: 'boolean', description: 'Delete the message' },
            stopEvaluatingRules: { type: 'boolean', description: 'Stop evaluating further rules' }
        },
        required: ['name']
    },
    handler: (args) => {
        const app = Mail.app;

        // Build rule properties
        const props = {
            name: args.name,
            enabled: args.enabled !== false,
            allConditionsMustBeMet: args.allConditionsMustBeMet !== false
        };

        // Add action properties
        if (args.markRead !== undefined) props.markRead = args.markRead;
        if (args.markFlagged !== undefined) props.markFlagged = args.markFlagged;
        if (args.deleteMessage !== undefined) props.deleteMessage = args.deleteMessage;
        if (args.stopEvaluatingRules !== undefined) props.stopEvaluatingRules = args.stopEvaluatingRules;

        // Create the rule
        const rule = app.make({ new: 'rule', withProperties: props });

        // Set mailbox actions (need to find mailbox objects)
        if (args.moveMessage) {
            const mb = Mail.findMailboxByName(null, args.moveMessage);
            if (mb) rule.moveMessage = mb._jxa;
        }
        if (args.copyMessage) {
            const mb = Mail.findMailboxByName(null, args.copyMessage);
            if (mb) rule.copyMessage = mb._jxa;
        }

        // Add conditions
        if (args.conditions && args.conditions.length > 0) {
            for (const cond of args.conditions) {
                app.make({
                    new: 'ruleCondition',
                    at: rule.ruleConditions.end,
                    withProperties: {
                        ruleType: cond.ruleType || 'from header',
                        qualifier: cond.qualifier || 'does contain value',
                        expression: cond.expression || ''
                    }
                });
            }
        }

        return JSON.stringify({ created: true, name: args.name }, null, 2);
    }
});

server.addTool({
    name: 'update_rule',
    description: 'Update an existing mail rule',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Current rule name' },
            newName: { type: 'string', description: 'New name (optional)' },
            enabled: { type: 'boolean', description: 'Enable/disable rule' }
        },
        required: ['name']
    },
    handler: (args) => {
        const app = Mail.app;
        // Find rule by iterating (byName can be unreliable)
        let rule = null;
        for (const r of app.rules()) {
            try {
                if (r.name() === args.name) {
                    rule = r;
                    break;
                }
            } catch (e) { /* skip invalid refs */ }
        }
        if (!rule) return server.error(`Rule not found: ${args.name}`);

        // If renaming, do that first then get a fresh reference
        const finalName = args.newName || args.name;
        if (args.newName !== undefined) {
            rule.name = args.newName;
            // Re-fetch by new name since old reference is now invalid
            rule = null;
            for (const r of app.rules()) {
                try {
                    if (r.name() === args.newName) {
                        rule = r;
                        break;
                    }
                } catch (e) { /* skip */ }
            }
            if (!rule) return server.error(`Rename succeeded but couldn't re-fetch: ${args.newName}`);
        }

        // Now set other properties on the valid reference
        if (args.enabled !== undefined) rule.enabled = args.enabled;

        return JSON.stringify({ updated: true, name: finalName }, null, 2);
    }
});

server.addTool({
    name: 'delete_rule',
    description: 'Delete a mail rule',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Rule name to delete' }
        },
        required: ['name']
    },
    handler: (args) => {
        const app = Mail.app;
        // Find rule by iterating (byName can be unreliable)
        let rule = null;
        for (const r of app.rules()) {
            try {
                if (r.name() === args.name) {
                    rule = r;
                    break;
                }
            } catch (e) { /* skip invalid refs */ }
        }
        if (!rule) return server.error(`Rule not found: ${args.name}`);

        try {
            app.delete(rule);
            return JSON.stringify({ deleted: true, name: args.name }, null, 2);
        } catch (e) {
            return server.error(`Could not delete rule: ${e.message}`);
        }
    }
});

// === Signature CRUD ===

server.addTool({
    name: 'create_signature',
    description: 'Create a new email signature',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Signature name' },
            content: { type: 'string', description: 'Signature content (plain text)' }
        },
        required: ['name', 'content']
    },
    handler: (args) => {
        const app = Mail.app;
        app.make({
            new: 'signature',
            withProperties: { name: args.name, content: args.content }
        });
        return JSON.stringify({ created: true, name: args.name }, null, 2);
    }
});

server.addTool({
    name: 'update_signature',
    description: 'Update an existing email signature',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Current signature name' },
            newName: { type: 'string', description: 'New name (optional)' },
            content: { type: 'string', description: 'New content (optional)' }
        },
        required: ['name']
    },
    handler: (args) => {
        const app = Mail.app;
        // Find signature by iterating (byName can be unreliable)
        let sig = null;
        for (const s of app.signatures()) {
            try {
                if (s.name() === args.name) {
                    sig = s;
                    break;
                }
            } catch (e) { /* skip invalid refs */ }
        }
        if (!sig) return server.error(`Signature not found: ${args.name}`);

        // If renaming, do that first then get a fresh reference
        const finalName = args.newName || args.name;
        if (args.newName !== undefined) {
            sig.name = args.newName;
            // Re-fetch by new name since old reference is now invalid
            sig = null;
            for (const s of app.signatures()) {
                try {
                    if (s.name() === args.newName) {
                        sig = s;
                        break;
                    }
                } catch (e) { /* skip */ }
            }
            if (!sig) return server.error(`Rename succeeded but couldn't re-fetch: ${args.newName}`);
        }

        // Now set other properties on the valid reference
        if (args.content !== undefined) sig.content = args.content;

        return JSON.stringify({ updated: true, name: finalName }, null, 2);
    }
});

server.addTool({
    name: 'delete_signature',
    description: 'Delete an email signature',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Signature name to delete' }
        },
        required: ['name']
    },
    handler: (args) => {
        const app = Mail.app;
        // Find signature by iterating (byName can be unreliable)
        let sig = null;
        for (const s of app.signatures()) {
            try {
                if (s.name() === args.name) {
                    sig = s;
                    break;
                }
            } catch (e) { /* skip invalid refs */ }
        }
        if (!sig) return server.error(`Signature not found: ${args.name}`);

        try {
            app.delete(sig);
            return JSON.stringify({ deleted: true, name: args.name }, null, 2);
        } catch (e) {
            return server.error(`Could not delete signature: ${e.message}`);
        }
    }
});





















































// === src/main.js (lines 2801-3200) ===
// Entry point - start the MCP server

server.run();












































































































































































































































































































































































































