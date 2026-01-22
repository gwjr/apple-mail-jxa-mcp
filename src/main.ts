/// <reference path="types/jxa.d.ts" />
/// <reference path="types/mcp.d.ts" />
/// <reference path="core/mcp-server.ts" />
/// <reference path="framework/delegate.ts" />
/// <reference path="framework/filter-query.ts" />
/// <reference path="framework/schematic.ts" />
/// <reference path="framework/res.ts" />
/// <reference path="framework/uri.ts" />
/// <reference path="jxa-delegate.ts" />
/// <reference path="mail.ts" />
/// <reference path="resources.ts" />
/// <reference path="tools.ts" />

// ============================================================================
// Apple Mail MCP Server - Entry Point
// ============================================================================

const server = new MCPServer("apple-mail-jxa", "1.0.0");

// Register resource handlers
server.setResources(listResources, readResource);
server.setResourceTemplates(resourceTemplates);

// Register tools
registerMailTools(server);

// Start the server (unless loaded as a library)
if (!(globalThis as any).__LIBRARY_MODE__) {
  server.run();
}
