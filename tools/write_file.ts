import { type Message, type Tool } from '../llm';
import fs from 'node:fs/promises';
import path from 'node:path';

export const write_file: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
  parameters: {
    type: 'object',
    properties: {
      'path': {
        type: 'string',
        description: 'Path of the file, relative or absolute.',
      },
      'content': {
        type: 'string',
        description: 'Content to write',
      },
      'create_dirs': {
        type: 'boolean',
        description: 'Optional. Create parent directories if they don\'t exist. Default: true.',
      },
    },
    required: ['path', 'content'],
  },
  call: async (args: any): Promise<Message> => {
    try {
      if (args.create_dirs !== false) {
        const dir = path.dirname(args.path);
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(args.path, args.content, { encoding: 'utf-8' });

      return {
        role: 'tool',
        content: `wrote ${args.path}.`,
      };
    } catch (err: any) {
      return {
        role: 'tool',
        content: `error writing file ${args.path}: ${err.message}`,
      };
    }
  },
};
