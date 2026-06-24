/**
 * Global error boundary for React components.
 * Catches crashes in the component tree, logs them, and displays a fallback UI.
 *
 * Usage:
 *   <ErrorBoundary fallback={<GenericError />}>
 *     <YourComponent />
 *   </ErorBoundary>
 */
import type React from "react";
import { Component, type ReactNode } from "react";
import { reportClientError } from "../lib/api";

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
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);

    // Eager-imported reportClientError above (was a lazy import() pre-audit
    // which coupled error-reporting bootstrap to crash timing — fragile).
    try {
      reportClientError(
        error.message,
        "MEDIUM",
        `${error.stack || ""}

Component Stack:\n${errorInfo.componentStack || ""}`,
      );
    } catch {
      // never let reporting throw out of componentDidCatch
    }

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
          <div className="eb-card">
            <h2>Something went wrong</h2>
            <p>An unexpected error occurred. Please try refreshing the page.</p>
            <div className="eb-details">
              <code>{this.state.error?.message || "Unknown error"}</code>
            </div>
            <div className="eb-actions">
              <button className="eb-btn eb-btn-primary" onClick={() => window.location.reload()}>
                Refresh page
              </button>
              <button
                className="eb-btn eb-btn-secondary"
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
          {/* Scoped styles. Pre-audit the inline <style> block defined naked
              .btn / .btn-secondary selectors which collided with the same
              class names elsewhere in the app — when this fallback rendered
              alongside other error-fallback subtrees the global cascade
              briefly restyled unrelated buttons. Now every selector is
              prefixed with .error-boundary-fallback and uses eb- class
              names that no other component owns.

              CSS-var fallbacks (e.g. var(--card-bg, #fff)) keep the card
              legible even if the theme stylesheet failed to load — which
              is exactly when this boundary tends to fire. */}
          <style>{`
            .error-boundary-fallback {
              min-height: 80vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 30px;
              color: var(--text-body, #1f2937);
            }
            .error-boundary-fallback .eb-card {
              background: var(--card-bg, #ffffff);
              border: 1px solid var(--border, #e5e7eb);
              border-radius: var(--radius-lg, 12px);
              padding: 28px 30px;
              max-width: 480px;
              width: 100%;
              box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,.08));
            }
            .error-boundary-fallback .eb-card h2 {
              font-size: 1.5rem;
              margin: 0 0 10px;
              color: var(--text-heading, #111827);
            }
            .error-boundary-fallback .eb-card p {
              color: var(--ink-soft, #4b5563);
              margin: 0 0 20px;
              line-height: 1.5;
            }
            .error-boundary-fallback .eb-details {
              background: var(--badge-bg, #f3f4f6);
              border-left: 3px solid var(--price, #dc2626);
              padding: 10px 12px;
              margin-bottom: 20px;
              font-family: monospace;
              font-size: 0.85rem;
              overflow-x: auto;
            }
            .error-boundary-fallback .eb-actions {
              display: flex;
              gap: 12px;
              flex-wrap: wrap;
            }
            .error-boundary-fallback .eb-btn {
              padding: 10px 16px;
              border-radius: var(--radius-sm, 6px);
              border: 1px solid var(--border, #e5e7eb);
              font-weight: 600;
              cursor: pointer;
            }
            .error-boundary-fallback .eb-btn-primary {
              background: var(--brand, #2563eb);
              color: #fff;
              border-color: transparent;
            }
            .error-boundary-fallback .eb-btn-secondary {
              background: transparent;
              color: var(--text-body, #1f2937);
            }
            .error-boundary-fallback .eb-btn-secondary:hover {
              background: var(--hover-bg, rgba(0,0,0,.04));
            }
            .eb-minimal {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 6px 10px;
              background: var(--price-soft, #fee2e2);
              color: var(--price, #dc2626);
              border-radius: var(--radius-sm, 6px);
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
    <div className="eb-card">
      <h2>{title || "Something went wrong"}</h2>
      <p>{message || "An unexpected error occurred. Please try again."}</p>
      <button className="eb-btn eb-btn-primary" onClick={() => window.location.reload()}>
        Refresh page
      </button>
    </div>
  </div>
);

/** Minimal fallback for small UI areas */
export const MinimalError: React.FC = () => (
  <div className="eb-minimal">
    <span className="icon">⚠️</span>
    <span>Error loading component</span>
  </div>
);
