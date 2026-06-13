import type React from "react";
import { AuthProvider } from "./AuthContext";
import { AuthForm } from "./AuthForm";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ToastProvider } from "./Toast";

export const AuthApp: React.FC<{ mode: "login" | "register" }> = ({ mode }) => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <AuthForm mode={mode} />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
