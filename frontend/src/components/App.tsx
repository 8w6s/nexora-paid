import type React from "react";
import { useEffect, useRef } from "react";
import { fadeRise } from "../lib/motion";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ProductList } from "./ProductList";
import { SiteFooter } from "./SiteFooter";
import { StorefrontHeader } from "./StorefrontHeader";
import { ToastProvider } from "./Toast";

export const App: React.FC = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fadeRise(heroRef.current, { duration: 560 });
  }, []);
  return (
    <ConfigProvider>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            <Navbar />
            <main className="container page">
              <div ref={heroRef}>
                <StorefrontHeader />
              </div>
              <ProductList />
            </main>
            <SiteFooter />
            <CartDrawer />
            <style>{`
        .page { padding: 22px 20px 0; }
      `}</style>
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </ConfigProvider>
  );
};
