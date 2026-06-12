import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RepoMap, extractSymbols } from '../src/core/repomap';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

describe('extractSymbols', () => {
  it('extracts TypeScript classes, functions, exports and types', () => {
    const code = [
      'export class Orchestrator {',
      'export async function askLLM(a: string) {',
      'export const tokenBudget = () => {};',
      'export interface Plan {',
      'function internalHelper() {',
      'const notExported = 1;',
    ].join('\n');
    const symbols = extractSymbols(code, '.ts');
    expect(symbols).toEqual(['Orchestrator', 'askLLM', 'tokenBudget', 'Plan', 'internalHelper']);
  });

  it('extracts Python classes and functions', () => {
    const code = 'class SerialBridge:\n    pass\n\nasync def forward_data(port):\n    pass\ndef main():\n    pass\n';
    expect(extractSymbols(code, '.py')).toEqual(['SerialBridge', 'forward_data', 'main']);
  });

  it('extracts Go functions and types', () => {
    const code = 'func main() {\nfunc (s *Server) Start() error {\ntype Config struct {\n';
    expect(extractSymbols(code, '.go')).toEqual(['main', 'Start', 'Config']);
  });

  it('respects maxSymbols and deduplicates', () => {
    const code = Array.from({ length: 20 }, (_, i) => `export function f${i}() {}`).join('\n');
    expect(extractSymbols(code, '.ts', 5)).toHaveLength(5);
    expect(extractSymbols('function dup() {}\nfunction dup() {}', '.ts')).toEqual(['dup']);
  });

  it('returns empty for unknown extensions', () => {
    expect(extractSymbols('whatever', '.txt')).toEqual([]);
  });
});

describe('RepoMap', () => {
  it('scans the tree and renders file → symbols lines', () => {
    write('src/parser.ts', 'export class Parser {}\nexport function parse() {}');
    write('src/utils/helper.py', 'def helper_fn():\n    pass');
    write('README.md', '# not code');
    write('node_modules/dep/index.js', 'export function ignored() {}');
    write('.workflow/state.json', '{}');

    const map = new RepoMap(tmpDir).render();
    expect(map).toContain('src/parser.ts: Parser, parse');
    expect(map).toContain('src/utils/helper.py: helper_fn');
    expect(map).not.toContain('node_modules');
    expect(map).not.toContain('ignored');
  });

  it('omits files with no symbols', () => {
    write('src/empty.ts', '// just a comment\nconst x = 1;');
    write('src/real.ts', 'export function real() {}');
    const map = new RepoMap(tmpDir).render();
    expect(map).not.toContain('empty.ts');
    expect(map).toContain('real.ts');
  });

  it('truncates output beyond maxChars with a notice', () => {
    for (let i = 0; i < 30; i++) {
      write(`src/mod${i}.ts`, `export class VeryLongClassName${i} {}\nexport function anotherLongFunctionName${i}() {}`);
    }
    const map = new RepoMap(tmpDir, { maxChars: 300 }).render();
    expect(map.length).toBeLessThan(500);
    expect(map).toContain('more files omitted');
  });

  it('returns empty string for a repo with no recognizable code', () => {
    write('docs/readme.md', '# docs only');
    expect(new RepoMap(tmpDir).render()).toBe('');
  });
});
