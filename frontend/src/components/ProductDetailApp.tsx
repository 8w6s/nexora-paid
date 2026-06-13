import type React from "react";
import type { Product } from "../lib/api";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ProductDetail } from "./ProductDetail";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const ProductDetailApp: React.FC<{ product: Product }> = ({ product }) => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <ProductDetail product={product} />
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
