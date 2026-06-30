import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { useAuth } from "./AuthContext";
import { useCart } from "./CartContext";
import { useConfig } from "./ConfigContext";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";

export const Navbar: React.FC = () => {
  const { cart, setIsCartOpen } = useCart();
  const { user, logout } = useAuth();
  const { isOn, config } = useConfig();
  const { t } = useT();
  const totalItems = cart.reduce((tt, i) => tt + i.quantity, 0);
  const [path, setPath] = useState("/");
  useEffect(() => setPath(window.location.pathname), []);

  const accountOptions = useMemo(
    () => [
      ...(user?.role === "admin"
        ? [{ value: "admin", label: t("storefront.account.adminPanel"), icon: "key" as const }]
        : []),
      { value: "orders", label: t("storefront.account.myOrders"), icon: "receipt" as const },
      ...(isOn("tickets")
        ? [{ value: "support", label: t("storefront.account.support"), icon: "ticket" as const }]
        : []),
      { value: "account", label: t("storefront.account.account"), icon: "key" as const },
      { value: "logout", label: t("storefront.account.signOut"), icon: "close" as const },
    ],
    [isOn, user, t],
  );

  const handleAccountChange = (val: string) => {
    if (val === "admin") {
      window.location.assign("/admin");
    } else if (val === "orders") {
      window.location.assign("/orders");
    } else if (val === "support") {
      window.location.assign("/tickets");
    } else if (val === "account") {
      window.location.assign("/account");
    } else if (val === "logout") {
      logout().then(() => window.location.assign("/"));
    }
  };

  const renderLogoText = () => {
    const name = config.storeName || "Nexora";
    if (name.toLowerCase() === "nexora") {
      return (
        <span>
          Nexo<span className="accent">ra</span>
        </span>
      );
    }
    if (name.toLowerCase().endsWith("vn")) {
      return (
        <span>
          {name.slice(0, -2)}
          <span className="accent">{name.slice(-2)}</span>
        </span>
      );
    }
    return <span>{name}</span>;
  };

  const announcement = config.branding?.announcementBar || "";

  return (
    <>
      {announcement && (
        <div className="announcement-bar">{announcement}</div>
      )}
    <header className="navbar">
      <div className="container nav-inner">
        <a href="/" className="logo">
          {config.branding?.logo ? (
            <img src={config.branding.logo} alt={config.storeName} className="logo-img" />
          ) : (
            <span className="logo-mark">
              <img src="/nexora-icon.svg" alt="" className="logo-svg" />
            </span>
          )}
          {renderLogoText()}
        </a>

        <nav className="nav-links">
          <a href="/" className={path === "/" ? "active" : ""}>
            {t("storefront.nav.shop")}
          </a>
        </nav>

        <div className="nav-right">
          <LanguageSwitcher />
          <ThemeSwitch />
          {user ? (
            <Dropdown
              value=""
              onChange={handleAccountChange}
              options={accountOptions}
              placeholder={user.email}
              size="sm"
              className="nav-acct-dd"
              width={180}
            />
          ) : (
            <a href="/login" className="btn-link">
              {t("storefront.auth.signIn")}
            </a>
          )}
          <button
            id="cart-trigger-btn"
            className="btn-cart"
            onClick={() => setIsCartOpen(true)}
            aria-label={
              totalItems > 0
                ? t("storefront.cart.openWithCount", { count: totalItems })
                : t("storefront.cart.openEmpty")
            }
          >
            <Icon name="cart" size={19} variant="duotone-regular" />
            <span className="cart-label">{t("storefront.cart.title")}</span>
            {totalItems > 0 && (
              <span className="cart-badge" aria-hidden="true">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </div>

      <style>{`
        .navbar { position: sticky; top: 0; z-index: 100; background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
        .nav-inner { height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .logo { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 1.2rem; letter-spacing: -.02em; color: var(--ink); text-decoration: none; }
        .logo .accent { color: var(--brand); }
        .logo-mark { width: 30px; height: 30px; border-radius: 8px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .logo-svg { width: 20px; height: 20px; filter: brightness(0) invert(1); }
        .logo-img { width: 32px; height: 32px; object-fit: contain; border-radius: 6px; }
        .nav-links { display: flex; gap: 26px; margin-right: auto; margin-left: 14px; }
        .nav-links a { color: var(--ink-soft); font-size: .92rem; font-weight: 500; padding: 4px 0; border-bottom: 2px solid transparent; text-decoration: none; transition: color .18s var(--ease), border-color .18s var(--ease); }
        .nav-links a:hover { color: var(--ink); }
        .nav-links a.active { color: var(--brand); border-bottom-color: var(--brand); }
        .nav-right { display: flex; align-items: center; gap: 14px; }
        .btn-link { color: var(--brand); font-family: var(--font-sans); font-weight: 600; font-size: .88rem; text-decoration: none; }
        .btn-link:hover { text-decoration: underline; }
        .btn-cart { position: relative; background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink); height: 40px; padding: 0 16px; border-radius: 100px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-family: var(--font-sans); font-weight: 600; font-size: .88rem; transition: border-color .18s var(--ease), color .18s var(--ease); }
        .btn-cart:hover { border-color: var(--brand); color: var(--brand); }
        .cart-badge { position: absolute; top: -7px; right: -7px; background: var(--price); color: #fff; font-size: .68rem; font-weight: 700; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 100px; display: flex; align-items: center; justify-content: center; }
        @media (max-width: 600px) { .nav-inner { gap: 10px; } .nav-links { display: none; } .nav-right { gap: 8px; min-width: 0; } .cart-label { display: none; } .btn-cart { width: 40px; padding: 0; justify-content: center; flex: 0 0 40px; } .nav-acct-dd { max-width: 110px; } }
      .announcement-bar { background: var(--brand, #3b82f6); color: #fff; text-align: center; padding: 8px 16px; font-size: .82rem; font-weight: 500; letter-spacing: .01em; }
      `}</style>
    </header>
    </>
  );
};
