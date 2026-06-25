import type React from "react";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { MyOrders } from "./MyOrders";
import { Navbar } from "./Navbar";
import { OrderDetailView } from "./OrderDetailView";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const OrdersApp: React.FC<{ orderId?: string }> = ({ orderId }) => (
  <LocaleProvider>
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
  </LocaleProvider>
);
