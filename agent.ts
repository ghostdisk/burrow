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

export const systemPrompt = 
`You are Burrow 🐰, a friendly AI agent.

Be helpful, precise, and concise. You thrive on solving real tasks.

You can read, write, and edit files, as well as run shell commands.
You can introspect and modify your own source code to improve yourself.

Cwd: ${process.cwd()}
Location of your source code: ${import.meta.dir}

You have access to the following tools:
- read_file
- write_file
- edit_file
- bash
- eval (execute arbitrary JS — supports async, can use fetch, require, etc.)

If you want to browse the web:
  read_file '/home/alex/burrow/js/browser.js', { start: 1, end: 50 }) // IMPORTANT: Read the API before proceding!!!
  eval b = await import('${import.meta.dir}/js/browser.js');
`;

let currentInterrupt: (() => void) | null = null;

export function interrupt() {
  if (currentInterrupt) {
    currentInterrupt();
    currentInterrupt = null;
  }
}

const INTERRUPT_NOTE = "\n\n[User interrupted this request]";

export async function iter({ messages, onStream, onMessage }: { messages: Message[], onStream?: LLMStreamCallback, onMessage: (message: Message, opts: Record<string, any>) => void }) {
  while (true) {
    let loop = false;

    const llmCall = llm({
      messages,
      tools: Object.values(tools),
      onStream,
      thinking: true,
    });

    currentInterrupt = llmCall.interrupt;
    const { message, interrupted } = await llmCall.wait();
    currentInterrupt = null;

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

      messages.push(message);
      break;
    }

    messages.push(message);

    if (message.tool_calls) {
      loop = true;

      for (const tc of message.tool_calls || []) {
        const tool = tools[tc.function.name];
        if (!tool) {
          const msg: Message = {
            role: 'tool',
            tool_call_id: tc.id,
            content: `error: tool "${tc.function.name}" does not exist`,
          };
          onMessage(msg, { error: true });
          messages.push(msg);
          break;
        };

        try {
          const args = JSON.parse(tc.function.arguments) as any;
          const response = await tool.call(args);

          response.role = 'tool';
          response.tool_call_id = tc.id;

          if (tc.function.name === 'eval' || tc.function.name === 'bash') {
            onMessage(response, { error: true });
          }
          messages.push(response);
        } catch (err) {
          const msg: Message = {
            role: 'tool',
            tool_call_id: tc.id,
            content: `error during tool call :(\n${err}`,
          };
          onMessage(msg, { error: true });
          messages.push(msg);
        }

      }
    }

    if (!loop) break;
  }
}