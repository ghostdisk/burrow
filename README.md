# Burrow 🐰

> A friendly AI agent that burrows into your tasks.

Burrow is a minimalist AI agent built with **Bun** and **TypeScript**, powered by **DeepSeek**. Five tools, no frameworks, no bloat.

## Features

- **Conversational CLI** — chat with the agent in your terminal with live streaming
- **Five built-in tools**:
  - `read_file` — read any file with line-range support
  - `write_file` — create or overwrite files (auto-creates parent directories)
  - `edit_file` — precise string-based find-and-replace
  - `bash` — run shell commands with configurable cwd and timeout
  - `eval` — execute arbitrary JS in-process with REPL-like persistent scope
- **Browser automation** — search engines, read pages, extract data via Playwright (Chromium)
- **Thinking mode** — see the agent's reasoning in real time
- **Persistent conversations** — save and resume sessions via JSON files
- **Streaming output** — color-coded ANSI output for thinking, tool calls, content, and errors

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Chromium](https://www.chromium.org/) (e.g. `apt install chromium`)
- A DeepSeek API key

### Setup

```bash
# Clone and enter
git clone <repo-url> burrow
cd burrow

# Install dependencies
bun install

# Set your API key
echo 'DEEPSEEK_API_KEY=sk-your-key-here' > .env
```

### Run

```bash
# Start a new session
bun run cli.ts

# Resume a saved session
bun run cli.ts session.json
```

## Architecture

```
burrow/
├── agent.ts          # Agent loop, system prompt, tool registry
├── cli.ts            # Interactive CLI with ANSI-colored streaming
├── llm.ts            # DeepSeek API client (streaming, tool calls, thinking)
├── tools/
│   ├── eval.ts       # JS execution with REPL-like persistent scope
│   ├── read_file.ts  # Read files with line ranges
│   ├── write_file.ts # Create/overwrite files
│   ├── edit_file.ts  # Find-and-replace editing
│   └── bash.ts       # Shell command execution
├── js/
│   └── browser.js    # Playwright browser automation helpers
├── .env              # API key (gitignored)
└── package.json
```

## License

MIT
