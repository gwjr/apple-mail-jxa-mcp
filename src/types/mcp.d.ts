/// <reference path="jxa.d.ts" />

// ============================================================================
// MCP Protocol Types
// JSON-RPC 2.0 based protocol for Model Context Protocol
// ============================================================================

// ============================================================================
// JSON-RPC 2.0
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes (declared only, defined in mcp-server.ts)

// ============================================================================
// MCP Server Info
// ============================================================================

interface McpServerInfo {
  name: string;
  version: string;
}

interface McpCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
}

interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: McpCapabilities;
}

// ============================================================================
// MCP Tools
// ============================================================================

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: McpToolAnnotations;
}

interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface McpToolHandler {
  (args: Record<string, unknown>): McpToolResult;
}

interface McpToolResult {
  content: Array<McpTextContent>;
  isError?: boolean;
}

interface McpTextContent {
  type: "text";
  text: string;
}

// ============================================================================
// MCP Resources
// ============================================================================

interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

interface McpResourcesListResult {
  resources: McpResource[];
}

interface McpResourcesReadResult {
  contents: McpResourceContent[];
}

interface McpResourceTemplatesListResult {
  resourceTemplates: McpResourceTemplate[];
}

// Resource handler types
type ResourceLister = () => McpResource[];
type ReadResourceResult =
  | { ok: true; mimeType: string; text: string | object; fixedUri?: URL }
  | { ok: false; error: string };
type ResourceReader = (uri: URL) => ReadResourceResult;

// ============================================================================
// Tool definition helper type
// ============================================================================

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: McpToolAnnotations;
  handler: McpToolHandler;
}
