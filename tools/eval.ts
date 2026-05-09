import { type Message, type Tool } from '../llm';
import path from 'node:path';

// import() in eval resolves relative to this file (tools/eval.ts), not cwd.
// Provide burrowImport() which resolves relative paths from process.cwd() instead.
globalThis.burrowImport ??= (p: string) => {
  if (p.startsWith('.')) p = path.resolve(process.cwd(), p);
  return import(p);
};

export const eval_js: Tool = {
  name: 'eval',
  description: `Execute arbitrary JavaScript code in the Bun process.
Bare assignments are written to globalThis and persist among calls and hot reloads.

Note: dynamic import() resolves relative to tools/eval.ts, not cwd.
Use burrowImport('./relative/path') to import relative to cwd instead.
Built-in modules and absolute paths work fine with plain import().

Examples:
  - "resp = await fetch('https://example.com'); return resp.status" → 200
  - "fs = await import('node:fs'); return fs.readdirSync('.')" → ["agent.ts","cli.ts",...]
  - "b = await burrowImport('./skills/browser/scripts/browser.js')" → loads from cwd`,
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
