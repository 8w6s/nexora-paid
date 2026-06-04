import React from "react";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { AdminDashboard } from "./AdminDashboard";
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
