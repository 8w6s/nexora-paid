/**
 * Global error boundary for React components.
 * Catches crashes in the component tree, logs them, and displays a fallback UI.
 *
 * Usage:
 *   <ErrorBoundary fallback={<GenericError />}>
 *     <YourComponent />
 *   </ErrorBoundary>
 */
import type React from "react";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Fallback component when error occurs */
  fallback?: ReactNode;
  /** Called when error is caught (for logging) */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);

    // Auto-report React UI crashes to the backend
    import("../lib/api")
      .then(({ reportClientError }) => {
        reportClientError(
          error.message,
          "MEDIUM",
          `${error.stack || ""}\n\nComponent Stack:\n${errorInfo.componentStack || ""}`,
        );
      })
      .catch(() => {});

    // Call custom handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="error-boundary-fallback">
          <div className="error-card">
            <h2>Something went wrong</h2>
            <p>An unexpected error occurred. Please try refreshing the page.</p>
            <div className="error-details">
              <code>{this.state.error?.message || "Unknown error"}</code>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => window.location.reload()}>
                Refresh page
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  if (window.location.pathname.includes("/admin")) {
                    window.location.href = "/admin";
                  } else {
                    window.location.href = "/";
                  }
                }}
              >
                Go to {window.location.pathname.includes("/admin") ? "Admin" : "Home"}
              </button>
            </div>
          </div>
          <style>{`
            .error-boundary-fallback {
              min-height: 80vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 30px;
            }
            .error-card {
              background: var(--card-bg);
              border: 1px solid var(--border);
              border-radius: var(--radius-lg);
              padding: 28px 30px;
              max-width: 480px;
              width: 100%;
              box-shadow: var(--shadow-md);
            }
            .error-card h2 {
              font-size: 1.5rem;
              margin-bottom: 10px;
              color: var(--text-heading);
            }
            .error-card p {
              color: var(--ink-soft);
              margin-bottom: 20px;
              line-height: 1.5;
            }
            .error-details {
              background: var(--badge-bg);
              border-left: 3px solid var(--price);
              padding: 10px 12px;
              margin-bottom: 20px;
              font-family: monospace;
              font-size: 0.85rem;
              overflow-x: auto;
            }
            .actions {
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
            }
            .btn-secondary {
              background: transparent;
              border: 1px solid var(--border);
              color: var(--text-body);
            }
            .btn-secondary:hover {
              background: var(--hover-bg);
            }
            .minimal-error {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 6px 10px;
              background: var(--price-soft);
              color: var(--price);
              border-radius: var(--radius-sm);
              font-size: 0.82rem;
            }
          `}</style>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Reusable fallback UI for errors */
export const GenericError: React.FC<{ title?: string; message?: string }> = ({
  title,
  message,
}) => (
  <div className="error-boundary-fallback">
    <div className="error-card">
      <h2>{title || "Something went wrong"}</h2>
      <p>{message || "An unexpected error occurred. Please try again."}</p>
      <button className="btn" onClick={() => window.location.reload()}>
        Refresh page
      </button>
    </div>
  </div>
);

/** Minimal fallback for small UI areas */
export const MinimalError: React.FC = () => (
  <div className="minimal-error">
    <span className="icon">⚠️</span>
    <span>Error loading component</span>
  </div>
);
