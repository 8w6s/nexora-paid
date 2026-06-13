import type React from "react";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

export const RefundApp: React.FC = () => (
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
              Refund Policy
            </h1>
            <div className="info-content" style={{ lineHeight: "1.7", color: "var(--ink-soft)" }}>
              <p>
                Please read our refund policy carefully before making a purchase on Nexora. By
                purchasing our digital goods, you acknowledge and agree to this policy.
              </p>

              <h2>1. General No-Refund Rule</h2>
              <p>
                Due to the nature of digital goods (instant delivery of license keys and serial
                codes), all sales on Nexora are final. Once a key or code is generated and displayed
                on-screen or delivered to your email address, we cannot issue a refund, exchange, or
                store credit.
              </p>

              <h2>2. Exceptions</h2>
              <p>We may offer refunds or key replacements under the following strict conditions:</p>
              <ul>
                <li>
                  The delivered key is proven to be invalid, expired, or already used before the
                  time of purchase.
                </li>
                <li>
                  Your payment was confirmed but the system failed to deliver any keys due to stock
                  exhaustion.
                </li>
              </ul>

              <h2>3. Support Requests</h2>
              <p>
                If you encounter an issue with your purchase, please open a support ticket under the{" "}
                <span
                  style={{ cursor: "pointer", color: "var(--brand)", fontWeight: 600 }}
                  onClick={() => {
                    window.location.href = "/tickets";
                  }}
                >
                  Support
                </span>{" "}
                section. Include your Order ID and screenshots
                showing the error. We will investigate and respond within 24 hours.
              </p>
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
