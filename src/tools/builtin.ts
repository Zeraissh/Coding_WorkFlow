import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { search } from 'duck-duck-scrape';

const execAsync = promisify(exec);

export const builtinTools = [
  {
    name: 'run_terminal_command',
    description: 'Execute a bash or powershell command on the local machine.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read contents of a file on the local machine.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a local file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'search_web',
    description: 'Search the web for information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    }
  }
];

export async function executeBuiltinTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'run_terminal_command':
        const { stdout, stderr } = await execAsync(args.command);
        return `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
      case 'read_file':
        return fs.readFileSync(args.path, 'utf-8');
      case 'write_file':
        fs.writeFileSync(args.path, args.content, 'utf-8');
        return `Successfully wrote to ${args.path}`;
      case 'search_web':
        const searchResults = await search(args.query);
        return JSON.stringify(searchResults.results.slice(0, 5), null, 2);
      default:
        throw new Error(`Unknown builtin tool: ${name}`);
    }
  } catch (err: any) {
    return `Tool execution failed: ${err.message}`;
  }
}
