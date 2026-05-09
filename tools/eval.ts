import { type Message, type Tool } from '../llm';

export const eval_js: Tool = {
  name: 'eval',
  description: `Execute arbitrary JavaScript code in the Bun process.
Bare assignments are written to globalThis and persist among calls and hot reloads.

Examples:
  - "resp = await fetch('https://example.com'); return resp.status" → 200
  - "fs = await import('node:fs'); return fs.readdirSync('.')" → ["agent.ts","cli.ts",...]`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute. Wrapped in an async function, await and return are supported.',
      },
    },
    required: ['code'],
  },
  call: async (args: any): Promise<Message> => {
    const code: string = args.code;

    try {
      const result = await (0, eval)(`(async () => { ${code} })()`);

      return {
        role: 'tool',
        content: serializeResult(result),
      };
    } catch (err: any) {
      return {
        role: 'tool',
        content: `eval error: ${err.message ?? String(err)}`,
      };
    }
  },
};

function serializeResult(value: any): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return `[Symbol: ${String(value)}]`;

  if (value instanceof Error) {
    return `[${value.constructor.name}: ${value.message}]`;
  }

  if (value instanceof Promise) return '[Promise]';

  if (typeof value === 'object') {
    try {
      // First try straight JSON — fast path for simple objects
      return JSON.stringify(value, null, 2);
    } catch {
      try {
        // Handle circular references
        const seen = new WeakSet();
        return JSON.stringify(value, (_, v) => {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          return v;
        }, 2);
      } catch {
        return String(value);
      }
    }
  }

  return String(value);
}
