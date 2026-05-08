import { Readline } from "node:readline/promises";
import { iter, systemPrompt } from "./agent";
import { Message } from "./llm";
import * as readline from 'node:readline/promises';
import { stdin, stdout } from "node:process";
import fs from 'node:fs/promises';

const sessionFile = process.argv[2];

let messages: Message[];

if (sessionFile) {
  try {
    const data = await fs.readFile(sessionFile, { encoding: 'utf-8' });
    messages = JSON.parse(data);
    console.log(`Loaded session from ${sessionFile} (${messages.length} messages).`);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      messages = [
        { role: 'system', content: systemPrompt },
      ];
      console.log(`Starting new session (will save to ${sessionFile}).`);
    } else {
      console.error(`Error loading ${sessionFile}:`, err.message);
      process.exit(1);
    }
  }
} else {
  messages = [
    { role: 'system', content: systemPrompt },
  ];
}

type PrintMode = 'none' | 'thinking' | 'tool-call' | 'content' | 'error' | 'user';
let printMode: PrintMode = 'none';
let newlines = 2;
const rl = readline.createInterface({ input: stdin, output: stdout });

let writeQueue: string[] = [];
let lastWritePromise: Promise<unknown> = Promise.resolve();

function printRaw(str: string) {
  writeQueue.push(str);
  lastWritePromise = lastWritePromise.then(() => Bun.stdout.write(str));
}

function printNewLine(max: number = 1) {
  for (; newlines < max; newlines++) {
    printRaw('\n');
  }
}

function print(text: string, newMode: PrintMode) {
  if (newMode !== printMode) {
    printNewLine(2);
    if (printMode != 'none') printRaw('\x1b[0m');

    printMode = newMode;
    switch (newMode) {
      case 'thinking': { printRaw('\x1b[2m'); break; }
      case 'tool-call': { printRaw('\x1b[32m'); break; }
      case 'content': { printRaw('\x1b[0m'); break; }
      case 'error': { printRaw('\x1b[31m'); break; }
      case 'user': { printRaw('\x1b[35m'); break; }
    }
  }
  printRaw(text);
  newlines = 0;
}


for (;;) {
  print('', 'user');
  await lastWritePromise;

  const userMessage = await rl.question('> ');
  newlines++;

  messages.push({
    role: 'user',
    content: userMessage,
  });

  await iter({
    messages,
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
    onMessage: (msg: Message, opts) => {
      if (opts?.error) {
        printNewLine(2);
        print(`${msg.content}`, 'error');
      }
    },
  });

  if (sessionFile) {
    await fs.writeFile(sessionFile, JSON.stringify(messages, null, 2), { encoding: 'utf-8' });
  }
}