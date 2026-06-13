import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { search } from 'duck-duck-scrape';
import * as path from 'path';
import { fslock } from '../core/fslock';
import { workflowEvents } from '../core/events';
import { ProjectIndexer } from '../core/indexer';
import { resolveWithinRoot, assertCommandAllowed } from '../core/security';
import { isSandboxEnabled, runInSandbox } from '../core/sandbox';
import { KnowledgeStore } from '../core/knowledge';

const execAsync = promisify(exec);

export const builtinTools = [
  {
    name: 'run_terminal_command',
    description: 'Execute a shell command. Runs on the host by default, or inside an isolated Docker container when sandbox mode is enabled (commands then run in a Linux container regardless of host OS).',
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
    description: 'Read contents of a file. Paths must stay within the project root directory.',
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
    description: 'Create a new file or fully overwrite an existing one. For modifying part of an existing file, prefer edit_file — it is cheaper and avoids accidentally losing content. Paths must stay within the project root directory.',
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
    name: 'edit_file',
    description: 'Edit an existing file by replacing an exact text block. Provide the exact text to find (including indentation and line breaks) and its replacement. The search text must match exactly once unless replace_all is true. Preferred over write_file for modifying existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        search: { type: 'string', description: 'Exact existing text to find (must match exactly, including whitespace)' },
        replace: { type: 'string', description: 'Text to replace it with' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match. Default false.' }
      },
      required: ['path', 'search', 'replace']
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
  },
  {
    name: 'list_dir',
    description: 'Safely list directory contents up to a specified depth, ignoring node_modules and hidden folders. Useful to understand project structure without stdout explosion.',
    input_schema: {
      type: 'object',
      properties: {
        dirPath: { type: 'string', description: 'Directory path to list, use . for current directory' },
        depth: { type: 'number', description: 'Max depth to recurse, default 2' }
      },
      required: ['dirPath']
    }
  },
  {
    name: 'semantic_code_search',
    description: 'Search for code snippets based on semantic meaning using local embeddings.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The semantic query, e.g., "where is the orchestrator initialized?"' },
        topK: { type: 'number', description: 'Number of results to return, default 3' }
      },
      required: ['query']
    }
  },
  {
    name: 'query_knowledge',
    description: 'Query the project knowledge base (requirements specs, architecture decisions, research findings, user corrections). Use this BEFORE guessing or asking the user — prior decisions are often already recorded here.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to know, e.g. "which MCU platform was chosen"' },
        topK: { type: 'number', description: 'Number of results, default 3' }
      },
      required: ['query']
    }
  },
  {
    name: 'grep_search',
    description: 'Search for a string pattern across files in the project. Returns file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The regex pattern or string to search for' },
        dirPath: { type: 'string', description: 'Directory path to start search, use . for project root' }
      },
      required: ['pattern', 'dirPath']
    }
  }
];

// Helper to recursively list files safely
export function safeListDir(dir: string, maxDepth: number, currentDepth = 1): string[] {
  if (currentDepth > maxDepth) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', 'build', 'out', 'coverage', 'venv', '.venv', '__pycache__', '.next', '.cache'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(`[DIR] ${fullPath}`);
      results.push(...safeListDir(fullPath, maxDepth, currentDepth + 1));
    } else {
      results.push(`[FILE] ${fullPath}`);
    }
  }
  return results;
}

function nativeGrep(dir: string, pattern: string): string[] {
  const results: string[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (e) {
    return [`Invalid regex pattern: ${pattern}`];
  }

  function walk(currentDir: string) {
    if (results.length >= 100) return; // limit output size

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'venv', '.venv', '__pycache__', '.next', '.cache', '.workflow'].includes(entry.name)) continue;
      
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name);
        if (['.ts', '.js', '.json', '.md', '.css', '.html', '.py', '.c', '.cpp', '.h'].includes(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line && regex.test(line)) {
                results.push(`[${fullPath}:${i+1}] ${line.trim().substring(0, 150)}`);
                if (results.length >= 100) break;
              }
            }
          } catch {}
        }
      }
    }
  }
  walk(dir);
  return results;
}

/** 加锁安全写入（含 3 次重试）；无 agentId 时直接写 */
async function writeWithLock(filePath: string, content: string, agentId?: string): Promise<void> {
  if (!agentId) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return;
  }
  let attempts = 0;
  let lastErr: any;
  while (attempts < 3) {
    try {
      await fslock().acquireWrite(filePath, agentId);
      fslock().writeFile(filePath, agentId, content);
      return;
    } catch (err: any) {
      lastErr = err;
      attempts++;
      if (attempts < 3) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } finally {
      fslock().release(filePath, agentId);
    }
  }
  throw lastErr;
}

