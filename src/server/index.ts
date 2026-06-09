import express from 'express';
import cors from 'cors';
import { Orchestrator } from '../core/orchestrator';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';

const app = express();
app.use(cors());
app.use(express.json());

const pendingApprovals = new Map<string, { resolve: () => void, reject: (err: Error) => void }>();

let sseClients: any[] = [];

workflowEvents.on('workflowStarted', (data) => broadcastSSE('workflowStarted', data));
workflowEvents.on('taskStarted', (data) => broadcastSSE('taskStarted', data));
workflowEvents.on('log', (data) => broadcastSSE('log', data));
workflowEvents.on('taskCompleted', (data) => broadcastSSE('taskCompleted', data));
workflowEvents.on('workflowCompleted', (data) => broadcastSSE('workflowCompleted', data));
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

function broadcastSSE(event: string, data: any) {
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

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

app.post('/api/config', (req, res) => {
  if (typeof req.body.requireApproval === 'boolean') {
    GlobalConfig.requireApproval = req.body.requireApproval;
  }
  res.json({ requireApproval: GlobalConfig.requireApproval });
});

app.get('/api/config', (req, res) => {
  res.json({ requireApproval: GlobalConfig.requireApproval });
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Dynamic Workflow Server listening on port ${PORT}`);
});
