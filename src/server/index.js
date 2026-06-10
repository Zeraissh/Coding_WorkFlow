import express from 'express';
import cors from 'cors';
import path from 'path';
import { Orchestrator } from '../core/orchestrator';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';
import { PluginManager } from '../core/pluginManager';
import { getProjectMemory } from '../core/memory';
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
const pendingApprovals = new Map();
let sseClients = [];
let eventHistory = [];
workflowEvents.on('workflowStarted', (data) => broadcastSSE('workflowStarted', data));
workflowEvents.on('taskStarted', (data) => broadcastSSE('taskStarted', data));
workflowEvents.on('log', (data) => broadcastSSE('log', data));
workflowEvents.on('taskCompleted', (data) => broadcastSSE('taskCompleted', data));
workflowEvents.on('workflowCompleted', (data) => broadcastSSE('workflowCompleted', data));
workflowEvents.on('llmUsageReport', (data) => broadcastSSE('llmUsageReport', data));
workflowEvents.on('fileChanged', (data) => broadcastSSE('fileChanged', data));
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
function broadcastSSE(event, data) {
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
    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
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
    let activePlugins = [];
    try {
        const pluginsDir = path.join(process.cwd(), '.workflow', 'plugins');
        if (require('fs').existsSync(pluginsDir)) {
            activePlugins = require('fs').readdirSync(pluginsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
        }
    }
    catch (e) { }
    res.json({
        requireApproval: GlobalConfig.get().requireApproval,
        activePlugins,
        projectMemory: getProjectMemory(),
    });
});
app.post('/api/workflow', async (req, res) => {
    const { goal } = req.body;
    if (!goal)
        return res.status(400).json({ error: 'Goal is required' });
    try {
        const orchestrator = new Orchestrator();
        orchestrator.executeWorkflow(goal).catch(err => {
            broadcastSSE('error', { message: err.message });
        });
        res.json({ status: 'started' });
    }
    catch (err) {
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
    }
    else {
        pending.reject(new Error("User rejected the execution."));
    }
    pendingApprovals.delete(reqId);
    res.json({ status: 'resolved' });
});
export function startServer(port = 3000) {
    return app.listen(port, () => {
        console.log(`Dynamic Workflow Server listening on port ${port}`);
    });
}
//# sourceMappingURL=index.js.map