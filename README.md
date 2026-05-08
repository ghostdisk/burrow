# Burrow 🐰

> A friendly AI agent that burrows into your tasks.

Burrow is a minimalist AI agent with just **four tools** — read, write, edit, and bash. No frameworks, no bloat. The entire codebase fits on a napkin. Built with **Bun** and **TypeScript**, powered by **DeepSeek**.

## Features

- **Conversational CLI** — chat with the agent in your terminal with live streaming
- **Four built-in tools**:
  - `read_file` — read any file with line-range support
  - `write_file` — create or overwrite files (auto-creates parent directories)
  - `edit_file` — precise string-based find-and-replace
  - `bash` — run shell commands with configurable cwd and timeout
- **Thinking mode** — see the agent's reasoning in real time
- **Persistent conversations** — save and resume sessions via JSON files
- **Streaming output** — color-coded ANSI output for thinking, tool calls, content, and errors

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
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
│   ├── read_file.ts  # Read files with line ranges
│   ├── write_file.ts # Create/overwrite files
│   ├── edit_file.ts  # Find-and-replace editing
│   └── bash.ts       # Shell command execution
├── .env              # API key (gitignored)
└── package.json
```

## License

MIT
