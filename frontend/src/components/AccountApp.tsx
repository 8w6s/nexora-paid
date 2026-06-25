import type React from "react";
import { useEffect } from "react";
import { useT } from "../i18n";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { Account2FACard } from "./Account2FACard";
import { AccountDangerCard } from "./AccountDangerCard";
import { AccountEmailCard } from "./AccountEmailCard";
import { AccountPasswordCard } from "./AccountPasswordCard";
import { AccountSessionsCard } from "./AccountSessionsCard";
import { AuthProvider, useAuth } from "./AuthContext";
import { CartProvider } from "./CartContext";
import { CartDrawer } from "./CartDrawer";
import { ConfigProvider } from "./ConfigContext";
import { Navbar } from "./Navbar";
import { SiteFooter } from "./SiteFooter";
import { ToastProvider } from "./Toast";

// Inner shell that lives inside the provider stack so it can read the
// session via useAuth(). Bounces logged-out visitors to /login with a
// redirect back to /account so they land here after re-auth.
const AccountInner: React.FC = () => {
  const { user, loading } = useAuth();
  const { t } = useT();

  useEffect(() => {
    if (!loading && !user && typeof window !== "undefined") {
      const next = encodeURIComponent("/account");
      window.location.assign(`/login?redirect=${next}`);
    }
  }, [user, loading]);

  if (loading || !user) {
    return (
      <main className="container account-shell">
        <p style={{ color: "var(--ink-soft)" }}>{t("common.loading")}</p>
      </main>
    );
  }

  return (
    <main className="container account-shell">
      <header className="account-head">
        <h1>{t("storefront.account.title")}</h1>
        <p className="sub">
          {t("storefront.account.signedInAsLabel")} <strong>{user.email}</strong>.
        </p>
      </header>

      <div className="account-grid">
        <AccountEmailCard />
        <AccountPasswordCard />
        <Account2FACard />
        <AccountSessionsCard />
        <AccountDangerCard />
      </div>

      <style>{`
        .account-shell { padding: 36px 20px 60px; max-width: 720px; margin: 0 auto; }
        .account-head { margin-bottom: 24px; }
        .account-head h1 { font-size: 1.6rem; margin-bottom: 6px; }
        .account-head .sub { color: var(--ink-soft); font-size: .92rem; }
        .account-grid { display: flex; flex-direction: column; gap: 20px; }
      `}</style>
    </main>
  );
};

// Same provider stack as the rest of the customer-facing surfaces so
// theme / cart / auth all behave consistently when navigating into the
// account page from anywhere in the storefront.
export const AccountApp: React.FC = () => (
  <LocaleProvider>
    <ConfigProvider>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            <Navbar />
            <AccountInner />
            <SiteFooter />
            <CartDrawer />
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </ConfigProvider>
  </LocaleProvider>
);
