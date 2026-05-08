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

  read_file('/home/alex/burrow/js/browser.js', { start: 1, end: 50 }) // IMPORTANT: Read the API before proceding!!!
  b = await import('${import.meta.dir}/js/browser.js');
`;

export async function iter({ messages, onStream, onMessage }: { messages: Message[], onStream?: LLMStreamCallback, onMessage: (message: Message, opts: Record<string, any>) => void }) {

  while (true) {
    let loop = false;

    const { message } = await llm({
      messages,
      tools: Object.values(tools),
      onStream,
      thinking: true,
    });
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