import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { Checkout } from "./Checkout";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const CheckoutApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <Checkout />
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
