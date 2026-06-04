import React, { useState } from "react";
import { useAuth } from "./AuthContext";
import { useConfig } from "./ConfigContext";
import { Icon } from "./Icon";
import { ThemeSwitch } from "./ThemeSwitch";
import { AdminLogin } from "./admin/AdminLogin";
import { AdminOverview } from "./admin/AdminOverview";
import { AdminProducts } from "./admin/AdminProducts";
import { AdminOrders } from "./admin/AdminOrders";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminFeatures } from "./admin/AdminFeatures";
import { AdminPayments } from "./admin/AdminPayments";
import { AdminCustomers } from "./admin/AdminCustomers";
import { AdminCoupons } from "./admin/AdminCoupons";
import { AdminReviews } from "./admin/AdminReviews";
import { AdminTickets } from "./admin/AdminTickets";
import { AdminActivity } from "./admin/AdminActivity";
import { AdminCategories } from "./admin/AdminCategories";

type Tab =
  | "overview" | "products" | "categories" | "orders" | "customers" | "coupons"
  | "reviews" | "tickets" | "payments" | "features" | "activity" | "settings";

// SellAuth-style grouped sidebar nav. Order matters — Overview standalone at top, then themed groups.
const NAV_GROUPS: { title?: string; items: { key: Tab; label: string; icon: any }[] }[] = [
  { items: [{ key: "overview", label: "Dashboard", icon: "home" }] },
  { title: "Catalog", items: [
    { key: "products", label: "Products", icon: "box" },
    { key: "categories", label: "Categories", icon: "folder" },
    { key: "coupons", label: "Coupons", icon: "tag" },
  ]},
  { title: "Sales", items: [
    { key: "orders", label: "Orders", icon: "receipt" },
    { key: "customers", label: "Customers", icon: "users" },
    { key: "reviews", label: "Reviews", icon: "star" },
  ]},
  { title: "Support", items: [
    { key: "tickets", label: "Tickets", icon: "ticket" },
  ]},
  { title: "Storefront", items: [
    { key: "payments", label: "Payments", icon: "credit-card" },
    { key: "features", label: "Features", icon: "bolt" },
  ]},
  { title: "System", items: [
    { key: "activity", label: "Activity", icon: "activity" },
    { key: "settings", label: "Settings", icon: "settings" },
  ]},
];

