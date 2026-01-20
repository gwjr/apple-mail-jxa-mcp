/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mail-app.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="framework.ts" />
/// <reference path="mail.ts" />
/// <reference path="resources.ts" />

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
