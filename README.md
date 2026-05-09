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
  - `eval` — execute arbitrary JS in-process with per-agent isolated context
- **Agent Skills** — portable, version-controlled skill folders (agentskills.io spec) with scripts, references, and assets
- **Built-in skills**: browser (Playwright web search/scraping) and subagent (spawn independent sibling agents)
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
# Start a new session (with hot-reload — code changes apply instantly)
bun --hot cli.ts

# Resume a saved session
bun --hot cli.ts session.json
```

## Architecture

```
burrow/
├── agent.ts          # Agent loop, system prompt, tool registry
├── cli.ts            # Interactive CLI with ANSI-colored streaming
├── llm.ts            # DeepSeek API client (streaming, tool calls, thinking)
├── tools/
│   ├── eval.ts       # JS execution with per-agent isolated context
│   ├── read_file.ts  # Read files with line ranges
│   ├── write_file.ts # Create/overwrite files
│   ├── edit_file.ts  # Find-and-replace editing
│   ├── bash.ts       # Shell command execution
│   └── skills.ts     # Agent Skills loader
├── skills/
│   ├── browser/      # Browser automation skill
│   │   ├── SKILL.md      # Skill instructions (loaded by agent on demand)
│   │   └── scripts/
│   │       └── browser.js  # Playwright helpers (search, open, extract)
│   └── subagent/     # Subagent skill
│       ├── SKILL.md      # Skill instructions
│       └── scripts/
│           └── subagent.js # Spawn independent child agents
├── .env              # API key (gitignored)
└── package.json
```

## License

MIT
