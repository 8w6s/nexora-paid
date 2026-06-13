import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const InfoPage: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <main
            className="container info-page"
            style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto" }}
          >
            <h1
              style={{
                fontSize: "2rem",
                marginBottom: "24px",
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              {title}
            </h1>
            <div className="info-content" style={{ lineHeight: "1.7", color: "var(--ink-soft)" }}>
              {children}
            </div>
          </main>
          <SiteFooter />
          <CartDrawer />
          <style>{`
            .info-content h2 { font-size: 1.35rem; font-weight: 700; color: var(--ink); margin: 28px 0 12px; }
            .info-content p { margin-bottom: 16px; }
            .info-content ul { margin: 0 0 16px 20px; }
            .info-content li { margin-bottom: 6px; }
          `}</style>
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  </ConfigProvider>
);
