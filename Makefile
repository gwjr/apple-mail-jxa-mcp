# Apple Mail JXA MCP Server - Build System (TypeScript)
#
# Uses TypeScript compiler with outFile to produce single JS bundle.
#
# Usage:
#   make        - Build dist/mail.js
#   make run    - Build and run (for MCP config)
#   make clean  - Remove built files
#   make test   - Run test suite

SHELL := /bin/bash

# Source files (for dependency tracking)
SOURCES := $(shell find src -name '*.ts')

# Output
DIST := dist/mail.js

.PHONY: all run clean reset test install

all: $(DIST)

$(DIST): $(SOURCES) tsconfig.json
	@mkdir -p dist
	@echo "Building $@ (TypeScript)"
	@npm run build --silent
	@echo "Built $@ ($$(wc -l < $@ | tr -d ' ') lines)"

# MCP config target: build and exec
# Use this in claude_desktop_config.json:
#   "command": "make", "args": ["-C", "/path/to/repo", "-s", "run"]
run: $(DIST)
	@exec osascript -l JavaScript $(DIST)

clean:
	rm -rf dist

reset:
	@pids=$$(pgrep -f 'osascript.*mail.js|node test-mail' 2>/dev/null); \
	if [ -n "$$pids" ]; then \
		echo "Killing: $$pids"; \
		kill $$pids 2>/dev/null; \
	else \
		echo "No server running"; \
	fi

test: $(DIST)
	node test-mail.js

install:
	npm install
