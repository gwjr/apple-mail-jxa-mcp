// MCP Tools: Attachments, Rules, and Signatures CRUD
// Attachment handling with sandbox workaround
// Full CRUD for mail rules and signatures

server.addTool({
    name: 'list_attachments',
    description: 'List attachments of a message',
    annotations: { readOnlyHint: true },
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
    annotations: { openWorldHint: true },
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
    annotations: { idempotentHint: false },
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
    annotations: { idempotentHint: true },
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
    annotations: { destructiveHint: true },
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
    annotations: { idempotentHint: false },
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
    annotations: { idempotentHint: true },
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
    annotations: { destructiveHint: true },
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
