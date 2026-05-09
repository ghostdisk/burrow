import { systemPrompt, Agent, AgentUI } from "./agent";
import { Message } from "./llm";
import * as readline from 'node:readline/promises';
import { stdin, stdout } from "node:process";
import fs from 'node:fs/promises';

type PrintMode = 'none' | 'thinking' | 'tool-call' | 'content' | 'error' | 'user';

type BurrowCLIState = {
  agent?: Agent,
  rl: readline.Interface,
  writeQueue: string[],
  lastWritePromise: Promise<unknown>,
  sessionFile?: string,
  printMode?: PrintMode,
  newlines: number,
  escBound: boolean,
};

let state: BurrowCLIState = null!;

// init with hot-reload support
if (!(globalThis as any).burrowCLI) {
  (globalThis as any).burrowCLI = {};
}
state = (globalThis as any).burrowCLI as any;

const agentUI: AgentUI = {
  onStream: (data, delta) => {
    if (delta.reasoning_content) {
      print(delta.reasoning_content, 'thinking');
    }
    if (delta.content) {
      print(delta.content, 'content');
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.function.name) {
          printNewLine(1);
          print(`- ${tc.function.name} `, 'tool-call')
        }
        if (tc.function.arguments) {
          print(`${tc.function.arguments}`, 'tool-call')
        }
      }
    }
  },
};

if (!state.agent) state.agent = new Agent();
state.agent.ui = agentUI;
if (!state.rl) state.rl = readline.createInterface({ input: stdin, output: stdout });
if (!state.writeQueue) state.writeQueue = [];
if (!state.lastWritePromise) state.lastWritePromise = Promise.resolve();
if (!state.printMode) state.printMode = 'none';
if (state.newlines === undefined) state.newlines = 2;
if (state.escBound === undefined) state.escBound = false;

if (!state.sessionFile) {
  state.sessionFile = process.argv[2];

  if (state.sessionFile) {
    try {
      const data = await fs.readFile(state.sessionFile, { encoding: 'utf-8' });
      state.agent.messages = JSON.parse(data);
      console.log(`Loaded session from ${state.sessionFile} (${state.agent.messages.length} messages).`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        state.agent.messages = [
          { role: 'system', content: systemPrompt },
        ];
        console.log(`Starting new session (will save to ${state.sessionFile}).`);
      } else {
        console.error(`Error loading ${state.sessionFile}:`, err.message);
        process.exit(1);
      }
    }
  } else {
    state.agent.messages = [
      { role: 'system', content: systemPrompt },
    ];
  }
}


function printRaw(str: string) {
  state.writeQueue.push(str);
  state.lastWritePromise = state.lastWritePromise.then(() => Bun.stdout.write(str));
}

function printNewLine(max: number = 1) {
  for (; state.newlines < max; state.newlines++) {
    printRaw('\n');
  }
}

function print(text: string, newMode: PrintMode) {
  if (newMode !== state.printMode) {
    printNewLine(2);
    if (state.printMode != 'none') printRaw('\x1b[0m');

    state.printMode = newMode;
    switch (newMode) {
      case 'thinking': { printRaw('\x1b[2m'); break; }
      case 'tool-call': { printRaw('\x1b[32m'); break; }
      case 'content': { printRaw('\x1b[0m'); break; }
      case 'error': { printRaw('\x1b[31m'); break; }
      case 'user': { printRaw('\x1b[35m'); break; }
    }
  }
  printRaw(text);
  state.newlines = 0;
}

if (!state.escBound) {
  state.escBound = true;
  stdin.on('data', function (data: Buffer) {
    if (data.length === 1 && data[0] === 0x1b) {
      state.agent?.interrupt();
    }
  });
}

process.on('SIGINT', () => {
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(false);
  }
  process.exit(0);
});

for (;;) {
  print('', 'user');
  await state.lastWritePromise;

  const userMessage = await state.rl.question('> ');
  state.newlines++;

  state.agent.messages.push({
    role: 'user',
    content: userMessage,
  });

  await state.agent.run({
    onMessage: (msg: Message, opts) => {
      if (opts?.interrupted) {
        printNewLine(2);
        print(`\n[User interrupted this request]`, 'error');
      }
      if (opts?.error) {
        printNewLine(2);
        print(`${msg.content}`, 'error');
      }
    },
  });

  if (state.sessionFile) {
    await fs.writeFile(state.sessionFile, JSON.stringify(state.agent.messages, null, 2), { encoding: 'utf-8' });
  }
}
