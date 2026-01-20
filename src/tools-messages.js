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
