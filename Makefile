# Apple Mail JXA MCP Server - Build System
#
# Concatenates source files with padding for debuggable line numbers.
# Error at line N → file index = N/400, line in file = N%400
#
# Usage:
#   make        - Build dist/mail.js
#   make run    - Build and run (for MCP config)
#   make clean  - Remove built files
#   make check  - Show file/line mapping

SHELL := /bin/bash

# Source files in concatenation order
SOURCES := src/framework.js \
           src/cache.js \
           src/facades.js \
           src/mail.js \
           src/resources.js \
           src/tools-messages.js \
           src/tools-crud.js \
           src/main.js

# Padding: each file padded to this many lines
# Error line N: file = floor(N/400), line = N mod 400
PAD := 400

# Output
DIST := dist/mail.js

.PHONY: all run clean check

all: $(DIST)

$(DIST): $(SOURCES)
	@mkdir -p dist
	@echo "Building $@ ($(PAD)-line padding per file)"
	@rm -f $@
	@index=0; \
	for f in $(SOURCES); do \
		lines=$$(wc -l < "$$f" | tr -d ' '); \
		content_lines=$$((lines + 1)); \
		if [ $$content_lines -gt $(PAD) ]; then \
			echo "ERROR: $$f has $$lines lines (max $$(( $(PAD) - 1 )))" >&2; \
			echo "Split the file or increase PAD in Makefile" >&2; \
			rm -f $@; \
			exit 1; \
		fi; \
		start_line=$$((index * $(PAD) + 1)); \
		echo "// === $$f (lines $$start_line-$$((start_line + $(PAD) - 1))) ===" >> $@; \
		cat "$$f" >> $@; \
		padding=$$(($(PAD) - content_lines)); \
		if [ $$padding -gt 0 ]; then \
			yes '' | head -n $$padding >> $@; \
		fi; \
		index=$$((index + 1)); \
	done
	@echo "Built $@ ($$(wc -l < $@ | tr -d ' ') lines)"

# MCP config target: build and exec
# Use this in claude_desktop_config.json:
#   "command": "make", "args": ["-C", "/path/to/repo", "-s", "run"]
run: $(DIST)
	@exec osascript -l JavaScript $(DIST)

clean:
	rm -rf dist

# Show line number mapping for debugging
check:
	@echo "Line number mapping ($(PAD)-line padding):"
	@echo ""
	@index=0; \
	for f in $(SOURCES); do \
		start=$$((index * $(PAD) + 1)); \
		end=$$((start + $(PAD) - 1)); \
		printf "  %4d - %4d : %s\n" $$start $$end "$$f"; \
		index=$$((index + 1)); \
	done
	@echo ""
	@echo "To find source: line/$(PAD) = file index, line%$(PAD) = line in file"
