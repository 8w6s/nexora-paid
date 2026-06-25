import type React from "react";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AdminDashboard } from "./AdminDashboard";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { ErrorBoundary, GenericError } from "./ErrorBoundary";
import { ToastProvider } from "./Toast";

export const AdminApp: React.FC<{ activeTabPath?: string }> = ({ activeTabPath }) => (
  <LocaleProvider>
    <ConfigProvider>
      <ToastProvider>
        <AuthProvider>
          <ErrorBoundary
            fallback={
              <GenericError
                title="Admin dashboard error"
                message="An unexpected error occurred in the admin interface. Please refresh or contact support."
              />
            }
          >
            <AdminDashboard activeTabPath={activeTabPath} />
          </ErrorBoundary>
        </AuthProvider>
      </ToastProvider>
    </ConfigProvider>
  </LocaleProvider>
);
