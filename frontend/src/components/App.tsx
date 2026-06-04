import React, { useEffect, useRef } from "react";
import { CartProvider } from "./CartContext";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { ProductList } from "./ProductList";
import { CartDrawer } from "./CartDrawer";
import { StorefrontHeader } from "./StorefrontHeader";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";
import { fadeRise } from "../lib/motion";

export const App: React.FC = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => { fadeRise(heroRef.current, { duration: 560 }); }, []);
  return (
  <ConfigProvider>
   <ToastProvider>
   <AuthProvider>
    <CartProvider>
      <Navbar />
      <main className="container page">
        <div ref={heroRef}><StorefrontHeader /></div>
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
