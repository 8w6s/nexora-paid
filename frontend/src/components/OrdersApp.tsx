import React from "react";
import { CartProvider } from "./CartContext";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { CartDrawer } from "./CartDrawer";
import { MyOrders } from "./MyOrders";
import { OrderDetailView } from "./OrderDetailView";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const OrdersApp: React.FC<{ orderId?: string }> = ({ orderId }) => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          {orderId ? <OrderDetailView orderId={orderId} /> : <MyOrders />}
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
