/// <reference path="jxa.d.ts" />

// ============================================================================
// MCP Protocol Types
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

interface McpServerInfo {
  name: string;
  version: string;
}

interface McpCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolHandler {
  (args: Record<string, unknown>): McpToolResult;
}

interface McpToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

class MCPServer {
  private serverInfo: McpServerInfo;
  private tools: Map<string, { tool: McpTool; handler: McpToolHandler }>;
  private stdin: NSFileHandle;
  private stdout: NSFileHandle;
  private stderr: NSFileHandle;
  private buffer: string;
  private shouldQuit: boolean;
  private dataAvailable: boolean;
  private observer: any;

  constructor(name: string, version: string) {
    this.serverInfo = { name, version };
    this.tools = new Map();
    this.buffer = "";
    this.shouldQuit = false;
    this.dataAvailable = false;

    // Import Foundation framework
    ObjC.import("Foundation");

    // Get standard file handles
    this.stdin = $.NSFileHandle.fileHandleWithStandardInput;
    this.stdout = $.NSFileHandle.fileHandleWithStandardOutput;
    this.stderr = $.NSFileHandle.fileHandleWithStandardError;
  }

  addTool(
    name: string,
    description: string,
    inputSchema: McpTool["inputSchema"],
    handler: McpToolHandler
  ): void {
    this.tools.set(name, {
      tool: { name, description, inputSchema },
      handler,
    });
  }

  private log(message: string): void {
    const data = $.NSString.stringWithString(message + "\n").dataUsingEncoding(
      $.NSUTF8StringEncoding
    );
    this.stderr.writeData(data);
  }

  private send(response: JsonRpcResponse): void {
    const json = JSON.stringify(response) + "\n";
    const data = $.NSString.stringWithString(json).dataUsingEncoding(
      $.NSUTF8StringEncoding
    );
    this.stdout.writeData(data);
  }

  private handleInitialize(
    id: number | string,
    _params: Record<string, unknown>
  ): void {
    this.send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: this.serverInfo,
        capabilities: {
          tools: {},
        },
      },
    });
  }

  private handleToolsList(id: number | string): void {
    const tools: McpTool[] = [];
    this.tools.forEach(({ tool }) => tools.push(tool));
    this.send({
      jsonrpc: "2.0",
      id,
      result: { tools },
    });
  }

  private handleToolsCall(
    id: number | string,
    params: Record<string, unknown>
  ): void {
    const name = params.name as string;
    const args = (params.arguments as Record<string, unknown>) ?? {};

    const entry = this.tools.get(name);
    if (!entry) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: `Unknown tool: ${name}`,
        },
      });
      return;
    }

    try {
      const result = entry.handler(args);
      this.send({
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (e) {
      const error = e as Error;
      this.send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        },
      });
    }
  }

  private handleRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case "initialize":
        this.handleInitialize(request.id, request.params ?? {});
        break;

      case "initialized":
        // Notification, no response needed
        break;

      case "tools/list":
        this.handleToolsList(request.id);
        break;

      case "tools/call":
        this.handleToolsCall(request.id, request.params ?? {});
        break;

      default:
        if (request.id !== undefined) {
          this.send({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          });
        }
    }
  }

  private processBuffer(): void {
    // Split on newlines
    const lines = this.buffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer
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
      }
    }
  }

  run(): void {
    this.log(`${this.serverInfo.name} v${this.serverInfo.version} starting...`);

    // Register Objective-C subclass for notification handling
    // Use unique name to avoid conflicts if run multiple times
    const observerClassName = `StdinObserver_${Date.now()}`;
    ObjC.registerSubclass({
      name: observerClassName,
      methods: {
        "handleData:": {
          types: ["void", ["id"]],
          implementation: (_notification: any) => {
            this.dataAvailable = true;
          },
        },
      },
    });

    // Access the registered class via the $ bridge
    this.observer = $[observerClassName].alloc.init;

    // Register for stdin data notifications
    // Note: selector is just a string matching the method name
    $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
      this.observer,
      "handleData:",
      "NSFileHandleDataAvailableNotification",
      this.stdin
    );

    // Start listening (this is a property getter in JXA, not a method call)
    void this.stdin.waitForDataInBackgroundAndNotify;

    // Main run loop
    while (!this.shouldQuit) {
      // Wait for events (1 second timeout)
      $.NSRunLoop.currentRunLoop.runUntilDate(
        $.NSDate.dateWithTimeIntervalSinceNow(1.0)
      );

      // Check for available data
      if (this.dataAvailable) {
        this.dataAvailable = false;

        const data = this.stdin.availableData;
        if (data.length === 0) {
          // EOF - stdin closed
          this.shouldQuit = true;
          break;
        }

        const nsString = $.NSString.alloc.initWithDataEncoding(
          data,
          $.NSUTF8StringEncoding
        );
        if (nsString) {
          this.buffer += ObjC.unwrap<string>(nsString);
          this.processBuffer();
        }

        // Re-register for next notification
        void this.stdin.waitForDataInBackgroundAndNotify;
      }
    }

    // Cleanup
    $.NSNotificationCenter.defaultCenter.removeObserver(this.observer);
    this.log("Server shutting down");
  }
}
