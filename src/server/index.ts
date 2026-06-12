import express from 'express';
import cors from 'cors';
import path from 'path';
import * as fs from 'fs';
import { Orchestrator } from '../core/orchestrator';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';
import { PluginManager } from '../core/pluginManager';
import { getProjectMemory } from '../core/memory';
import { stopWorkflow } from '../core/abort';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static UI dashboard
const uiDistPath = path.join(__dirname, '../../ui/dist');
app.use(express.static(uiDistPath));

// React SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(uiDistPath, 'index.html'));
});

const pendingApprovals = new Map<string, { resolve: () => void, reject: (err: Error) => void }>();
const pendingClarifications = new Map<string, { resolve: (answers: any[]) => void }>();

let sseClients: any[] = [];
let eventHistory: { event: string, data: any }[] = [];

workflowEvents.on('workflowStarted', (data) => broadcastSSE('workflowStarted', data));
workflowEvents.on('taskStarted', (data) => broadcastSSE('taskStarted', data));
workflowEvents.on('log', (data) => broadcastSSE('log', data));
workflowEvents.on('taskCompleted', (data) => broadcastSSE('taskCompleted', data));
workflowEvents.on('workflowCompleted', (data) => broadcastSSE('workflowCompleted', data));
workflowEvents.on('llmUsageReport', (data) => broadcastSSE('llmUsageReport', data));
workflowEvents.on('fileChanged', (data) => broadcastSSE('fileChanged', data));
workflowEvents.on('workflowStopped', (data) => broadcastSSE('workflowStopped', data));
// 流式增量/高频指标不进 eventHistory（量大且回放无意义），只对在线客户端直推
for (const liveEvent of ['assistantDelta', 'focusUpdate']) {
  workflowEvents.on(liveEvent, (data) => {
    sseClients.forEach(client => {
      client.res.write(`event: ${liveEvent}\n`);
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  });
}
workflowEvents.on('approvalRequested', (data) => {
  const reqId = Date.now().toString() + Math.random().toString();
  pendingApprovals.set(reqId, { resolve: data.resolve, reject: data.reject });
  broadcastSSE('approvalRequested', { 
    taskId: data.taskId, 
    toolName: data.toolName, 
    arguments: data.arguments, 
    reqId 
  });
});

workflowEvents.on('clarificationRequested', (data) => {
  const reqId = Date.now().toString() + Math.random().toString();
  pendingClarifications.set(reqId, { resolve: data.resolve });
  broadcastSSE('clarificationRequested', {
    reqId,
    goal: data.goal,
    questions: data.questions,
  });
});

workflowEvents.on('reviewRequested', (data) => {
  const reqId = Date.now().toString() + Math.random().toString();
  pendingApprovals.set(reqId, {
    resolve: () => workflowEvents.emit('dashboardApproval', { taskId: data.taskId, approved: true }),
    reject: () => workflowEvents.emit('dashboardApproval', { taskId: data.taskId, approved: false })
  });
  broadcastSSE('approvalRequested', {
    taskId: data.taskId,
    toolName: 'Final Project Review',
    arguments: {
      diff: data.diff,
      finalOutput: data.finalOutput
    },
    reqId
  });
});

function broadcastSSE(event: string, data: any) {
  eventHistory.push({ event, data });
  sseClients.forEach(client => {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  sseClients.push({ id: clientId, res });

  // Send history to catch up new clients
  eventHistory.forEach(({ event, data }) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  // 心跳：防止代理/浏览器静默断开，客户端据此检测连接健康
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

app.post('/api/clarify', (req, res) => {
  const { reqId, answers } = req.body;
  const pending = pendingClarifications.get(reqId);
  if (!pending) {
    return res.status(404).json({ error: 'Clarification request not found' });
  }
  pending.resolve(Array.isArray(answers) ? answers : []);
  pendingClarifications.delete(reqId);
  res.json({ status: 'resolved' });
});

app.post('/api/stop', (req, res) => {
  const stopped = stopWorkflow(req.body?.reason || 'Stopped from dashboard');
  res.json({ stopped });
});

app.post('/api/config', (req, res) => {
  if (typeof req.body.requireApproval === 'boolean') {
    GlobalConfig.update({ requireApproval: req.body.requireApproval });
  }
  res.json({ requireApproval: GlobalConfig.get().requireApproval });
});

app.get('/api/config', (req, res) => {
  const pluginManager = new PluginManager();
  // Attempt a fast read of plugins
  let activePlugins: string[] = [];
  try {
    const pluginsDir = path.join(process.cwd(), '.workflow', 'plugins');
    if (fs.existsSync(pluginsDir)) {
      activePlugins = fs.readdirSync(pluginsDir).filter((f: string) => f.endsWith('.js') || f.endsWith('.mjs'));
    }
  } catch (e: any) {
    console.warn(`[server] Failed to list plugins: ${e.message}`);
  }

  res.json({
    requireApproval: GlobalConfig.get().requireApproval,
    activePlugins,
    projectMemory: getProjectMemory(),
  });
});

app.post('/api/workflow', async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: 'Goal is required' });

  try {
    const orchestrator = new Orchestrator();
    orchestrator.executeWorkflow(goal).catch(err => {
      broadcastSSE('error', { message: err.message });
    });
    res.json({ status: 'started' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approve', (req, res) => {
  const { reqId, approved } = req.body;
  const pending = pendingApprovals.get(reqId);
  if (!pending) {
    return res.status(404).json({ error: 'Approval request not found' });
  }

  if (approved) {
    pending.resolve();
  } else {
    pending.reject(new Error("User rejected the execution."));
  }
  
  pendingApprovals.delete(reqId);
  res.json({ status: 'resolved' });
});

export function startServer(port: number = 3000) {
  return app.listen(port, () => {
    console.log(`Dynamic Workflow Server listening on port ${port}`);
  });
}
