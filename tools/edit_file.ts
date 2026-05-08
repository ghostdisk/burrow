import { type Message, type Tool } from '../llm';
import fs from 'node:fs/promises';

export const edit_file: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing old_string with new_string. The old_string must match exactly (whitespace-sensitive). Use after reading the file to get exact text.',
  parameters: {
    type: 'object',
    properties: {
      'path': {
        type: 'string',
        description: 'Path of the file, either relative or absolute.',
      },
      'old_string': {
        type: 'string',
        description: 'The exact text to replace.',
      },
      'new_string': {
        type: 'string',
        description: 'The new text to replace it with.',
      },
      'expected_replacements': {
        type: 'number',
        description: 'Optional. Number of replacements expected. Default: 1.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  call: async (args: any): Promise<Message> => {
    try {
      const content = await fs.readFile(args.path, { encoding: 'utf-8' });

      const oldString: string = args.old_string;
      const newString: string = args.new_string;
      const expected = args.expected_replacements ?? 1;

      // Count occurrences
      let count = 0;
      let pos = 0;
      while ((pos = content.indexOf(oldString, pos)) !== -1) {
        count++;
        pos += oldString.length;
      }

      if (count === 0) {
        return {
          role: 'tool',
          content: `error: old_string not found in ${args.path}.`,
        };
      }

      if (count > 1 && args.expected_replacements === undefined) {
        return {
          role: 'tool',
          content: `error: found ${count} matches for old_string in ${args.path}. Be more specific (include more surrounding context) or set expected_replacements to ${count} to replace all occurrences.`,
        };
      }

      if (expected !== count) {
        return {
          role: 'tool',
          content: `error: expected ${expected} replacement(s) but found ${count} in ${args.path}.`,
        };
      }

      const newContent = content.split(oldString).join(newString);
      await fs.writeFile(args.path, newContent, { encoding: 'utf-8' });

      return {
        role: 'tool',
        content: `edited ${args.path}: ${count} replacement(s) made.`,
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
        content: `error editing file ${args.path}: ${err.message}`,
      };
    }
  },
};
