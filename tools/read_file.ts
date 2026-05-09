import { type Message, type Tool } from '../llm';
import fs from 'node:fs/promises';

export const read_file: Tool = {
  name: 'read_file',
  description: 'Read a file.',
  parameters: {
    type: 'object',
    properties: {
      'path': {
        type: 'string',
        description: 'Path of the file, relative or absolute',
      },
      'start': {
        type: 'number',
        description: 'Optional. Starting line number (1-indexed).',
      },
      'end': {
        type: 'number',
        description: 'Optional. Ending line number',
      },
    },
  },
  call: async (args: any): Promise<Message> => {
    try {
      const resp = await fs.readFile(args.path, { encoding: 'utf-8' });
      let lines = resp.split('\n');

      const totalLines = lines.length;
      let start = args.start ? Number(args.start) : 1;
      let end = args.end ? Number(args.end) : lines.length;
      if (isNaN(start) || start < 1) start = 1;
      if (isNaN(end) || end > lines.length) end = lines.length;
      if (end < start) end = start;

      const selectedLines = lines.slice(start - 1, end);
      const selectedCount = selectedLines.length;

      const MAX_LINES = 2000;
      let result: string;
      let truncated = false;

      if (selectedCount > MAX_LINES) {
        result = selectedLines.slice(0, MAX_LINES).join('\n');
        truncated = true;
      } else {
        result = selectedLines.join('\n');
      }

      // Build output with potential truncation note
      let content = `content of ${args.path}`;
      if (start > 1 || end < totalLines) {
        content += ` (lines ${start}-${end})`;
      }
      content += `:\n${result}`;

      if (truncated) {
        content += `\n\n[Note: Output truncated to ${MAX_LINES} lines. The file/range has ${selectedCount} lines total. Use start/end parameters to read specific sections.]`;
      }

      return {
        role: 'tool',
        content,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return {
          role: 'tool',
          content: `error: file not found: ${args.path}`,
        };
      }
      return {
        role: 'tool',
        content: `error reading file ${args.path}: ${err.message}`,
      };
    }
  },
};
