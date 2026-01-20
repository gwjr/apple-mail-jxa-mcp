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

        // Mailbox: mailbox://Account/Path with optional query params for message listing
        // Query params: ?limit=N&offset=N&unread=true
        match = uri.match(/^mailbox:\/\/([^\/]+)\/([^?]+)(\?.*)?$/);
        if (match) {
            const accountName = decodeURIComponent(match[1]);
            const mailboxPath = decodeURIComponent(match[2]);
            const queryString = match[3] || '';
            const mb = Mail.findMailbox(accountName, mailboxPath);
            if (!mb) return null;

            // Parse query parameters
            const params = {};
            if (queryString) {
                queryString.slice(1).split('&').forEach(pair => {
                    const [k, v] = pair.split('=');
                    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
                });
            }

            // If query params present OR explicit messages=true, return message listing
            const wantsMessages = queryString.length > 0 || params.messages === 'true';
            if (wantsMessages) {
                const limit = parseInt(params.limit, 10) || 20;
                const offset = parseInt(params.offset, 10) || 0;
                const unreadOnly = params.unread === 'true';

                const messages = mb.messages({ limit: limit + offset, unreadOnly });
                const slice = messages.slice(offset, offset + limit);

                return {
                    mimeType: 'application/json',
                    text: {
                        account: accountName,
                        path: mb.path,
                        unreadCount: mb.unreadCount,
                        limit: limit,
                        offset: offset,
                        messages: slice.map((m, i) => ({
                            index: offset + i,
                            messageId: m.messageId,
                            url: m.url,
                            subject: m.subject,
                            sender: m.sender,
                            dateReceived: m.dateReceived,
                            read: m.read,
                            flagged: m.flagged
                        }))
                    }
                };
            }

            // No query params: return mailbox info with children
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

// Resource templates for RFC 6570 URI template support
server.setResourceTemplates([
    {
        uriTemplate: 'mailbox://{account}/{+path}',
        name: 'Mailbox Info',
        description: 'Get mailbox info and child mailboxes'
    },
    {
        uriTemplate: 'mailbox://{account}/{+path}?limit={limit}&offset={offset}&unread={unread}',
        name: 'Mailbox Messages',
        description: 'Browse messages in a mailbox with optional filtering and pagination'
    }
]);
