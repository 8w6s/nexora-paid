import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { MyTickets } from "./MyTickets";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const TicketsApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <MyTickets />
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
