/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mail-app.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/uri-router.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="mail/cache.ts" />
/// <reference path="mail/collections.ts" />
/// <reference path="mail/message.ts" />
/// <reference path="mail/mailbox.ts" />
/// <reference path="mail/account.ts" />
/// <reference path="mail/app.ts" />
/// <reference path="resources/properties.ts" />
/// <reference path="resources/rules.ts" />
/// <reference path="resources/signatures.ts" />
/// <reference path="resources/accounts.ts" />
/// <reference path="resources/mailboxes.ts" />
/// <reference path="resources/messages.ts" />
/// <reference path="resources/index.ts" />

// ============================================================================
// Apple Mail MCP Server - Entry Point
// Phase 1: Resources-only implementation
// ============================================================================

const server = new MCPServer("apple-mail-jxa", "1.0.0");

// Register resource handlers
server.setResources(listResources, readResource);
server.setResourceTemplates(resourceTemplates);

// Start the server
server.run();
