import type React from "react";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { ToastProvider } from "./Toast";

export const ResetPasswordApp: React.FC = () => (
  <LocaleProvider>
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
  </LocaleProvider>
);
