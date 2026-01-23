# Apple Mail JXA MCP Server

An MCP (Model Context Protocol) server for Apple Mail, built in pure JXA (JavaScript for Automation).

## Why JXA?

Most MCP servers for Mac apps use Node.js spawning `osascript` subprocesses for each command. This approach suffers from:
- Process spawning overhead
- JSON encoding/escaping bugs between Node and AppleScript
- Complexity managing async callbacks

This server runs as a single JXA process with proper NSRunLoop blocking - no Node.js, no subprocess spawning, native JSON handling.

## Features

### Tools (4)

Generic tools that operate on any `mail://` URI:

| Tool | Description |
|------|-------------|
| `set` | Set a scalar property value (e.g., `mail://rules[0]/enabled`) |
| `make` | Create a new object in a collection (e.g., new rule, signature) |
| `move` | Move an object to a different collection (e.g., message to mailbox) |
| `delete` | Delete an object (messages move to trash, mailbox deletion blocked) |

### Resources

Browse Mail.app data via `mail://` URIs:

| Resource | Description |
|----------|-------------|
| `mail://inbox` | Combined inbox from all accounts |
| `mail://sent` | Combined sent from all accounts |
| `mail://drafts` | Combined drafts from all accounts |
| `mail://trash` | Combined trash from all accounts |
| `mail://junk` | Combined junk/spam from all accounts |
| `mail://outbox` | Messages waiting to be sent |
| `mail://accounts` | Mail accounts |
| `mail://rules` | Mail filtering rules |
| `mail://signatures` | Email signatures |
| `mail://settings` | Mail.app preferences |

### URI Addressing

Navigate the schema using path segments:

```
mail://accounts[0]                    # First account (by index)
mail://accounts/iCloud                # Account by name
mail://accounts[0]/mailboxes/INBOX    # Mailbox by name
mail://accounts[0]/inbox/messages[0]  # First message (by index)
mail://inbox/messages/12345           # Message by ID
mail://rules/My%20Rule                # Rule by name (URL-encoded)
```

### Query Parameters

Filter, sort, and paginate collections:

```
# Filters
?readStatus=false                # Exact match
?unreadCount.gt=0               # Greater than
?messageSize.lt=1000000         # Less than
?subject.contains=urgent        # Contains substring
?name.startsWith=Project        # Starts with

# Sorting
?sort=name.asc                  # Ascending
?sort=dateReceived.desc         # Descending

# Pagination
?limit=10&offset=20             # Page through results

# Expand lazy properties
?expand=content                 # Include message body
?expand=content,attachments     # Multiple expansions

# Combined
?readStatus=false&sort=dateReceived.desc&limit=10
```

## Installation

### Build

```bash
npm install
npm run build
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Claude Code

Add to your project's `.mcp.json`:

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

## Requirements

- macOS (tested on macOS 15)
- Mail.app configured with at least one account
- Automation permissions for the MCP client to control Mail

## Project Structure

```
src/
  framework/
    delegate.ts       # Backend abstraction interface
    schematic.ts      # Proto builders (collection, lazy, computed, etc.)
    specifier.ts      # Navigation proxy connecting protos to delegates
    uri.ts            # URI parsing and resolution
    filter-query.ts   # Query parameter handling
  core/
    mcp-server.ts     # MCP protocol handler
  types/
    jxa.d.ts          # JXA type definitions
    mcp.d.ts          # MCP type definitions
  jxa-delegate.ts     # JXA backend implementation
  jxa-polyfill.ts     # URL polyfill for JXA environment
  mock-delegate.ts    # Mock backend for testing
  mail.ts             # Mail.app schema definition
  resources.ts        # MCP resource handlers
  tools.ts            # MCP tool handlers
  main.ts             # Entry point

tests/
  src/
    test-framework.ts     # Core framework tests
    test-framework-jxa.ts # JXA environment tests
    test-operations.ts    # Mutation operation tests
    test-utils.ts         # Assertion helpers

dist/
  mail.js             # Built output (TypeScript compiled + bundled)
```

## Building

```bash
npm run build         # Build dist/mail.js
npm start             # Build and run server
```

### TypeScript Configuration

This project uses bundled TypeScript (all files concatenated into one output via `outFile`):

- **`tsconfig.json`** - LSP/editor config with `include` patterns (for IDE support)
- **`tsconfig.build.json`** - Build config with explicit `files` list for correct concatenation order

The build uses `tsconfig.build.json`; the root `tsconfig.json` exists so language servers can resolve cross-file references.

## Testing

Tests run against mock data (no Mail.app required):

```bash
npm test              # Run all tests (Node + JXA)
npm run test:node     # Framework tests in Node.js
npm run test:jxa      # JXA environment tests via osascript
npm run test:integration  # MCP server integration tests
```

## Architecture

```
Claude <-> stdio <-> JXA MCP Server <-> Application('Mail')
                     (single process)
```

The framework uses a layered architecture:

1. **Proto definitions** (`mail.ts`) - Schema describing Mail.app structure using composable builders
2. **Specifier proxy** - Navigation layer that interprets proto definitions
3. **Delegate interface** - Backend abstraction (JXA for production, Mock for testing)
4. **URI resolution** - Parse `mail://` URIs into navigation paths

Key patterns:
- **Proto builders**: `collection()`, `lazy()`, `computed()`, `withSet()`, `withAlias()`
- **Swappable backends**: Same schema works with JXA or mock data
- **URI-driven API**: All operations use consistent `mail://` addressing

## Usage Examples

Once configured, you can ask Claude things like:

- "Show me my unread emails"
- "Find emails from [sender] in the last week"
- "Move that email to my Archive folder"
- "Create a rule to mark emails from [sender] as read"
- "What signatures do I have configured?"

## License

MIT