export const AdminDashboard: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const { config, theme } = useConfig();
  const [tab, setTab] = useState<Tab>("overview");
  const [navOpen, setNavOpen] = useState(false); // mobile drawer

  if (loading) return <div className="adm-loading"><Icon name="spinner" size={28} className="is-spinning" /></div>;
  if (!user || user.role !== "admin")
    return (
      <>
        <AdminLogin />
        {user && user.role !== "admin" && <p className="adm-denied">Signed in as {user.email} — not an admin account.</p>}
      </>
    );

  const activeLabel = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === tab)?.label ?? "Admin";

  return (
    <div className="adm-shell">
      {/* Mobile topbar — only visible <900px */}
      <div className="adm-topbar">
        <button className="adm-burger" onClick={() => setNavOpen((o) => !o)} aria-label="Open menu"><Icon name={navOpen ? "close" : "bell"} size={18} /></button>
        <span className="adm-topbar-title">{activeLabel}</span>
      </div>

      <aside className={`adm-side ${navOpen ? "open" : ""}`}>
        <div className="adm-brand">
          <span className="adm-logo-mark"><Icon name="key" size={16} /></span>
          <span className="adm-logo-text">
            <span className="adm-logo-name">Nexora</span>
            <span className="adm-tag">Admin</span>
            <span className="adm-tag-free">FREE</span>
          </span>
        </div>

        <a href="/" className="adm-store" title="Open storefront">
          <span className="adm-store-icon"><Icon name="box" size={14} /></span>
          <span className="adm-store-name">{config.storeName ?? "Store"}</span>
          <span className="adm-store-link"><Icon name="arrow-right" size={12} /></span>
        </a>

        <nav className="adm-nav">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className="adm-group">
              {g.title && <div className="adm-group-title">{g.title}</div>}
              {g.items.map((item) => (
                <button
                  key={item.key}
                  className={`adm-link ${tab === item.key ? "active" : ""}`}
                  onClick={() => { setTab(item.key); setNavOpen(false); }}
                >
                  <Icon name={item.icon} size={15} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="adm-side-foot">
          <div className="adm-theme"><ThemeSwitch /><span>{theme === "dark" ? "Dark mode" : "Light mode"}</span></div>
          <div className="adm-account">
            <span className="adm-avatar">{user.email[0]?.toUpperCase() ?? "A"}</span>
            <span className="adm-email" title={user.email}>{user.email}</span>
            <button className="adm-signout" onClick={() => logout().then(() => window.location.reload())} aria-label="Sign out" title="Sign out"><Icon name="close" size={14} /></button>
          </div>
        </div>
      </aside>

      {/* Backdrop for the mobile drawer */}
      {navOpen && <div className="adm-backdrop" onClick={() => setNavOpen(false)} />}

      <main className="adm-main">
        <header className="adm-pagehead">
          <h1>{activeLabel}</h1>
        </header>
        <div className="adm-body">
          {tab === "overview" && <AdminOverview />}
          {tab === "products" && <AdminProducts />}
          {tab === "categories" && <AdminCategories />}
          {tab === "orders" && <AdminOrders />}
          {tab === "customers" && <AdminCustomers />}
          {tab === "coupons" && <AdminCoupons />}
          {tab === "reviews" && <AdminReviews />}
          {tab === "tickets" && <AdminTickets />}
          {tab === "payments" && <AdminPayments />}
          {tab === "features" && <AdminFeatures />}
          {tab === "activity" && <AdminActivity />}
          {tab === "settings" && <AdminSettings />}
        </div>
      </main>

      <style>{`
        .adm-shell { display: flex; min-height: 100vh; background: var(--bg); }
        .adm-loading { padding: 80px; text-align: center; color: var(--ink-soft); }
        .adm-denied { text-align: center; color: var(--price); margin-top: 12px; }

        /* ───── Sidebar ───── */
        .adm-side { position: sticky; top: 0; align-self: flex-start; width: 244px; height: 100vh; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 16px 12px; gap: 14px; overflow-y: auto; z-index: 50; }
        .adm-brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px; }
        .adm-logo-mark { width: 30px; height: 30px; border-radius: 8px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        /* Logo cluster — flex row keeps "Nexora · Admin · FREE" on one baseline.
           Previously each label was a plain inline span; when the sidebar narrowed,
           the FREE chip wrapped onto a new line under "Admin". flex-wrap:nowrap
           prevents that, and min-width:0 lets the brand name truncate first. */
        .adm-logo-text { font-weight: 700; font-size: 1.05rem; color: var(--ink); letter-spacing: -.01em; display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0; }
        .adm-logo-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .adm-logo-text .accent { color: var(--brand); }
        .adm-tag { font-size: .68rem; font-weight: 600; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .08em; white-space: nowrap; flex-shrink: 0; }
        .adm-tag-free { font-size: .62rem; font-weight: 700; color: #fff; background: var(--price, #f5222d); padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; flex-shrink: 0; line-height: 1.3; }

        .adm-store { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius-sm); color: var(--ink); font-weight: 600; font-size: .88rem; transition: background .15s; }
        .adm-store:hover { background: var(--brand-soft); color: var(--brand); }
        .adm-store-icon { width: 26px; height: 26px; border-radius: 6px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; }
        .adm-store-name { flex: 1; }
        .adm-store-link { color: var(--ink-faint); }

        .adm-nav { display: flex; flex-direction: column; gap: 14px; flex: 1; padding-top: 4px; }
        .adm-group { display: flex; flex-direction: column; gap: 2px; }
        .adm-group-title { font-size: .68rem; font-weight: 700; color: var(--ink-faint); text-transform: uppercase; letter-spacing: .08em; padding: 4px 12px 6px; }
        .adm-link { display: flex; align-items: center; gap: 11px; padding: 8px 12px; background: none; border: none; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 500; font-size: .88rem; border-radius: var(--radius-sm); cursor: pointer; text-align: left; transition: background .15s, color .15s; }
        .adm-link:hover { background: var(--surface-2); color: var(--ink); }
        .adm-link.active { background: var(--brand-soft); color: var(--brand); font-weight: 600; }
        .adm-link.active svg, .adm-link.active i { color: var(--brand); }

        .adm-side-foot { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
        .adm-theme { display: flex; align-items: center; gap: 12px; padding: 6px 12px; color: var(--ink-soft); font-family: var(--font-sans); font-weight: 500; font-size: .85rem; }
        .adm-account { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--surface-2); border-radius: var(--radius-sm); }
        .adm-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: .82rem; flex-shrink: 0; }
        .adm-email { flex: 1; font-size: .78rem; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .adm-signout { background: none; border: none; color: var(--ink-faint); cursor: pointer; display: flex; padding: 4px; border-radius: 4px; }
        .adm-signout:hover { color: var(--price); background: var(--surface); }

        /* ───── Main content ───── */
        .adm-main { flex: 1; min-width: 0; padding: 24px 28px 70px; }
        .adm-pagehead { margin-bottom: 22px; }
        .adm-pagehead h1 { font-size: 1.6rem; font-weight: 700; color: var(--ink); }
        .adm-body { display: flex; flex-direction: column; }

        /* ───── Mobile ───── */
        .adm-topbar { display: none; }
        .adm-backdrop { display: none; }

        @media (max-width: 900px) {
          .adm-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 60; }
          .adm-burger { background: none; border: 1px solid var(--line-strong); color: var(--ink); width: 36px; height: 36px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; cursor: pointer; }
          .adm-topbar-title { font-weight: 700; font-size: 1rem; color: var(--ink); }
          .adm-shell { flex-direction: column; }
          .adm-side { position: fixed; top: 0; left: 0; height: 100vh; transform: translateX(-100%); transition: transform .25s var(--ease); box-shadow: var(--shadow-hover); }
          .adm-side.open { transform: translateX(0); }
          .adm-backdrop { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 45; }
          .adm-main { padding: 16px; }
        }
      `}</style>
    </div>
  );
};
