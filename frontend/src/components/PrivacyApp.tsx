import type React from "react";
import { useT } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { AuthProvider } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

const PrivacyPage: React.FC = () => {
  const { t } = useT();
  return (
    <>
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
          {t("storefront.legal.privacyTitle")}
        </h1>
        <div className="info-content" style={{ lineHeight: "1.7", color: "var(--ink-soft)" }}>
          <p>
            At Nexora, we respect your privacy and are committed to protecting your personal
            data. This privacy policy explains how we collect, use, and store your information.
          </p>

          <h2>1. Information We Collect</h2>
          <p>
            We collect minimal information necessary to process your digital orders and provide
            customer support:
          </p>
          <ul>
            <li>Your email address (to deliver keys and communicate support replies).</li>
            <li>
              Cryptocurrency wallet addresses and transaction IDs associated with payments.
            </li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>
            Your information is used solely for processing orders, generating payment addresses,
            delivering keys, and resolving support tickets. We do not sell, rent, or trade your
            personal data with any third parties.
          </p>

          <h2>3. Cookies</h2>
          <p>
            We use small HTTP cookies to maintain your login session (opaque session
            identifiers) and manage the shopping cart. You can disable cookies in your browser
            settings, but doing so will prevent you from logging in or completing a purchase.
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
    </>
  );
};

export const PrivacyApp: React.FC = () => (
  <LocaleProvider>
    <ConfigProvider>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            <PrivacyPage />
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </ConfigProvider>
  </LocaleProvider>
);