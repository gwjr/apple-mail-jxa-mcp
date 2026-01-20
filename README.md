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

### Claude Desktop (auto-rebuild on connect)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "make",
      "args": ["-C", "/path/to/apple-mail-jxa-mcp", "-s", "run"]
    }
  }
}
```

This automatically rebuilds from source if any files changed, then runs the server.

### Claude Desktop (pre-built)

If you prefer not to require `make`:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "osascript",
      "args": ["-l", "JavaScript", "/path/to/apple-mail-jxa-mcp/dist/mail.js"]
    }
  }
}
```

Run `make` once to generate `dist/mail.js`.

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "make",
      "args": ["-C", "/path/to/apple-mail-jxa-mcp", "-s", "run"]
    }
  }
}
```

## Requirements

- macOS (tested on macOS 15)
- Mail.app configured with at least one account
- Automation permissions for the MCP client to control Mail

## Project Structure

```
src/
  framework.js      # MCP protocol handler, NSRunLoop I/O
  cache.js          # SQLite message location cache
  facades.js        # Mailbox/Message wrapper objects
  mail.js           # Mail.app singleton interface
  resources.js      # MCP resource handlers
  tools-messages.js # Message operation tools
  tools-crud.js     # Attachment/rule/signature tools
  main.js           # Entry point

dist/
  mail.js           # Concatenated output (built by make)

Makefile            # Build system
```

Source files are concatenated with 400-line padding for debuggable line numbers:
- Error at line 1847 → file index 4 (1847÷400), line 247 in that file (1847%400)
- Run `make check` to see the mapping

## Building

```bash
make          # Build dist/mail.js
make run      # Build and run
make clean    # Remove dist/
make check    # Show line number mapping
```

## Usage Examples

Once configured, you can ask Claude things like:

- "Show me my unread emails"
- "Find emails from [sender] in the last week"
- "Move that email to my Archive folder"
- "Create a rule to mark emails from [sender] as read"
- "What signatures do I have configured?"

## Testing

Run the test suite (requires Node.js):

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
- SQLite cache for fast message lookups

## License

MIT
