import { useState, useEffect, useRef } from 'react';
import { Send, Shield, ShieldAlert, CheckCircle2, PlayCircle, Clock, OctagonX, Wifi, WifiOff } from 'lucide-react';
import './index.css';

interface Task {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed';
  logs: string[];
  tokensSpent?: number;
  filesChanged?: string[];
  streamText?: string;
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
  const [tokensSpent, setTokensSpent] = useState<number | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<string[]>([]);
  const [memory, setMemory] = useState<string>('');
  const [connection, setConnection] = useState<'connected' | 'reconnecting'>('reconnecting');
  const reconnectAttempt = useRef(0);

  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then(r => r.json())
      .then(d => {
        setRequireApproval(d.requireApproval);
        setPlugins(d.activePlugins || []);
        setMemory(d.projectMemory || '');
      })
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
    setFinalResult('');
    setTokensSpent(null);
    setDiffText(null);
    setTasks([{ id: 'orchestrator', description: 'Planning and Orchestrating Workflow...', status: 'running', logs: [] }]);
    setWorkflowStatus('running');
    
    await fetch(`${API_BASE}/workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal })
    });
  };

  const stopWorkflow = async () => {
    await fetch(`${API_BASE}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Stopped from dashboard' })
    });
  };

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      eventSource = new EventSource(`${API_BASE}/stream`);
      attachListeners(eventSource);

      eventSource.onopen = () => {
        reconnectAttempt.current = 0;
        setConnection('connected');
        // 服务端会重放完整事件历史，清空后由重放重建，避免日志重复
        setTasks([]);
      };

      eventSource.onerror = () => {
        setConnection('reconnecting');
        // EventSource 自带重连只覆盖部分场景；CLOSED 状态需要手动指数退避重建
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt.current));
          reconnectAttempt.current += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    };

    const attachListeners = (es: EventSource) => {
    es.addEventListener('taskStarted', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => {
        if (prev.find(t => t.id === data.taskId)) return prev;
        return [...prev, { id: data.taskId, description: data.description, status: 'running', logs: [] }];
      });
    });

    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => {
        const exists = prev.find(t => t.id === data.taskId);
        if (exists) {
          return prev.map(t => t.id === data.taskId ? { ...t, logs: [...t.logs, data.message] } : t);
        } else {
          return [...prev, { id: data.taskId, description: data.taskId === 'orchestrator' ? 'Orchestrating Workflow...' : 'Executing Task', status: 'running', logs: [data.message] }];
        }
      });
    });

    es.addEventListener('taskCompleted', (e) => {
      const data = JSON.parse(e.data);
      setTasks(prev => prev.map(t => {
        if (t.id === data.taskId) {
          return { ...t, status: 'completed' };
        }
        return t;
      }));
    });

    es.addEventListener('llmUsageReport', (e) => {
      const data = JSON.parse(e.data);
      if (data.taskId) {
        setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, tokensSpent: data.tokens } : t));
      }
    });

    es.addEventListener('fileChanged', (e) => {
      const data = JSON.parse(e.data);
      if (data.taskId) {
        setTasks(prev => prev.map(t => {
          if (t.id === data.taskId) {
            const files = t.filesChanged || [];
            if (!files.includes(data.file)) {
              return { ...t, filesChanged: [...files, data.file] };
            }
          }
          return t;
        }));
      }
    });

    es.addEventListener('error', (e: any) => {
      if (e.data) {
        const data = JSON.parse(e.data);
        setFinalResult(`Error: ${data.message}`);
        setWorkflowStatus('completed');
      }
    });

    es.addEventListener('approvalRequested', (e) => {
      const data = JSON.parse(e.data);
      setApprovals(prev => [...prev, data]);
    });

    es.addEventListener('workflowCompleted', (e) => {
      const data = JSON.parse(e.data);
      setFinalResult(data.result);
      if (data.tokensSpent) setTokensSpent(data.tokensSpent);
      if (data.diff) setDiffText(data.diff);
      setWorkflowStatus('completed');
    });

    es.addEventListener('workflowStopped', (e) => {
      const data = JSON.parse(e.data);
      setFinalResult(`🛑 Workflow stopped: ${data.reason}. Progress saved — resumable via CLI.`);
      setWorkflowStatus('completed');
    });

    es.addEventListener('assistantDelta', (e) => {
      const data = JSON.parse(e.data);
      const key = data.taskId || data.agentId;
      if (!key) return;
      setTasks(prev => prev.map(t => {
        if (t.id !== key) return t;
        // 只保留尾部 2000 字符，避免长流式输出撑爆 DOM
        const merged = ((t.streamText || '') + data.text).slice(-2000);
        return { ...t, streamText: merged };
      }));
    });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
    };
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
          {connection === 'connected'
            ? <Wifi size={18} color="var(--success)" />
            : <WifiOff size={18} color="#f59e0b" />}
          <span style={{ fontSize: '0.85rem', color: connection === 'connected' ? 'var(--text-secondary)' : '#f59e0b' }}>
            {connection === 'connected' ? 'Live' : 'Reconnecting…'}
          </span>
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
        {workflowStatus === 'running' && (
          <button
            onClick={stopWorkflow}
            style={{ background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '8px', padding: '0 1rem', fontWeight: 600 }}
            title="Emergency stop: aborts after the current batch; progress is saved and resumable"
          >
            <OctagonX size={18} style={{verticalAlign: 'text-bottom', marginRight: 6}}/> Stop
          </button>
        )}
      </div>

      <div className="main-layout" style={{ display: 'flex', gap: '2rem', padding: '0 2rem' }}>
        <div className="sidebar" style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="panel">
            <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🔌 Active Plugins</h3>
            {plugins.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>No plugins loaded</p> : (
              <ul style={{ paddingLeft: '1.5rem', margin: 0, color: 'var(--text-primary)' }}>
                {plugins.map(p => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3 style={{ margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🧠 Project Memory</h3>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {memory || 'No lessons learned yet.'}
            </pre>
          </div>
        </div>

        <div className="kanban" style={{ flex: '1' }}>
          {tasks.map(task => (
          <div key={task.id} className="task-card">
            <div className="task-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{task.id}</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {task.tokensSpent !== undefined && (
                  <span style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '2px 8px', borderRadius: '12px' }}>
                    {task.tokensSpent.toLocaleString()} Tokens
                  </span>
                )}
                <span className={`task-status status-${task.status}`}>
                  {task.status === 'running' && <PlayCircle size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                  {task.status === 'completed' && <CheckCircle2 size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                  {task.status === 'pending' && <Clock size={14} style={{verticalAlign: 'text-bottom', marginRight: 4}}/>}
                  {task.status}
                </span>
              </div>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{task.description}</p>
            
            {task.filesChanged && task.filesChanged.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {task.filesChanged.map(f => (
                  <span key={f} style={{ fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', padding: '2px 6px', borderRadius: '4px' }}>
                    📝 {f}
                  </span>
                ))}
              </div>
            )}

            {task.streamText && task.status === 'running' && (
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: '#a78bfa', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px', maxHeight: '120px', overflowY: 'auto', marginTop: '0.5rem' }}>
                {task.streamText}
              </pre>
            )}

            <div className="task-logs">
              {task.logs.map((log, i) => {
                const isToolCall = log.includes('[Tool Call]');
                const isToolResult = log.includes('[Tool Result]');
                const className = `log-entry ${isToolCall ? 'log-tool-call' : ''} ${isToolResult ? 'log-tool-result' : ''}`;
                return <div key={i} className={className}>{log}</div>;
              })}
            </div>
          </div>
        ))}
        {workflowStatus === 'completed' && (
          <div className="task-card" style={{ gridColumn: '1 / -1', background: 'rgba(59, 130, 246, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, color: '#60a5fa' }}>🎉 Final Synthesized Output</h3>
              {tokensSpent !== null && (
                <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600 }}>
                  Tokens Consumed: {tokensSpent.toLocaleString()}
                </span>
              )}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--text-primary)', marginBottom: '1rem' }}>
              {finalResult}
            </pre>
            
            {diffText && (
              <>
                <h4 style={{ margin: '1rem 0 0.5rem', color: '#a78bfa' }}>File Modifications (Diff)</h4>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: '#cbd5e1', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  {diffText}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
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
