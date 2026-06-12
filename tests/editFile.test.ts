import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { executeBuiltinTool } from '../src/tools/builtin';

// edit_file 受项目根路径防护约束，临时文件必须放在项目根内
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-editfile-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('edit_file', () => {
  it('replaces a unique exact match', async () => {
    const file = makeFile('a.ts', 'const x = 1;\nconst y = 2;\nconst z = 3;\n');
    const result = await executeBuiltinTool('edit_file', {
      path: file,
      search: 'const y = 2;',
      replace: 'const y = 42;',
    });
    expect(result).toContain('Successfully replaced 1 occurrence');
    expect(fs.readFileSync(file, 'utf-8')).toBe('const x = 1;\nconst y = 42;\nconst z = 3;\n');
  });

  it('preserves multi-line indentation in search blocks', async () => {
    const original = 'function f() {\n  if (a) {\n    doThing();\n  }\n}\n';
    const file = makeFile('b.ts', original);
    const result = await executeBuiltinTool('edit_file', {
      path: file,
      search: '  if (a) {\n    doThing();\n  }',
      replace: '  if (a && b) {\n    doThing();\n    doOther();\n  }',
    });
    expect(result).toContain('Successfully replaced');
    expect(fs.readFileSync(file, 'utf-8')).toContain('doOther();');
  });

  it('fails with guidance when the search text is not found', async () => {
    const file = makeFile('c.ts', 'hello world\n');
    const result = await executeBuiltinTool('edit_file', {
      path: file,
      search: 'goodbye world',
      replace: 'x',
    });
    expect(result).toContain('search text not found');
    expect(result).toContain('match EXACTLY');
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello world\n'); // 未改动
  });

  it('rejects ambiguous matches and suggests replace_all or more context', async () => {
    const file = makeFile('d.ts', 'foo();\nfoo();\nfoo();\n');
    const result = await executeBuiltinTool('edit_file', {
      path: file,
      search: 'foo();',
      replace: 'bar();',
    });
    expect(result).toContain('matches 3 locations');
    expect(fs.readFileSync(file, 'utf-8')).toBe('foo();\nfoo();\nfoo();\n');
  });

  it('replaces every occurrence with replace_all', async () => {
    const file = makeFile('e.ts', 'foo();\nfoo();\nfoo();\n');
    const result = await executeBuiltinTool('edit_file', {
      path: file,
      search: 'foo();',
      replace: 'bar();',
      replace_all: true,
    });
    expect(result).toContain('Successfully replaced 3 occurrences');
    expect(fs.readFileSync(file, 'utf-8')).toBe('bar();\nbar();\nbar();\n');
  });

  it('refuses to edit a non-existent file and points to write_file', async () => {
    const result = await executeBuiltinTool('edit_file', {
      path: path.join(tmpDir, 'missing.ts'),
      search: 'a',
      replace: 'b',
    });
    expect(result).toContain('does not exist');
    expect(result).toContain('write_file');
  });

  it('rejects empty search and identical search/replace', async () => {
    const file = makeFile('f.ts', 'content\n');
    expect(await executeBuiltinTool('edit_file', { path: file, search: '', replace: 'x' }))
      .toContain('non-empty');
    expect(await executeBuiltinTool('edit_file', { path: file, search: 'content', replace: 'content' }))
      .toContain('identical');
  });

  it('blocks paths outside the project root', async () => {
    const result = await executeBuiltinTool('edit_file', {
      path: '../outside.txt',
      search: 'a',
      replace: 'b',
    });
    expect(result).toContain('Tool execution failed');
    expect(result).toContain('project root');
  });
});
