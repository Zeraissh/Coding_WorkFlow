import React, { useState, useEffect } from 'react';
import { Send, Shield, ShieldAlert, CheckCircle2, PlayCircle, Clock } from 'lucide-react';
import './index.css';

interface Task {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed';
  logs: string[];
}

interface ApprovalRequest {
  reqId: string;
  taskId: string;
  toolName: string;
  arguments: any;
}

const API_BASE = 'http://localhost:3000/api';

function App() {
  const [goal, setGoal] = useState('');
  const [requireApproval, setRequireApproval] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<'idle' | 'running' | 'completed'>('idle');
  const [finalResult, setFinalResult] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then(r => r.json())
      .then(d => setRequireApproval(d.requireApproval))
      .catch(console.error);
  }, []);

  const toggleApproval = async () => {
    const newVal = !requireApproval;
    setRequireApproval(newVal);
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requireApproval: newVal })
    });
  };

  const startWorkflow = async () => {
    if (!goal.trim()) return;
    setTasks([]);
    setApprovals([]);
    setFinalResult('');
    setWorkflowStatus('running');
    
    await fetch(`${API_BASE}/workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal })
    });
  };

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/stream`);

    eventSource.addEventListener('taskStarted', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => {
        if (prev.find(t => t.id === data.taskId)) return prev;
        return [...prev, { id: data.taskId, description: data.description, status: 'running', logs: [] }];
      });
    });

    eventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => prev.map(t => {
        if (t.id === data.taskId) {
          return { ...t, logs: [...t.logs, data.message] };
        }
        return t;
      });
    });

    eventSource.addEventListener('taskCompleted', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => prev.map(t => {
        if (t.id === data.taskId) {
          return { ...t, status: 'completed' };
        }
        return t;
      });
    });

    eventSource.addEventListener('approvalRequested', (e) => {
      const data = JSON.parse(e.data);
      setApprovals(prev => [...prev, data]);
    });

    eventSource.addEventListener('workflowCompleted', (e) => {
      const data = JSON.parse(e.data);
      setFinalResult(data.result);
      setWorkflowStatus('completed');
    });

    return () => eventSource.close();
  }, []);

  const handleApprove = async (reqId: string, approved: boolean) => {
    await fetch(`${API_BASE}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reqId, approved })
    });
    setApprovals(prev => prev.filter(a => a.reqId !== reqId));
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Dynamic Workflow</h1>
        <div className="settings">
          {requireApproval ? <Shield size={18} color="var(--success)" /> : <ShieldAlert size={18} color="var(--text-secondary)" />}
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Secure HITL Mode</span>
          <button className={`toggle ${requireApproval ? '' : 'off'}`} onClick={toggleApproval} />
        </div>
      </header>

      <div className="chat-input">
        <input 
          placeholder="What would you like the agents to build today?" 
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && startWorkflow()}
          disabled={workflowStatus === 'running'}
        />
        <button onClick={startWorkflow} disabled={workflowStatus === 'running' || !goal.trim()}>
          {workflowStatus === 'running' ? 'Running...' : <><Send size={18} style={{verticalAlign: 'text-bottom', marginRight: 8}}/> Launch</>}
        </button>
      </div>

      <div className="kanban">
        {tasks.map(task => (
          <div key={task.id} className="task-card">
            <div className="task-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{task.id}</h3>
              <span className={`task-status status-${task.status}`}>
                {task.status === 'running' && <PlayCircle size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                {task.status === 'completed' && <CheckCircle2 size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                {task.status === 'pending' && <Clock size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                {task.status}
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{task.description}</p>
            <div className="task-logs">
              {task.logs.map((log, i) => (
                <div key={i} className="log-entry">{log}</div>
              ))}
            </div>
          </div>
        ))}
        {workflowStatus === 'completed' && (
          <div className="task-card" style={{ gridColumn: '1 / -1', background: 'rgba(59, 130, 246, 0.1)' }}>
            <h3 style={{ margin: 0, color: '#60a5fa' }}>Final Synthesized Output</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
              {finalResult}
            </pre>
          </div>
        )}
      </div>

      {approvals.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b' }}>
              <ShieldAlert /> Approval Required
            </h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Task <strong>{approvals[0].taskId}</strong> is requesting to execute the tool <strong>{approvals[0].toolName}</strong>:
            </p>
            <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', color: '#a78bfa' }}>
              {JSON.stringify(approvals[0].arguments, null, 2)}
            </pre>
            <div className="modal-actions">
              <button className="btn-reject" onClick={() => handleApprove(approvals[0].reqId, false)}>Reject</button>
              <button className="btn-approve" onClick={() => handleApprove(approvals[0].reqId, true)}>Approve Execution</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
