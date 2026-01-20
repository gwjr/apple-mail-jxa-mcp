/// <reference path="jxa.d.ts" />
/// <reference path="mcp-server.ts" />

// ============================================================================
// Hello World MCP Server
// ============================================================================

const server = new MCPServer("hello-world-jxa", "1.0.0");

// Simple hello tool
server.addTool(
  "hello",
  "Says hello to someone",
  {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name to greet",
      },
    },
    required: ["name"],
  },
  (args) => {
    const name = args.name as string;
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${name}! Greetings from JXA via TypeScript.`,
        },
      ],
    };
  }
);

// Tool that demonstrates JXA capabilities
server.addTool(
  "system_info",
  "Gets basic system information using JXA",
  {
    type: "object",
    properties: {},
  },
  () => {
    const app = Application.currentApplication() as CurrentApplication;
    app.includeStandardAdditions = true;

    const hostname = app.doShellScript("hostname");
    const user = app.doShellScript("whoami");
    const date = app.doShellScript("date");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hostname,
              user,
              date,
              runtime: "JXA (JavaScript for Automation)",
              transpiled_from: "TypeScript",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool that uses modern ES features to prove they work
server.addTool(
  "es_features_demo",
  "Demonstrates modern ES features running in JXA",
  {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Input string to process",
      },
    },
  },
  (args) => {
    const input = (args.input as string | undefined) ?? "default";

    // Nullish coalescing (using args to avoid "always nullish" warning)
    const maybeNull: string | null = args.nothing as string | null;
    const value = maybeNull ?? "fallback";

    // Optional chaining
    const nested = { a: { b: { c: 42 } } };
    const deep = nested?.a?.b?.c;

    // Array methods from ES2023
    const arr = [3, 1, 4, 1, 5, 9, 2, 6];
    const sorted = arr.toSorted();
    const reversed = arr.toReversed();
    const last = arr.findLast((x: number) => x < 5);

    // Object spread
    const merged = { ...{ a: 1 }, ...{ b: 2 } };

    // Template literals
    const message = `Input was: "${input}"`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message,
              nullish_coalescing: value,
              optional_chaining: deep,
              toSorted: sorted,
              toReversed: reversed,
              findLast: last,
              spread: merged,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Start the server
server.run();
