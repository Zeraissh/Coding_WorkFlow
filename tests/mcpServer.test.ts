import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server';
import { KnowledgeStore } from '../src/core/knowledge';
import { SkillRegistry } from '../src/core/skills';

let tmpDir: string;
let client: Client;
let cleanup: (() => Promise<void>) | null = null;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpserver-'));

  const server = createMcpServer(tmpDir);
  client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await cleanup?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP server mode', () => {
  it('exposes the expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['get_eval_summary', 'list_skills', 'query_knowledge', 'run_workflow']);
    const runWorkflow = tools.find(t => t.name === 'run_workflow')!;
    expect(runWorkflow.description).toContain('multi-agent');
    expect(runWorkflow.inputSchema.properties).toHaveProperty('goal');
  });

  it('query_knowledge returns recorded decisions', async () => {
    new KnowledgeStore(tmpDir).addDocument(
      'MCU platform decision',
      'The chosen MCU platform is ESP32 due to the ESPHome ecosystem.',
      'clarify-phase'
    );

    const result: any = await client.callTool({
      name: 'query_knowledge',
      arguments: { query: 'which MCU platform' },
    });
    expect(result.content[0].text).toContain('ESP32');
  });

  it('query_knowledge handles an empty knowledge base', async () => {
    const result: any = await client.callTool({
      name: 'query_knowledge',
      arguments: { query: 'anything' },
    });
    expect(result.content[0].text).toContain('No matching knowledge');
  });

  it('list_skills reports skills with win rates', async () => {
    const registry = new SkillRegistry(tmpDir);
    const skill = registry.createSkill('serial-tasks', 'serial domain pack', ['serial', 'uart'], 'guidance');
    registry.recordOutcome(skill.id, true);
    registry.recordOutcome(skill.id, false);

    const result: any = await client.callTool({ name: 'list_skills', arguments: {} });
    expect(result.content[0].text).toContain('serial-tasks');
    expect(result.content[0].text).toContain('uses: 2');
    expect(result.content[0].text).toContain('50%');
  });

  it('get_eval_summary works with no history', async () => {
    const result: any = await client.callTool({ name: 'get_eval_summary', arguments: {} });
    expect(result.content[0].text).toContain('Total recorded workflows: 0');
  });
});
