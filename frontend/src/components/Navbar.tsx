import type React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { useCart } from "./CartContext";
import { useConfig } from "./ConfigContext";
import { Icon } from "./Icon";
import { ThemeSwitch } from "./ThemeSwitch";
import { Dropdown } from "./Dropdown";

export const Navbar: React.FC = () => {
  const { cart, setIsCartOpen } = useCart();
  const { user, logout } = useAuth();
  const { isOn, config } = useConfig();
  const totalItems = cart.reduce((t, i) => t + i.quantity, 0);
  const [path, setPath] = useState("/");
  useEffect(() => setPath(window.location.pathname), []);

  const accountOptions = [
    { value: "orders", label: "My Orders", icon: "receipt" as const },
    ...(isOn("tickets") ? [{ value: "support", label: "Support", icon: "ticket" as const }] : []),
    { value: "logout", label: "Sign out", icon: "close" as const },
  ];

  const handleAccountChange = (val: string) => {
    if (val === "orders") {
      window.location.assign("/orders");
    } else if (val === "support") {
      window.location.assign("/tickets");
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

  return (
    <header className="navbar">
      <div className="container nav-inner">
        <a href="/" className="logo">
          <span className="logo-mark">
            <Icon name="key" size={17} />
          </span>
          {renderLogoText()}
        </a>

        <nav className="nav-links">
          <a href="/" className={path === "/" ? "active" : ""}>
            Shop
          </a>
        </nav>

        <div className="nav-right">
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
              Sign in
            </a>
          )}
          <button
            id="cart-trigger-btn"
            className="btn-cart"
            onClick={() => setIsCartOpen(true)}
            aria-label={totalItems > 0 ? `Open cart, ${totalItems} items` : "Open cart, empty"}
          >
            <Icon name="cart" size={19} variant="duotone-regular" />
            <span className="cart-label">Cart</span>
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
        .logo { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 1.2rem; letter-spacing: -.02em; color: var(--ink); }
        .logo .accent { color: var(--brand); }
        .logo-mark { width: 30px; height: 30px; border-radius: 8px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; }
        .nav-links { display: flex; gap: 26px; margin-right: auto; margin-left: 14px; }
        .nav-links a { color: var(--ink-soft); font-size: .92rem; font-weight: 500; padding: 4px 0; border-bottom: 2px solid transparent; transition: color .18s var(--ease), border-color .18s var(--ease); }
        .nav-links a:hover { color: var(--ink); }
        .nav-links a.active { color: var(--brand); border-bottom-color: var(--brand); }
        .nav-right { display: flex; align-items: center; gap: 14px; }
        .btn-link { background: none; border: none; color: var(--brand); font-family: var(--font-sans); font-weight: 600; font-size: .88rem; cursor: pointer; padding: 0; }
        .btn-link:hover { text-decoration: underline; }
        .btn-cart { position: relative; background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink); height: 40px; padding: 0 16px; border-radius: 100px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-family: var(--font-sans); font-weight: 600; font-size: .88rem; transition: border-color .18s var(--ease), color .18s var(--ease); }
        .btn-cart:hover { border-color: var(--brand); color: var(--brand); }
        .cart-badge { position: absolute; top: -7px; right: -7px; background: var(--price); color: #fff; font-size: .68rem; font-weight: 700; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 100px; display: flex; align-items: center; justify-content: center; }
        @media (max-width: 600px) { .cart-label { display: none; } .btn-cart { width: 40px; padding: 0; justify-content: center; } .nav-links { gap: 14px; } .nav-acct-dd { max-width: 110px; } }
      `}</style>
    </header>
  );
};
