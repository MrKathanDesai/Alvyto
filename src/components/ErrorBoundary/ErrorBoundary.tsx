'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught render error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-msg" role="alert" style={{ padding: '20px', margin: '10px 0' }}>
          <h3>Component Error</h3>
          <p><strong>Your recording is still safe.</strong> Please do not close the tab.</p>
          <details style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', marginTop: '10px' }}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '10px', padding: '6px 12px', background: 'var(--red)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
          >
            Retry Render
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
