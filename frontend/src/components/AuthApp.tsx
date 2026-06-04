import React from "react";
import { CartProvider } from "./CartContext";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { CartDrawer } from "./CartDrawer";
import { AuthForm } from "./AuthForm";
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
