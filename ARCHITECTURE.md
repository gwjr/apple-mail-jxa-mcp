# Apple Mail MCP: Resource-First Architecture

## Key Insight

Two different URL schemes for two different purposes:

1. **`message://` URLs** (Apple's scheme)
   - Systemwide, handled by Mail.app
   - Can be opened to show the user the message
   - Include in output for user convenience
   - **NOT used for our MCP operations** (too slow to resolve)

2. **`mail://` URIs** (our scheme)
   - Internal resource identifiers for MCP operations
   - Uses Mail.app's internal message ID (from `message.id()`)
   - More stable than array index, but still fragile (message can move/delete)
   - Fast lookup via `messages.byId(id)` in JXA

## Unified Resource Tree

All resources live under the `mail://` scheme, forming a discoverable hierarchy:

```
mail://properties                                    → app settings
mail://rules                                         → mail rules list
mail://rules/{index}                                 → individual rule
mail://signatures                                    → signatures list
mail://signatures/{name}                             → individual signature

mail://accounts                                      → list all accounts
mail://accounts/{account}                            → account info
mail://accounts/{account}/mailboxes                  → list top-level mailboxes

# Recursive mailbox structure:
mail://accounts/{account}/mailboxes/{name}           → mailbox info
mail://accounts/{account}/mailboxes/{name}/messages  → message listing
mail://accounts/{account}/mailboxes/{name}/messages?limit=20&offset=40
mail://accounts/{account}/mailboxes/{name}/messages?unread=true
mail://accounts/{account}/mailboxes/{name}/messages/{id}              → full message
mail://accounts/{account}/mailboxes/{name}/messages/{id}/attachments  → attachment list
mail://accounts/{account}/mailboxes/{name}/mailboxes                  → child mailboxes

# Nested mailboxes follow the same pattern:
mail://accounts/Google/mailboxes/INBOX/mailboxes/Work/mailboxes/Projects/messages
                                       ^^^^^^^^^ ^^^^ ^^^^^^^^^ ^^^^^^^^
                                       /mailboxes at each level for children
```

**Key insight**: `/mailboxes` and `/messages` are available at any level.
- `/mailboxes` → list child mailboxes
- `/messages` → list messages in this mailbox

Clean, RESTful, recursively discoverable from root.

## Example Responses

### Accounts List
`GET mail://accounts`
```json
{
  "accounts": [
    {
      "name": "Google",
      "uri": "mail://accounts/Google",
      "mailboxes": "mail://accounts/Google/mailboxes"
    },
    {
      "name": "iCloud",
      "uri": "mail://accounts/iCloud",
      "mailboxes": "mail://accounts/iCloud/mailboxes"
    }
  ]
}
```

### Account Info
`GET mail://accounts/Google`
```json
{
  "name": "Google",
  "emailAddresses": ["user@gmail.com"],
  "mailboxes": "mail://accounts/Google/mailboxes"
}
```

### Top-Level Mailboxes
`GET mail://accounts/Google/mailboxes`
```json
{
  "account": "mail://accounts/Google",
  "mailboxes": [
    {
      "name": "INBOX",
      "uri": "mail://accounts/Google/mailboxes/INBOX",
      "unreadCount": 5,
      "messages": "mail://accounts/Google/mailboxes/INBOX/messages",
      "mailboxes": "mail://accounts/Google/mailboxes/INBOX/mailboxes"
    },
    {
      "name": "Sent",
      "uri": "mail://accounts/Google/mailboxes/Sent",
      "unreadCount": 0,
      "messages": "mail://accounts/Google/mailboxes/Sent/messages",
      "mailboxes": "mail://accounts/Google/mailboxes/Sent/mailboxes"
    }
  ]
}
```

### Mailbox Info
`GET mail://accounts/Google/mailboxes/INBOX`
```json
{
  "name": "INBOX",
  "unreadCount": 5,
  "messages": "mail://accounts/Google/mailboxes/INBOX/messages",
  "mailboxes": "mail://accounts/Google/mailboxes/INBOX/mailboxes"
}
```

### Message Listing
`GET mail://accounts/Google/mailboxes/INBOX/messages?limit=20`
```json
{
  "mailbox": "mail://accounts/Google/mailboxes/INBOX",
  "messages": [
    {
      "id": 173672,
      "uri": "mail://accounts/Google/mailboxes/INBOX/messages/173672",
      "subject": "Hello",
      "sender": "alice@example.com",
      "dateReceived": "2024-01-15T10:30:00Z",
      "read": false,
      "flagged": true,
      "messageUrl": "message://<abc123@mail.gmail.com>"
    }
  ]
}
```

### Full Message
`GET mail://accounts/Google/mailboxes/INBOX/messages/173672`
```json
{
  "id": 173672,
  "uri": "mail://accounts/Google/mailboxes/INBOX/messages/173672",
  "subject": "Hello",
  "sender": "alice@example.com",
  "dateReceived": "2024-01-15T10:30:00Z",
  "content": "...",
  "toRecipients": [...],
  "ccRecipients": [...],
  "attachments": "mail://accounts/Google/mailboxes/INBOX/messages/173672/attachments",
  "messageUrl": "message://<abc123@mail.gmail.com>"
}
```

### Child Mailboxes
`GET mail://accounts/Google/mailboxes/INBOX/mailboxes`
```json
{
  "parent": "mail://accounts/Google/mailboxes/INBOX",
  "mailboxes": [
    {
      "name": "Work",
      "uri": "mail://accounts/Google/mailboxes/INBOX/mailboxes/Work",
      "unreadCount": 2,
      "messages": "mail://accounts/Google/mailboxes/INBOX/mailboxes/Work/messages",
      "mailboxes": "mail://accounts/Google/mailboxes/INBOX/mailboxes/Work/mailboxes"
    }
  ]
}
```

### Attachments List
`GET mail://accounts/Google/mailboxes/INBOX/messages/173672/attachments`
```json
{
  "message": "mail://accounts/Google/mailboxes/INBOX/messages/173672",
  "attachments": [
    {
      "index": 0,
      "name": "document.pdf",
      "mimeType": "application/pdf",
      "fileSize": 102400,
      "downloaded": true
    }
  ]
}
```

## URI Fields

Every resource that references messages includes two URL fields:

- **`uri`** - Our MCP resource URI (fragile - may become stale if message moves/deletes)
- **`messageUrl`** - Apple's `message://` URL for user to click/open in Mail.app

## Implementation Phases

### Phase 0: Document Architecture (This Document)

### Phase 1: Resource-Only

1. Comment out all tools in `tools-messages.js` and `tools-crud.js`
2. Comment out tool tests in `test-mail.js`
3. Refactor resources to unified `mail://` tree
4. Remove old schemes (`mailaccount://`, `mailbox://`, `unified://`)
5. Remove `messageFromUrl()` - no longer needed
6. Update tests for new resource hierarchy

### Phase 2: Add Tools Back

Tools will use `mail://` resource URIs:
- `mark_read(uri)`
- `move_message(uri, destMailbox)`
- `delete_message(uri)`
- `compose_email(...)` (doesn't need message reference)

## Files to Modify

| File | Changes |
|------|---------|
| `src/tools-messages.js` | Comment out all tools |
| `src/tools-crud.js` | Comment out all tools |
| `src/resources.js` | Refactor to unified recursive `mail://` tree |
| `src/mail.js` | Remove `messageFromUrl()` |
| `src/facades.js` | Add `id` to message props, include both `uri` and `messageUrl` |
| `test-mail.js` | Comment out tool tests, add new resource hierarchy tests |

## Design Decisions

- **Unified `mail://` tree**: Single scheme, everything discoverable from root
- **Recursive `/mailboxes`**: Child mailboxes at any level via `/mailboxes`
- **ID-based messages**: Uses Mail.app's internal ID, lookup via `messages.byId()`
- **`uri` field**: Our resource URI, fragile (may become stale)
- **`messageUrl` field**: Apple's `message://` URL for user to open in Mail.app
- **Resources first**: Get the read model right before adding write operations
