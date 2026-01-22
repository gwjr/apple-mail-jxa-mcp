/// <reference path="../types/jxa.d.ts" />
/// <reference path="../types/mcp.d.ts" />

// ============================================================================
// MCP Server Implementation with Resources Support
// JSON-RPC 2.0 over stdio with NSRunLoop-based I/O
// ============================================================================

// Standard JSON-RPC error codes
const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  RESOURCE_NOT_FOUND: -32002,
  SERVER_ERROR: -32000
} as const;

class MCPServer {
  private serverInfo: McpServerInfo;
  private tools: Map<string, { tool: McpTool; handler: McpToolHandler }>;
  private resourceLister: ResourceLister | null;
  private resourceReader: ResourceReader | null;
  private resourceTemplates: McpResourceTemplate[];
  private stdin: NSFileHandle;
  private stdout: NSFileHandle;
  private stderr: NSFileHandle;
  private buffer: string;
  private shouldQuit: boolean;
  private dataAvailable: boolean;
  private observer: any;
  private debug: boolean;

  constructor(name: string, version: string, debug: boolean = true) {
    this.serverInfo = { name, version };
    this.tools = new Map();
    this.resourceLister = null;
    this.resourceReader = null;
    this.resourceTemplates = [];
    this.buffer = "";
    this.shouldQuit = false;
    this.dataAvailable = false;
    this.debug = debug;

    // Import Foundation framework
    ObjC.import("Foundation");

    // Get standard file handles
    this.stdin = $.NSFileHandle.fileHandleWithStandardInput;
    this.stdout = $.NSFileHandle.fileHandleWithStandardOutput;
    this.stderr = $.NSFileHandle.fileHandleWithStandardError;
  }

  // ============================================================================
  // Tool Registration
  // ============================================================================

  addTool(definition: ToolDefinition): this {
    const tool: McpTool = {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema ?? { type: "object", properties: {}, required: [] }
    };
    if (definition.annotations) {
      tool.annotations = definition.annotations;
    }
    this.tools.set(definition.name, { tool, handler: definition.handler });
    return this;
  }

  // ============================================================================
  // Resource Registration
  // ============================================================================

  setResources(lister: ResourceLister, reader: ResourceReader): this {
    this.resourceLister = lister;
    this.resourceReader = reader;
    return this;
  }

  setResourceTemplates(templates: McpResourceTemplate[]): this {
    this.resourceTemplates = templates;
    return this;
  }

  // ============================================================================
  // I/O Helpers
  // ============================================================================

  private log(message: string): void {
    if (!this.debug) return;
    const fullMessage = `[${this.serverInfo.name}] ${message}\n`;
    const data = $.NSString.alloc.initWithUTF8String(fullMessage)
      .dataUsingEncoding($.NSUTF8StringEncoding);
    this.stderr.writeData(data);
  }

  private send(response: JsonRpcResponse): void {
    const json = JSON.stringify(response) + "\n";
    const data = $.NSString.alloc.initWithUTF8String(json)
      .dataUsingEncoding($.NSUTF8StringEncoding);
    this.stdout.writeData(data);
  }

