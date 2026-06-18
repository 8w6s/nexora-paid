import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { Navbar } from "./Navbar";
import { ToastProvider } from "./Toast";

// Same provider stack as AuthApp so the navbar/cart/theme behave identically.
// Splitting it out keeps the auth surface componentised — adding a future
// /verify-email page is one more wrapper, not another one-off integration.
export const ForgotPasswordApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <ForgotPasswordForm />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);