function emitFileEvents(filePath: string, fileExisted: boolean): void {
  workflowEvents.emit('fileChanged', {
    type: fileExisted ? 'Modified' : 'Added',
    path: filePath
  });
  if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
    workflowEvents.emit('previewUpdated', { path: filePath });
  }
}

/** 统计 search 在 content 中的出现次数（非重叠） */
function countOccurrences(content: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let idx = content.indexOf(search);
  while (idx !== -1) {
    count++;
    idx = content.indexOf(search, idx + search.length);
  }
  return count;
}

export async function executeBuiltinTool(name: string, args: any, agentId?: string): Promise<string> {
  try {
    switch (name) {
      case 'run_terminal_command': {
        assertCommandAllowed(args.command);
        // 沙箱开启时在 Docker 容器内执行（隔离宿主）；否则宿主执行
        const exec = isSandboxEnabled()
          ? await runInSandbox(args.command, process.cwd())
          : await execAsync(args.command);
        return `STDOUT:\n${exec.stdout}\nSTDERR:\n${exec.stderr}`;
      }
      case 'read_file': {
        const safePath = resolveWithinRoot(args.path);
        if (agentId) await fslock().acquireRead(safePath, agentId);
        const content = fs.readFileSync(safePath, 'utf-8');
        if (agentId) fslock().release(safePath, agentId);
        return content;
      }
      case 'write_file': {
        const safePath = resolveWithinRoot(args.path);
        const fileExists = fs.existsSync(safePath);
        await writeWithLock(safePath, args.content, agentId);
        emitFileEvents(safePath, fileExists);
        return `Successfully wrote to ${safePath}`;
      }
      case 'edit_file': {
        const safePath = resolveWithinRoot(args.path);
        if (!fs.existsSync(safePath)) {
          return `Edit failed: ${safePath} does not exist. Use write_file to create new files.`;
        }
        const search: string = args.search ?? '';
        const replace: string = args.replace ?? '';
        if (search.length === 0) {
          return 'Edit failed: "search" must be a non-empty string.';
        }
        if (search === replace) {
          return 'Edit failed: "search" and "replace" are identical — nothing to change.';
        }

        const original = fs.readFileSync(safePath, 'utf-8');
        const occurrences = countOccurrences(original, search);
        if (occurrences === 0) {
          return `Edit failed: search text not found in ${safePath}. ` +
            `The text must match EXACTLY, including indentation, whitespace and line breaks. ` +
            `Read the file again and copy the target text verbatim.`;
        }
        if (occurrences > 1 && !args.replace_all) {
          return `Edit failed: search text matches ${occurrences} locations in ${safePath}. ` +
            `Either include more surrounding lines to make the match unique, or set replace_all to true.`;
        }

        const updated = args.replace_all
          ? original.split(search).join(replace)
          : original.replace(search, replace);
        await writeWithLock(safePath, updated, agentId);
        emitFileEvents(safePath, true);
        const replacedCount = args.replace_all ? occurrences : 1;
        return `Successfully replaced ${replacedCount} occurrence${replacedCount > 1 ? 's' : ''} in ${safePath}`;
      }
      case 'search_web':
        const searchResults = await search(args.query);
        return JSON.stringify(searchResults.results.slice(0, 5), null, 2);
      case 'list_dir':
        try {
          const depth = args.depth || 2;
          const targetDir = resolveWithinRoot(args.dirPath || '.');
          const lines = safeListDir(targetDir, depth);
          return lines.length > 0 ? lines.join('\n') : 'Directory is empty or all contents were ignored.';
        } catch (e: any) {
          return `Failed to list directory: ${e.message}`;
        }
      case 'semantic_code_search': {
        const indexer = new ProjectIndexer();
        await indexer.scanAndIndex();
        const results = await indexer.search(args.query, args.topK || 3);
        if (results.length === 0) return 'No semantically related code found.';
        return results.map(r => `// File: ${r.file}\n// Starts at Line: ${r.startLine}\n${r.content}`).join('\n\n');
      }
      case 'query_knowledge': {
        const store = new KnowledgeStore();
        const hits = store.search(args.query, args.topK || 3);
        if (hits.length === 0) {
          return 'No matching knowledge found. The knowledge base may not cover this topic — consider asking the user or stating an explicit assumption.';
        }
        return hits
          .map(h => `### ${h.docTitle} (score ${h.score.toFixed(2)})\n${h.chunk}`)
          .join('\n\n');
      }
      case 'grep_search': {
        const targetDir = resolveWithinRoot(args.dirPath || '.');
        const results = nativeGrep(targetDir, args.pattern);
        if (results.length === 0) return `No matches found for "${args.pattern}"`;
        return results.join('\n');
      }
      default:
        throw new Error(`Unknown builtin tool: ${name}`);
    }
  } catch (err: any) {
    return `Tool execution failed: ${err.message}`;
  }
}
