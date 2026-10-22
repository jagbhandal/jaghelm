import React, { useState } from 'react';
import { useTodos } from '../shell/utilities.js';

// Today's board's Checklist panel. Its list is the one every view shares
// (useTodos, #301): the board stays mounted out of sight on other pages, and
// a copy of its own would save over a change made on the Launch page.
export default function TodoCard({ borderColor, config }) {
  const { todos, add: addTodo, toggle, remove } = useTodos();
  const [newText, setNewText] = useState('');
  const [newDate, setNewDate] = useState('');
  const sec = config?.sections?.todos || {};
  const list = todos ?? [];

  const add = () => {
    if (!newText.trim() || todos == null) return;
    addTodo({ text: newText.trim(), due: newDate || null });
    setNewText(''); setNewDate('');
  };

  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--amber)'}` }}>
      <div className="section-header grab-handle">
        <div className="section-icon" style={{ background: `${borderColor || 'var(--amber)'}15`, border: `1px solid ${borderColor || 'var(--amber)'}30` }}>
          {sec.icon || '✅'}
        </div>
        <div>
          <div className="section-title">{sec.title || 'Checklist'}</div>
          <div className="section-subtitle">{list.filter(t => !t.done).length} remaining</div>
        </div>
      </div>

      <div className="todo-input-row">
        <input type="text" value={newText} onChange={e => setNewText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add a task..." className="todo-input" />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="todo-date" />
        <button onClick={add} className="todo-add-btn">+</button>
      </div>

      <div className="todo-list">
        {list.map(t => (
          <div key={t.id} className={`todo-item ${t.done ? 'done' : ''} ${t.overdue ? 'overdue' : ''}`}>
            <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} className="todo-check" />
            <span className="todo-text">{t.text}</span>
            {t.dueLabel && <span className={`todo-due ${t.overdue ? 'overdue' : ''}`}>{t.dueLabel}</span>}
            <button onClick={() => remove(t.id)} className="todo-remove">×</button>
          </div>
        ))}
        {todos != null && list.length === 0 && <div className="muted-text" style={{ fontSize: '12px', padding: '8px', textAlign: 'center' }}>No tasks yet</div>}
      </div>
    </div>
  );
}
