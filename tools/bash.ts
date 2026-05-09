import { type Message, type Tool } from '../llm';
import process from 'node:process';
import { exec } from 'node:child_process';

export const bash: Tool = {
  name: 'bash',
  description: 'Execute a bash command. Returns stdout, stderr, and exit code. Use for file system operations like listing directories, searching files, running scripts, etc.',
  parameters: {
    type: 'object',
    properties: {
      'command': {
        type: 'string',
        description: 'The bash command to execute.',
      },
      'cwd': {
        type: 'string',
        description: 'Optional. Working directory for the command. Defaults to current working directory.',
      },
      'timeout': {
        type: 'number',
        description: 'Optional. Timeout in milliseconds. Default: 30000 (30 seconds).',
      },
    },
    required: ['command'],
  },
  call: async (args: any, _agent: any): Promise<Message> => {
    const timeout = args.timeout ?? 30000;
    const cwd = args.cwd ?? process.cwd();

    return new Promise((resolve) => {
      exec(args.command, { cwd, timeout, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        let content = '';
        if (stdout) content += stdout;
        if (stderr) content += (content ? '\n' : '') + '[stderr]\n' + stderr;
        if (error && error.signal === 'SIGTERM') {
          content += '\n[error: command timed out]';
        } else if (error) {
          content += '\n[exit code: ' + (error.code ?? '?') + ']';
        }

        resolve({
          role: 'tool',
          content: content || '[command produced no output]',
        });
      });
    });
  },
};
