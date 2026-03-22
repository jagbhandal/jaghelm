import React, { useState } from 'react';

export default function LoginPage({ onLogin, config }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (r.ok && data.token) { onLogin(data.token); }
      else { setError(data.error || 'Login failed'); }
    } catch { setError('Connection failed'); }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src={config?.logoUrl || '/logo.svg'} alt="" style={{ height: 64, marginBottom: 12 }} />
        </div>
        <div className="login-title">{config?.title || 'JAG-NET'}</div>
        <div className="login-sub">{config?.subtitle || 'Infrastructure Dashboard'}</div>
        {error && <div className="login-error">{error}</div>}
        <input className="login-input" type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        <input className="login-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="login-btn" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
      </form>
    </div>
  );
}
