# Apple Mail JXA MCP Server

An MCP (Model Context Protocol) server for Apple Mail, built in pure JXA (JavaScript for Automation).

## Why JXA?

Most MCP servers for Mac apps use Node.js spawning `osascript` subprocesses for each command. This approach suffers from:
- Process spawning overhead
- JSON encoding/escaping bugs between Node and AppleScript
- Complexity managing async callbacks

This server runs as a single JXA process with proper NSRunLoop blocking - no Node.js, no subprocess spawning, native JSON handling.

## Features

### Tools (19)

| Tool | Description |
|------|-------------|
| `list_messages` | List messages in a mailbox |
| `get_message` | Get full message details by URL |
| `send_email` | Create and send an email |
| `mark_read` | Mark a message as read |
| `mark_unread` | Mark a message as unread |
| `toggle_flag` | Toggle flagged status |
| `move_message` | Move message to another mailbox |
| `delete_message` | Delete a message (moves to Trash) |
| `check_mail` | Check for new mail |
| `get_selection` | Get currently selected messages in Mail.app |
| `get_windows` | Get info about open Mail windows |
| `list_attachments` | List attachments of a message |
| `save_attachment` | Save an attachment to disk |
| `create_rule` | Create a new mail rule |
| `update_rule` | Update an existing rule |
| `delete_rule` | Delete a mail rule |
| `create_signature` | Create a new signature |
| `update_signature` | Update an existing signature |
| `delete_signature` | Delete a signature |

### Resources

- **App Properties** (`mail://properties`) - Mail.app version, frontmost status, etc.
- **Rules** (`mail://rules`) - All mail filtering rules
- **Signatures** (`mail://signatures`) - All email signatures
- **Unified Mailboxes** (`unified://inbox`, `unified://sent`, etc.) - Cross-account mailboxes
- **Accounts** (`mailaccount://...`) - Hierarchical account/mailbox browsing

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "/path/to/apple-mail-jxa-mcp/mail.js",
      "args": []
    }
  }
}
```

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "/path/to/apple-mail-jxa-mcp/mail.js",
      "args": []
    }
  }
}
```

Make sure the script is executable:

```bash
chmod +x mail.js
```

## Requirements

- macOS (tested on macOS 15)
- Mail.app configured with at least one account
- Automation permissions for the MCP client to control Mail

## Usage Examples

Once configured, you can ask Claude things like:

- "Show me my unread emails"
- "Find emails from [sender] in the last week"
- "Move that email to my Archive folder"
- "Create a rule to mark emails from [sender] as read"
- "What signatures do I have configured?"

## Testing

Run the test suite:

```bash
node test-mail.js
```

The test suite validates:
- MCP protocol compliance
- Tool and resource listings
- Resource reading (properties, rules, signatures, unified mailboxes)
- CRUD operations for rules and signatures (creates and cleans up test data)

## Architecture

```
Claude <-> stdio <-> JXA MCP Server <-> Application('Mail')
                     (single process)
```

Key implementation details:
- NSRunLoop blocking for efficient I/O (0% CPU while idle)
- NSFileHandle notifications for stdin
- Native JSON.parse/stringify (no serialization layer)
- Direct JXA automation of Mail.app

## License

MIT
