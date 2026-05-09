import { createMessage, llm, LLMStreamCallback, Message, Tool } from './llm';
import process from 'node:process';
import path from 'node:path';
import { read_file } from './tools/read_file';
import { write_file } from './tools/write_file';
import { edit_file } from './tools/edit_file';
import { bash } from './tools/bash';
import { eval_js } from './tools/eval';
import { discoverSkills, formatSkillsPrompt } from './skills';

const tools: Record<string, Tool> = {
  read_file,
  write_file,
  edit_file,
  bash,
  eval: eval_js,
};

export interface AgentUI {
  onStream: LLMStreamCallback;
}

export const Agents = {
  init,
  initialized: false,
  all: [] as Agent[],
  systemPrompt: "",
};

let basePrompt =
`You are Burrow, a friendly AI agent.

## Style and Persioanlity

- Rule 0: We're here to learn, create, improve ourselves, have a blast and build cool shit nobody has built before.
- Be curious. Don't take the easy way out and guess - learn, and understand. You have versitile and powerful tools. If that's not enough, ask the user. Read the docs. Search the web.
- Be concise. If the answer fits in one sentence, one sentence is what it gets.
- Don't be overly sycophantic. No need for "That's a great question, you're truly getting to the heart of it!". Just answer the question. Don't praise every little thing, praise should be earned.
- Call out dumb shit. If the user tells you to proceed with it anyway, assume they have good reasons and proceed with it.

Cwd: ${process.cwd()}
Location of your source code: ${import.meta.dir}`;

const SKILLS_DIR = path.join(import.meta.dir, 'skills');
const INTERRUPT_NOTE = "\n\n[User interrupted this request]";

export const rootContext: Record<string, any> = Object.create(globalThis);
rootContext.shared = Object.create(null);


export class Agent {
  id: string;
  name: string;
  messages: Message[];
  currentStreamingMessage?: Partial<Message>;
  ui?: AgentUI;

  private _currentInterrupt?: (() => void);
  private _currentToolCall?: string;
  private tools: Record<string, Tool>;
  private _runPromise?: Promise<void>;

  context: Record<string, any>;

  constructor({ name, messages, ui }: { name: string, messages: Message[], ui?: AgentUI }) {
    if (!Agents.initialized)
      throw new Error("Attempting to create an agent before Agents.init() is finished.");

    const self = this;
    Agents.all.push(self);

    this.id = crypto.randomUUID();
    this.name = name;
    this.tools = tools;
    this.ui = ui;
    this.messages = messages;
    this.context = Object.create(rootContext);
    this.context.outputBuffer = '';
    this.context.console = {
      _write(method: string, args: any[]) {
        self.context.outputBuffer += args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ') + '\n';
      },
      log(...args: any[]) { this._write('log', args); },
      error(...args: any[]) { this._write('error', args); },
      warn(...args: any[]) { this._write('warn', args); },
      info(...args: any[]) { this._write('info', args); },
      debug(...args: any[]) { this._write('debug', args); },
    };
  }

  interrupt() {
    if (this._currentInterrupt) {
      this._currentInterrupt();
      delete this._currentInterrupt;
      delete this._runPromise;
    }
  }

  // Run an iteration of the loop. This loops until a response without tool calls is reached.
  // Don't use onMessage, it's WIP and doesn't do what you expect, instead await and read agent.messages.
  async run({ onMessage }: {
    onMessage?: (message: Message, opts: Record<string, any>) => void;
  } = {}) {
    if (this._runPromise) {
      return this._runPromise;
    }
    this._runPromise = this._run({ onMessage }).then(() => { delete this._runPromise; });
    return this._runPromise;
  }

  wait(opts?: { timeout?: number }): Promise<{ completed: boolean; message?: string }> {
    if (!this._runPromise) return Promise.resolve({ completed: true });

    if (opts?.timeout) {
      return Promise.race([
        this._runPromise.then(() => ({ completed: true } as const)),
        new Promise<{ completed: boolean; message: string }>((resolve) =>
          setTimeout(() => {
            let msg = `timed out after ${opts.timeout}s.`;
            if (this.currentStreamingMessage) {
              const tail = JSON.stringify(this.currentStreamingMessage).slice(-200);
              msg += ` tail of currently streamed message: ...${tail}`;
            } else if (this._currentToolCall) {
              msg += ` currently executing tool: ${this._currentToolCall}`;
            }
            resolve({ completed: false, message: msg });
          }, opts.timeout! * 1000)
        ),
      ]);
    } else {
      return this._runPromise.then(() => ({ completed: true }));
    }
  }

  get done(): boolean {
    return !this._runPromise;
  }

  private async _run({ onMessage }: {
    onMessage?: (message: Message, opts: Record<string, any>) => void;
  }) {
    while (true) {
      let loop = false;

      const llmCall = llm({
        messages: this.messages,
        tools: Object.values(this.tools),
        onStream: (msg, delta) => {
          this.currentStreamingMessage = msg;
          this.ui?.onStream?.(msg, delta);
        },
        thinking: true,
      });

      this._currentInterrupt = llmCall.interrupt;
      const { message, interrupted } = await llmCall.wait();
      delete this._currentInterrupt;
      delete this.currentStreamingMessage;

      if (interrupted) {
        // Strip tool_calls since they won't be executed.
        delete message.tool_calls;

        if (message.content.length) {
          message.content += INTERRUPT_NOTE;
        } else if (message.reasoning_content?.length) {
          // Move reasoning into content so the model can see it next turn
          // (reasoning_content is an output-only field, not read on input)
          message.content = "[Interrupted thinking]\n\n" + message.reasoning_content + INTERRUPT_NOTE;
          message.reasoning_content = "";
        }
        if (message.role === "unknown") message.role = "assistant";

        this.messages.push(message);
        break;
      }

      this.messages.push(message);

      if (message.tool_calls) {
        loop = true;

        for (const tc of message.tool_calls || []) {
          const tool = this.tools[tc.function.name];
          if (!tool) {
            const msg: Message = createMessage('tool', '');
            msg.tool_call_id = tc.id;
            msg.content = `error: tool "${tc.function.name}" does not exist`;
            onMessage?.(msg, { error: true });
            this.messages.push(msg);
            break;
          }

          try {
            const args = JSON.parse(tc.function.arguments) as any;
            this._currentToolCall = tc.function.name;
            const response = await tool.call(args, this);
            delete this._currentToolCall;

            response.role = 'tool';
            response.tool_call_id = tc.id;

            if (tc.function.name === 'eval' || tc.function.name === 'bash') {
              onMessage?.(response, { error: true });
            }
            this.messages.push(response);
          } catch (err) {
            delete this._currentToolCall;
            const msg: Message = createMessage('tool', '');
            msg.tool_call_id = tc.id;
            msg.content = `error during tool call :(\n${err}`;
            onMessage?.(msg, { error: true });
            this.messages.push(msg);
          }
        }
      }

      if (!loop) break;
    }
  }
}

async function init() {
  if (Agents.initialized) return;

  const skills = await discoverSkills(SKILLS_DIR);
  const skillsSection = formatSkillsPrompt(skills, SKILLS_DIR);

  Agents.systemPrompt = basePrompt + '\n' + skillsSection;
  Agents.initialized = true;
}