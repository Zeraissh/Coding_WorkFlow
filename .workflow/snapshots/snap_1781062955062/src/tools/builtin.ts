import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { search } from 'duck-duck-scrape';
import { fslock } from '../core/fslock';
import { workflowEvents } from '../core/events';

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

export async function executeBuiltinTool(name: string, args: any, agentId?: string): Promise<string> {
  try {
    switch (name) {
      case 'run_terminal_command':
        const { stdout, stderr } = await execAsync(args.command);
        return `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
      case 'read_file': {
        if (agentId) await fslock().acquireRead(args.path, agentId);
        const content = fs.readFileSync(args.path, 'utf-8');
        if (agentId) fslock().release(args.path, agentId);
        return content;
      }
      case 'write_file': {
        const fileExists = fs.existsSync(args.path);
        if (agentId) {
          await fslock().acquireWrite(args.path, agentId);
          try {
            fslock().writeFile(args.path, agentId, args.content);
          } finally {
            fslock().release(args.path, agentId);
          }
        } else {
          fs.writeFileSync(args.path, args.content, 'utf-8');
        }
        
        workflowEvents.emit('fileChanged', { 
          type: fileExists ? 'Modified' : 'Added', 
          path: args.path 
        });

        if (args.path.endsWith('.html') || args.path.endsWith('.css') || args.path.endsWith('.js')) {
          workflowEvents.emit('previewUpdated', { path: args.path });
        }
        
        return `Successfully wrote to ${args.path}`;
      }
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
