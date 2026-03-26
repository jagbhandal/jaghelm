import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', background: '#0d1117', color: '#c9d1d9',
          fontFamily: "'DM Sans', sans-serif", padding: 32, textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 24, maxWidth: 400 }}>
            The dashboard encountered an unexpected error. This is usually temporary.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 500,
            }}
          >
            Reload Dashboard
          </button>
          {this.state.error && (
            <pre style={{
              marginTop: 24, padding: 16, borderRadius: 8,
              background: '#161b22', border: '1px solid #30363d',
              fontSize: 11, color: '#f85149', maxWidth: 500, overflow: 'auto',
              textAlign: 'left', whiteSpace: 'pre-wrap',
            }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
