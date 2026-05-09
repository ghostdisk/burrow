import { llm, LLMStreamCallback, Message, Tool } from './llm';
import process from 'node:process';
import { read_file } from './tools/read_file';
import { write_file } from './tools/write_file';
import { edit_file } from './tools/edit_file';
import { bash } from './tools/bash';
import { eval_js } from './tools/eval';

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

export const systemPrompt =
`You are Burrow 🐰, a friendly AI agent.

Be helpful, precise, and concise. You thrive on solving real tasks.

You can read, write, and edit files, as well as run shell commands.
Cwd: ${process.cwd()}

You can introspect and modify your own source code to improve yourself.
When you write changes to your own code, they're applied to you instantly with hot reload.
Location of your source code: ${import.meta.dir}

browser.js: If you want to browse the web:
  read_file '/home/alex/burrow/js/browser.js', { start: 1, end: 50 }) // IMPORTANT: Read the API before proceding!!!
  eval b = await import('${import.meta.dir}/js/browser.js');
`;

const INTERRUPT_NOTE = "\n\n[User interrupted this request]";

export class Agent {
  messages: Message[];
  ui?: AgentUI;
  private currentInterrupt: (() => void) | null = null;
  private tools: Record<string, Tool>;

  constructor(messages?: Message[], ui?: AgentUI) {
    this.tools = tools;
    this.ui = ui;
    this.messages = messages ?? [
      { role: 'system', content: systemPrompt },
    ];
  }

  interrupt() {
    if (this.currentInterrupt) {
      this.currentInterrupt();
      this.currentInterrupt = null;
    }
  }

  async run({
    onMessage,
  }: {
    onMessage: (message: Message, opts: Record<string, any>) => void;
  }) {
    while (true) {
      let loop = false;

      const llmCall = llm({
        messages: this.messages,
        tools: Object.values(this.tools),
        onStream: this.ui?.onStream,
        thinking: true,
      });

      this.currentInterrupt = llmCall.interrupt;
      const { message, interrupted } = await llmCall.wait();
      this.currentInterrupt = null;

      if (interrupted) {
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
            const msg: Message = {
              role: 'tool',
              tool_call_id: tc.id,
              content: `error: tool "${tc.function.name}" does not exist`,
            };
            onMessage(msg, { error: true });
            this.messages.push(msg);
            break;
          }

          try {
            const args = JSON.parse(tc.function.arguments) as any;
            const response = await tool.call(args);

            response.role = 'tool';
            response.tool_call_id = tc.id;

            if (tc.function.name === 'eval' || tc.function.name === 'bash') {
              onMessage(response, { error: true });
            }
            this.messages.push(response);
          } catch (err) {
            const msg: Message = {
              role: 'tool',
              tool_call_id: tc.id,
              content: `error during tool call :(\n${err}`,
            };
            onMessage(msg, { error: true });
            this.messages.push(msg);
          }
        }
      }

      if (!loop) break;
    }
  }
}
