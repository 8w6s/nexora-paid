import type React from "react";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { Navbar } from "./Navbar";
import { ToastProvider } from "./Toast";

export const ForgotPasswordApp: React.FC = () => (
  <LocaleProvider>
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
  </LocaleProvider>
);