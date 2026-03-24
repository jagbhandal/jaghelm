import React, { useState, useEffect } from 'react';
import { getTodos, saveTodos } from '../hooks/useData';

export default function TodoCard({ borderColor, config, setConfig }) {
  const [todos, setTodos] = useState([]);
  const [newText, setNewText] = useState('');
  const [newDate, setNewDate] = useState('');
  const sec = config?.sections?.todos || {};

  useEffect(() => { getTodos().then(d => { if (Array.isArray(d)) setTodos(d); }).catch(() => {}); }, []);

  const save = (updated) => { setTodos(updated); saveTodos(updated); };

  const add = () => {
    if (!newText.trim()) return;
    save([...todos, { id: Date.now(), text: newText.trim(), done: false, due: newDate || null, created: new Date().toISOString() }]);
    setNewText(''); setNewDate('');
  };

  const toggle = (id) => save(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id) => save(todos.filter(t => t.id !== id));

  const isOverdue = (due) => due && new Date(due) < new Date() && new Date(due).toDateString() !== new Date().toDateString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--amber)'}` }}>
      <div className="section-header grab-handle">
        <div className="section-icon" style={{ background: `${borderColor || 'var(--amber)'}15`, border: `1px solid ${borderColor || 'var(--amber)'}30` }}>
          {sec.icon || '✅'}
        </div>
        <div>
          <div className="section-title">{sec.title || 'Checklist'}</div>
          <div className="section-subtitle">{todos.filter(t => !t.done).length} remaining</div>
        </div>
      </div>

      <div className="todo-input-row">
        <input type="text" value={newText} onChange={e => setNewText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add a task..." className="todo-input" />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="todo-date" />
        <button onClick={add} className="todo-add-btn">+</button>
      </div>

      <div className="todo-list">
        {todos.map(t => (
          <div key={t.id} className={`todo-item ${t.done ? 'done' : ''} ${isOverdue(t.due) && !t.done ? 'overdue' : ''}`}>
            <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} className="todo-check" />
            <span className="todo-text">{t.text}</span>
            {t.due && <span className={`todo-due ${isOverdue(t.due) && !t.done ? 'overdue' : ''}`}>{fmtDate(t.due)}</span>}
            <button onClick={() => remove(t.id)} className="todo-remove">×</button>
          </div>
        ))}
        {todos.length === 0 && <div className="text-muted" style={{ fontSize: '12px', padding: '8px', textAlign: 'center' }}>No tasks yet</div>}
      </div>
    </div>
  );
}
