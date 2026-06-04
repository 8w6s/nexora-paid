import React from "react";
import { CartProvider } from "./CartContext";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ProductDetail } from "./ProductDetail";
import { CartDrawer } from "./CartDrawer";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";
import type { Product } from "../lib/api";

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
