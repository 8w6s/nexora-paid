import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { ToastProvider } from "./Toast";

// Mirror AuthApp / ForgotPasswordApp so the navbar/cart/theme stay
// consistent — the password-reset confirmation page is just another
// auth surface.
export const ResetPasswordApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <ResetPasswordForm />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);