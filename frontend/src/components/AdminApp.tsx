import type React from "react";
import { AdminDashboard } from "./AdminDashboard";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { ToastProvider } from "./Toast";

export const AdminApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <AdminDashboard />
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
