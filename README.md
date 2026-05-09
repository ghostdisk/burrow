# Burrow 🐰

🚧🚧🚧 ️ This project is still in early stages of development. It's not meant for general use. 🚧🚧🚧

Burrow is an experimental agent harness. It has only five tools (`read_file`, `write_file`, `edit_file`, `bash`, `eval`), and can be extended by providing JS/TS based skills.

`eval` is the most interesting thing about Burrow. The core philosophy is that LLMs are pretty good at writing JavaScript, so we should make it a core part of their interface. Subagents are implemented in 50 lines by giving Burrow access to the `Agent` class, via `eval`. Browser access/web search is implemented in 50 lines by giving it access to `Playwright`, via `eval`.

Expect rough edges all around:
- There's no TUI yet, the CLI is very minimal and jank.
- Full YOLO, no permission system.
- Currently only DeepSeek API is supported, as it's what I'm using right now.

### Setup

```bash
git clone https://github.com/ghostdisk/burrow.git burrow
cd burrow
bun install
echo 'DEEPSEEK_API_KEY=sk-your-key-here' > .env

# run
bun --hot cli.ts sessions/1.json
```

## Architecture

```
burrow/
├── agent.ts          # Agent loop, system prompt, tool registry
├── cli.ts            # Interactive CLI
├── llm.ts            # DeepSeek API client (streaming, tool calls, thinking)
│── skills.ts         # Agent Skills loader
├── tools/
│   ├── eval.ts
│   ├── read_file.ts
│   ├── write_file.ts
│   ├── edit_file.ts
│   ├── bash.ts
├── skills/
│   ├── browser/
│   └── subagent/
```

## License

MIT