  private sendResult(id: number | string, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private sendError(id: number | string | null, code: number, message: string): void {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private sendToolResult(id: number | string, text: string, isError: boolean = false): void {
    this.sendResult(id, {
      content: [{ type: "text", text: String(text) }],
      isError
    });
  }

  // ============================================================================
  // Request Handlers
  // ============================================================================

  private handleInitialize(id: number | string, params: Record<string, unknown>): void {
    const clientName = (params.clientInfo as { name?: string })?.name ?? 'unknown';
    this.log(`Initialize from: ${clientName}`);

    const capabilities: McpCapabilities = {};
    if (this.tools.size > 0) {
      capabilities.tools = {};
    }
    if (this.resourceLister) {
      capabilities.resources = {};
    }

    this.sendResult(id, {
      protocolVersion: "2024-11-05",
      serverInfo: this.serverInfo,
      capabilities
    });
  }

  private handleToolsList(id: number | string): void {
    const tools: McpTool[] = [];
    this.tools.forEach(({ tool }) => tools.push(tool));
    this.log(`Tools list (${tools.length})`);
    this.sendResult(id, { tools });
  }

  private handleToolsCall(id: number | string, params: Record<string, unknown>): void {
    const name = params.name as string;
    const args = (params.arguments as Record<string, unknown>) ?? {};
    this.log(`Call: ${name}`);

    const entry = this.tools.get(name);
    if (!entry) {
      this.sendError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
      return;
    }

    try {
      const result = entry.handler(args);
      this.sendResult(id, result);
    } catch (e) {
      const error = e as Error;
      this.sendToolResult(id, `Error: ${error.message}`, true);
    }
  }

  private handleResourcesList(id: number | string): void {
    this.log("Resources list");
    if (!this.resourceLister) {
      this.sendResult(id, { resources: [] });
      return;
    }

    try {
      const resources = this.resourceLister();
      this.sendResult(id, { resources });
    } catch (e) {
      const error = e as Error;
      this.sendError(id, JsonRpcErrorCodes.SERVER_ERROR, `Resource list error: ${error.message}`);
    }
  }

  private handleResourcesRead(id: number | string, params: Record<string, unknown>): void {
    const uriString = params.uri as string;
    this.log(`Resource read: ${uriString}`);

    if (!this.resourceReader) {
      this.sendError(id, JsonRpcErrorCodes.METHOD_NOT_FOUND, "Resources not supported");
      return;
    }

    // Parse URI string to URL early for type safety
    let uri: URL;
    try {
      uri = new URL(uriString);
    } catch (e) {
      this.sendError(id, JsonRpcErrorCodes.INVALID_PARAMS, `Invalid URI: ${uriString}`);
      return;
    }

    try {
      const readResult = this.resourceReader(uri);

      // Handle Result<T> type from readResource
      if (!readResult.ok) {
        this.sendError(id, JsonRpcErrorCodes.RESOURCE_NOT_FOUND, readResult.error);
        return;
      }

      const textContent = typeof readResult.text === 'string'
        ? readResult.text
        : JSON.stringify(readResult.text);

      const response = {
        contents: [{
          uri: uriString,
          mimeType: readResult.mimeType || 'application/json',
          text: textContent
        }]
      };
      this.sendResult(id, response);
    } catch (e) {
      const error = e as Error;
      this.sendError(id, JsonRpcErrorCodes.SERVER_ERROR, `Resource read error: ${error.message}`);
    }
  }

  private handleResourceTemplatesList(id: number | string): void {
    this.log("Resource templates list");
    this.sendResult(id, { resourceTemplates: this.resourceTemplates });
  }

  // ============================================================================
  // Request Dispatch
  // ============================================================================

  private handleRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case "initialize":
        this.handleInitialize(request.id, request.params ?? {});
        break;

      case "initialized":
      case "notifications/initialized":
        this.log("Client initialized");
        break;

      case "tools/list":
        this.handleToolsList(request.id);
        break;

      case "tools/call":
        this.handleToolsCall(request.id, request.params ?? {});
        break;

      case "resources/list":
        this.handleResourcesList(request.id);
        break;

      case "resources/read":
        this.handleResourcesRead(request.id, request.params ?? {});
        break;

      case "resources/templates/list":
        this.handleResourceTemplatesList(request.id);
        break;

      default:
        // Only send error for requests (with id), not notifications
        if (request.id !== undefined && !request.method?.startsWith('notifications/')) {
          this.sendError(request.id, JsonRpcErrorCodes.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
        }
    }
  }

  // ============================================================================
  // Buffer Processing
  // ============================================================================

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        this.handleRequest(request);
      } catch (e) {
        const error = e as Error;
        this.log(`Parse error: ${error.message}`);
        this.sendError(null, JsonRpcErrorCodes.PARSE_ERROR, "Parse error");
      }
    }
  }

  // ============================================================================
  // Main Run Loop
  // ============================================================================

  run(): void {
    this.log(`${this.serverInfo.name} v${this.serverInfo.version} starting...`);

    // Register Objective-C subclass for notification handling
    const observerClassName = `StdinObserver_${Date.now()}`;
    ObjC.registerSubclass({
      name: observerClassName,
      methods: {
        "handleData:": {
          types: ["void", ["id"]],
          implementation: (_notification: any) => {
            this.dataAvailable = true;
          }
        }
      }
    });

    // Access the registered class via the $ bridge
    this.observer = $[observerClassName].alloc.init;

    // Register for stdin data notifications
    $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
      this.observer,
      "handleData:",
      "NSFileHandleDataAvailableNotification",
      this.stdin
    );

    // Start listening
    void this.stdin.waitForDataInBackgroundAndNotify;

    // Main run loop
    while (!this.shouldQuit) {
      $.NSRunLoop.currentRunLoop.runUntilDate(
        $.NSDate.dateWithTimeIntervalSinceNow(1.0)
      );

      if (this.dataAvailable) {
        this.dataAvailable = false;

        const data = this.stdin.availableData;
        if (data.length === 0) {
          this.shouldQuit = true;
          break;
        }

        const nsString = $.NSString.alloc.initWithDataEncoding(
          data,
          $.NSUTF8StringEncoding
        );
        if (nsString) {
          this.buffer += nsString.js;
          this.processBuffer();
        }

        void this.stdin.waitForDataInBackgroundAndNotify;
      }
    }

    // Cleanup
    $.NSNotificationCenter.defaultCenter.removeObserverNameObject(
      this.observer,
      "NSFileHandleDataAvailableNotification",
      this.stdin
    );
    this.log("Server shutting down");
  }
}
