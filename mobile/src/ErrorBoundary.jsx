import React from 'react';
import { ErrorScreen } from './ConnectionScreen.jsx';

const reload = () => window.location.reload();

/**
 * Top-level render-crash catcher: a throw anywhere below shows "Something went
 * wrong" + Retry instead of unmounting the tree to a blank WebView. Retry reloads
 * the page (fresh module state, fresh boot); `onRetry` overrides it for tests.
 * React itself reports the caught error to the console.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    if (this.state.crashed) return <ErrorScreen onRetry={this.props.onRetry ?? reload} />;
    return this.props.children;
  }
}
