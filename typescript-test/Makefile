.PHONY: all build run clean distclean install test watch

all: build

install:
	npm install

build: dist/server.js

dist/server.js: src/jxa.d.ts src/mcp-server.ts src/main.ts tsconfig.json
	@mkdir -p dist
	npx tsc

run: build
	osascript -l JavaScript dist/server.js

clean:
	rm -rf dist

distclean: clean
	rm -rf node_modules

# Watch for changes and rebuild (requires fswatch: brew install fswatch)
watch:
	@echo "Watching src/ for changes..."
	fswatch -o src | xargs -n1 -I{} make build

# Test that JXA can parse and run the compiled output
# Note: 4 = NSUTF8StringEncoding
test: build
	@echo "Testing JXA runtime..."
	@osascript -l JavaScript -e 'ObjC.import("Foundation"); "JXA works"'
	@echo "Testing compiled output parses in JXA..."
	@osascript -l JavaScript -e '\
		ObjC.import("Foundation"); \
		var content = $$.NSString.stringWithContentsOfFileEncodingError("dist/server.js", 4, null); \
		if (!content || content.isNil()) throw new Error("Failed to read file"); \
		try { new Function(ObjC.unwrap(content)); "Parse OK"; } \
		catch(e) { throw new Error("Parse failed: " + e.message); }' \
		&& echo "Compiled JS parses successfully"
	@echo "Testing MCP protocol..."
	@rm -f /tmp/mcp-test-out.txt
	@(printf 'Content-Length: 151\r\n\r\n%s' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}') \
		| osascript -l JavaScript dist/server.js > /tmp/mcp-test-out.txt 2>/dev/null & \
		PID=$$!; sleep 2; kill $$PID 2>/dev/null; wait $$PID 2>/dev/null || true
	@grep -q '"protocolVersion"' /tmp/mcp-test-out.txt && echo "MCP initialize OK" || echo "MCP initialize FAILED"
