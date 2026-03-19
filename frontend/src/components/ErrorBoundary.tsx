import React, { Component, ErrorInfo, ReactNode } from 'react';
import { postClientError } from '../api/client';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const ERROR_STYLE = `
  .error-boundary-root {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg, #0a0f14);
    font-family: var(--font-mono, 'Share Tech Mono', 'Courier New', monospace);
    padding: 40px 20px;
  }
  .error-boundary-box {
    max-width: 600px;
    width: 100%;
    text-align: center;
    border: 2px solid var(--color-error, #ff4444);
    padding: 48px 32px;
    border-radius: 4px;
    box-shadow: 0 0 40px rgba(255, 68, 68, 0.25);
    background: var(--bg-card, #0d1a24);
    animation: eb-flicker 4s ease-in-out infinite;
  }
  @keyframes eb-flicker {
    0%, 95%, 100% { opacity: 1; }
    96%           { opacity: 0.85; }
    97%           { opacity: 1; }
    98%           { opacity: 0.9; }
  }
  .error-boundary-h1 {
    font-family: var(--font-vt323, 'VT323', monospace);
    font-size: 80px;
    color: var(--color-error, #ff4444);
    text-shadow: 0 0 20px rgba(255, 68, 68, 0.8);
    margin-bottom: 8px;
    letter-spacing: 6px;
    line-height: 1;
  }
  .error-boundary-code {
    font-size: 12px;
    color: var(--color-error, #ff4444);
    letter-spacing: 2px;
    margin-bottom: 24px;
    opacity: 0.8;
  }
  .error-boundary-message {
    color: var(--text, #a0d4f5);
    font-size: 14px;
    line-height: 1.6;
    margin-bottom: 32px;
    opacity: 0.9;
  }
  .error-boundary-detail {
    color: var(--text-dim, #4a7a9b);
    font-size: 11px;
    margin-bottom: 32px;
    word-break: break-word;
    text-align: left;
    background: var(--bg, #0a0f14);
    padding: 12px;
    border-radius: 4px;
    border: 1px solid var(--border, #0055aa);
    max-height: 120px;
    overflow: auto;
  }
  .error-boundary-btn {
    display: inline-block;
    font-family: var(--font-mono, 'Share Tech Mono', monospace);
    font-size: 13px;
    letter-spacing: 2px;
    color: var(--bg, #0a0f14);
    background: var(--color-error, #ff4444);
    border: none;
    padding: 12px 28px;
    border-radius: 4px;
    cursor: pointer;
    text-transform: uppercase;
    text-decoration: none;
    box-shadow: 0 0 16px rgba(255, 68, 68, 0.5);
    transition: box-shadow 0.2s;
  }
  .error-boundary-btn:hover {
    box-shadow: 0 0 28px rgba(255, 68, 68, 0.9);
  }
  .error-boundary-cursor {
    display: inline-block;
    width: 10px;
    height: 16px;
    background: var(--color-error, #ff4444);
    margin-left: 4px;
    vertical-align: middle;
    animation: eb-blink 1s step-end infinite;
  }
  @keyframes eb-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
`;

export class ErrorBoundary extends Component<Props, State> {
  private styleEl: HTMLStyleElement | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DeepSea ErrorBoundary]', error, info.componentStack);
    // Report to backend (fire-and-forget)
    postClientError({
      message: error.message,
      stack: `${error.stack ?? ''}\n\nComponent Stack:\n${info.componentStack ?? ''}`,
      url: window.location.href,
    });
  }

  componentDidMount() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = ERROR_STYLE;
    document.head.appendChild(this.styleEl);
  }

  componentWillUnmount() {
    this.styleEl?.remove();
  }

  private handleReturn = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="error-boundary-root">
        <div className="error-boundary-box">
          <div className="error-boundary-h1">ERROR!</div>
          <div className="error-boundary-code">CODE: SYS_EXCEPTION_0x69420</div>
          <p className="error-boundary-message">
            An unexpected system exception has occurred.
            <span className="error-boundary-cursor" />
          </p>
          {this.state.error?.message && (
            <pre className="error-boundary-detail">
              {this.state.error.message}
            </pre>
          )}
          <button className="error-boundary-btn" onClick={this.handleReturn}>
            RETURN TO DASHBOARD
          </button>
        </div>
      </div>
    );
  }
}
