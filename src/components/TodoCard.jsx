import React, { useState, useEffect } from 'react';
import { getTodos, saveTodos } from '../hooks/useData';
import { useToast } from '../context/OverlayContext.jsx';
import { uuidV4 } from '../util/uuid.js';
import { formatLocalDate, isPastLocalDate } from '../util/localDate.js';

export default function TodoCard({ borderColor, config, setConfig }) {
  const [todos, setTodos] = useState([]);
  const [newText, setNewText] = useState('');
  const [newDate, setNewDate] = useState('');
  const sec = config?.sections?.todos || {};
  const toast = useToast();

  useEffect(() => { getTodos().then(d => { if (Array.isArray(d)) setTodos(d); }).catch(() => {}); }, []);

  const save = (updated) => {
    setTodos(updated);
    saveTodos(updated).catch(() => {
      toast("Couldn't save the checklist", 'error');
      // Show what the server holds, not the change that didn't save. Re-read
      // rather than revert: with overlapping saves a revert could undo one that worked.
      getTodos().then(d => { if (Array.isArray(d)) setTodos(d); }).catch(() => {});
    });
  };

  const add = () => {
    if (!newText.trim()) return;
    // A random UUID (not Date.now(), which collides when two todos land in the
    // same millisecond). uuidV4 also works on a plain-HTTP origin, where
    // crypto.randomUUID is undefined.
    save([...todos, { id: uuidV4(), text: newText.trim(), done: false, due: newDate || null, created: new Date().toISOString() }]);
    setNewText(''); setNewDate('');
  };

  const toggle = (id) => save(todos.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id) => save(todos.filter(t => t.id !== id));

  // `due` is a local calendar day: new Date('YYYY-MM-DD') would be a day early west of UTC.
  const fmtDate = (d) => formatLocalDate(d) ?? String(d);

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
          <div key={t.id} className={`todo-item ${t.done ? 'done' : ''} ${isPastLocalDate(t.due) && !t.done ? 'overdue' : ''}`}>
            <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} className="todo-check" />
            <span className="todo-text">{t.text}</span>
            {t.due && <span className={`todo-due ${isPastLocalDate(t.due) && !t.done ? 'overdue' : ''}`}>{fmtDate(t.due)}</span>}
            <button onClick={() => remove(t.id)} className="todo-remove">×</button>
          </div>
        ))}
        {todos.length === 0 && <div className="text-muted" style={{ fontSize: '12px', padding: '8px', textAlign: 'center' }}>No tasks yet</div>}
      </div>
    </div>
  );
}
