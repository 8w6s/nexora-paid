import React from "react";
import { CartProvider } from "./CartContext";
import { AuthProvider } from "./AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { CartDrawer } from "./CartDrawer";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const TermsApp: React.FC = () => (
  <ConfigProvider>
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <main className="container info-page" style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto" }}>
            <h1 style={{ fontSize: "2rem", marginBottom: "24px", fontWeight: 700, color: "var(--ink)" }}>Terms of Service</h1>
            <div className="info-content" style={{ lineHeight: "1.7", color: "var(--ink-soft)" }}>
              <p>Welcome to Nexora. By using our website and purchasing our digital goods, you agree to comply with and be bound by the following terms and conditions.</p>
              
              <h2>1. Digital Goods & Instant Delivery</h2>
              <p>All items sold on Nexora are digital goods (such as software license keys, premium accounts, and digital codes). Upon confirmed payment on the Litecoin blockchain, keys are delivered instantly on-screen and to your designated email address.</p>
              
              <h2>2. Payment & Cryptocurrencies</h2>
              <p>We accept payments via Litecoin (LTC). You must send the exact LTC amount specified in the checkout process to the provided wallet address. The exchange rate is locked for a limited time (typically 15 minutes). Nexora is not responsible for underpayments, transaction fee deductions, or delays caused by blockchain network congestion.</p>
              
              <h2>3. Usage & Account Responsibility</h2>
              <p>You are responsible for keeping your purchase keys, serial codes, and account details private. Nexora does not store copies of your keys indefinitely, and once a key is delivered, it is the buyer's responsibility to store it securely.</p>
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
