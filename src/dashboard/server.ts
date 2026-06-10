import express from 'express';
import * as path from 'path';
import { workflowEvents } from '../core/events';

export class DashboardServer {
  private app: express.Application;
  private clients: express.Response[] = [];
  private history: any[] = [];

  constructor() {
    this.app = express();
    this.app.use(express.json());
    
    // Serve static files
    const publicPath = path.join(process.cwd(), 'src', 'dashboard', 'public');
    this.app.use(express.static(publicPath));

    // SSE Endpoint
    this.app.get('/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders(); // flush the headers to establish SSE

      this.clients.push(res);

      // Send history so new clients get caught up
      for (const event of this.history) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      req.on('close', () => {
        this.clients = this.clients.filter(c => c !== res);
      });
    });

    // Handle Human-in-the-Loop Dashboard Approvals
    this.app.post('/api/approve', async (req, res) => {
      const { taskId, approved, feedback } = req.body;
      
      if (!approved && feedback) {
        // Run rule extraction in the background so we don't block the UI
        this.extractAndSaveRule(feedback).catch(console.error);
      }
      
      workflowEvents.emit('dashboardApproval', { taskId, approved });
      res.json({ success: true });
    });

    this.setupListeners();
  }

  private async extractAndSaveRule(feedback: string) {
    try {
      workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Extracting project rule from feedback...' });
      const { askLLM } = await import('../llm/client');
      const { appendProjectMemory } = await import('../core/memory');
      
      const prompt = `You are a rule extraction expert. The user rejected a code change with the following feedback:\n"${feedback}"\n\nPlease extract a concise, generalized software engineering or styling rule from this feedback that should be followed in the future. Return ONLY the rule text, nothing else.`;
      const response = await askLLM(prompt, [{ role: 'user', content: prompt }]);
      const textBlock = response.content.find(block => block.type === 'text') as any;
      if (textBlock && textBlock.text) {
        let rule = textBlock.text.trim();
        rule = rule.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        appendProjectMemory(rule);
        workflowEvents.emit('log', { taskId: 'orchestrator', message: `Saved new project rule: ${rule}` });
      }
    } catch (err) {
      console.error('Failed to extract rule:', err);
    }
  }

  private broadcast(type: string, payload: any) {
    const event = { type, payload, timestamp: new Date().toISOString() };
    this.history.push(event);
    const dataString = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(dataString);
    }
  }

  private setupListeners() {
    workflowEvents.on('workflowStarted', (data) => this.broadcast('workflowStarted', data));
    workflowEvents.on('taskStarted', (data) => this.broadcast('taskStarted', data));
    workflowEvents.on('taskCompleted', (data) => this.broadcast('taskCompleted', data));
    workflowEvents.on('workflowCompleted', (data) => this.broadcast('workflowCompleted', data));
    workflowEvents.on('log', (data) => this.broadcast('log', data));
  }

  public start(port: number = 3000) {
    this.app.listen(port, () => {
      // Intentionally not logging to avoid cluttering the CLI,
      // but the user can open http://localhost:3000
    });
  }
}
