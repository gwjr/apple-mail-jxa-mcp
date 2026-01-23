# Apple Mail JXA MCP Server

## Tool Permissions

Allow: mcp__apple-mail__*

## TypeScript Configuration

This project uses bundled TypeScript (all files concatenated into one output). There are two main configs:

- **`tsconfig.json`** - LSP/editor config with `include` patterns so language servers can see all files
- **`tsconfig.build.json`** - Actual build config with explicit `files` list for correct concatenation order

The build uses `npm run build` which invokes `tsc -p tsconfig.build.json`.

## Testing

Two test suites run against mock data (no Mail.app required):

### Node Tests (`npm run test:node`)
- **Config**: `tsconfig.test-node.json`
- **Output**: `tests/framework.test.js`
- **Sources**: framework.ts, mock-delegate.ts, mail.ts, resources.ts, test-*.ts
- **Runs in**: Node.js

Tests core framework: URI parsing, resolution, Res proxy, query operations, pagination.

### JXA Tests (`npm run test:jxa`)
- **Config**: `tsconfig.test-jxa.json`
- **Output**: `tests/framework.jxa.test.js`
- **Runs in**: osascript (real JXA environment)

Tests JXA-specific behavior with mock delegate (not against real Mail.app).

### Run Both
```bash
npm test  # runs test:node then test:jxa
```

### Test Structure
- `tests/src/test-utils.ts` - Assertion helpers (assert, assertEqual, assertOk, etc.)
- `tests/src/test-framework.ts` - Core framework tests (Node)
- `tests/src/test-framework-jxa.ts` - JXA environment tests
- `tests/src/test-operations.ts` - Mutation operation tests

### Mock Data
Tests use `createMockMailData()` which returns in-memory Mail.app-like data structure.
`MockDelegate` navigates this data the same way `JXADelegate` navigates real JXA objects.

### Adding Tests
1. Add test function in appropriate test file
2. Call it from the test runner section at the bottom
3. If testing new sources, add them to the relevant tsconfig.test-*.json
