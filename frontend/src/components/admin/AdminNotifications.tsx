import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "../Icon";

type NotifChannel = "email" | "discord" | "telegram" | "webhook";

interface EventConfig {
  key: string;
  label: string;
  description: string;
  channels: NotifChannel[];
}

const EVENTS: EventConfig[] = [
  { key: "order_created", label: "Order Created", description: "Get notified when a new order is created.", channels: ["discord", "telegram", "webhook"] },
  { key: "order_completed", label: "Order Completed", description: "Get notified when an invoice has been processed.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "order_manual_paid", label: "Manual Order Marked As Paid", description: "Get notified when an invoice gets marked as Confirming.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "stock_out", label: "Invoice Items Out of Stock", description: "Get notified when a product runs out of stock after a sale.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "variant_out", label: "Product Variant Out of Stock", description: "Get notified when a product variant runs out of stock.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "feedback_created", label: "Feedback Created", description: "Get notified when an order feedback is submitted.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "feedback_updated", label: "Feedback Updated", description: "Get notified when an order feedback is edited.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "feedback_dispute_accepted", label: "Feedback Dispute Accepted", description: "Get notified when a feedback dispute is accepted.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "feedback_dispute_rejected", label: "Feedback Dispute Rejected", description: "Get notified when a feedback dispute is rejected.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "ticket_created", label: "Ticket Created", description: "Get notified when a new support ticket is created.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "ticket_message", label: "Ticket Message", description: "Get notified when a new support ticket message is sent.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "subscription_ending", label: "Shop Subscription Ending", description: "Get notified when the subscription plan is expiring.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "shop_error", label: "Shop Error", description: "Get notified when an error occurs on the shop.", channels: ["email", "discord", "telegram", "webhook"] },
  { key: "product_restocked", label: "Product Restocked", description: "Send a message when a variant is restocked from zero stock.", channels: ["discord", "telegram", "webhook"] },
];

type NotifSettings = Record<string, Record<NotifChannel, boolean>>;

const defaultSettings = (): NotifSettings =>
  Object.fromEntries(EVENTS.map(e => [e.key, { email: false, discord: false, telegram: false, webhook: false }]));

const CHANNEL_ICONS: Record<NotifChannel, string> = {
  email: "receipt",
  discord: "bell",
  telegram: "arrow-right",
  webhook: "zap",
};

export const AdminNotifications: React.FC = () => {
  const [settings, setSettings] = useState<NotifSettings>(defaultSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get<NotifSettings>("/api/admin/notification-settings").then(s => {
      setSettings({ ...defaultSettings(), ...s });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggle = (eventKey: string, channel: NotifChannel) => {
    setSettings(s => ({ ...s, [eventKey]: { ...s[eventKey], [channel]: !s[eventKey]?.[channel] } }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/api/admin/notification-settings", settings);
      setSaved(true);
      setDirty(false);
    } catch {}
    finally { setSaving(false); }
  };

  const discard = async () => {
    setLoading(true);
    api.get<NotifSettings>("/api/admin/notification-settings").then(s => setSettings({ ...defaultSettings(), ...s })).catch(() => {}).finally(() => { setLoading(false); setDirty(false); });
  };

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Notification Settings</h2>
          <p className="muted">Manage which store events trigger notifications and where they are sent.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty && <button className="btn btn-ghost" onClick={discard}><Icon name="close" size={14} /> Discard</button>}
          <button className="btn" onClick={save} disabled={saving || !dirty}>
            {saving ? <><Icon name="spinner" size={14} className="is-spinning" /> Saving…</> : saved ? <><Icon name="check" size={14} /> Saved!</> : <><Icon name="check" size={14} /> Save</>}
          </button>
        </div>
      </div>

      {loading ? <div className="adm-loading"><Icon name="spinner" size={24} className="is-spinning" /></div> : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="notif-table-header">
            <div className="notif-event-col">Event</div>
            {(["email", "discord", "telegram", "webhook"] as NotifChannel[]).map(ch => (
              <div key={ch} className="notif-ch-col">
                <Icon name={CHANNEL_ICONS[ch] as any} size={14} />
                <span>{ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
              </div>
            ))}
          </div>

          {EVENTS.map((event, i) => (
            <div key={event.key} className={`notif-row ${i % 2 === 0 ? "notif-row-alt" : ""}`}>
              <div className="notif-event-col">
                <strong>{event.label}</strong>
                <span className="muted" style={{ fontSize: ".8rem" }}>{event.description}</span>
              </div>
              {(["email", "discord", "telegram", "webhook"] as NotifChannel[]).map(ch => (
                <div key={ch} className="notif-ch-col">
                  {event.channels.includes(ch) ? (
                    <button
                      type="button"
                      className={`notif-toggle ${settings[event.key]?.[ch] ? "on" : ""}`}
                      onClick={() => toggle(event.key, ch)}
                      title={`Toggle ${ch} for ${event.label}`}
                    >
                      {settings[event.key]?.[ch] ? <Icon name="check" size={13} /> : <span className="notif-off" />}
                    </button>
                  ) : <span className="notif-na">—</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {dirty && (
        <div className="notif-unsaved">
          <Icon name="bell" size={14} />
          <span>Unsaved changes</span>
          <button className="btn btn-ghost btn-sm" onClick={discard}>Discard</button>
          <button className="btn btn-sm" onClick={save} disabled={saving}>Save</button>
        </div>
      )}

      <style>{`
        .notif-table-header { display: grid; grid-template-columns: 1fr repeat(4, 90px); gap: 0; padding: 10px 20px; background: var(--surface-2); border-bottom: 1px solid var(--line); font-size: .75rem; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; }
        .notif-event-col { display: flex; flex-direction: column; gap: 2px; padding-right: 16px; }
        .notif-ch-col { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: .75rem; color: var(--ink-soft); }
        .notif-row { display: grid; grid-template-columns: 1fr repeat(4, 90px); gap: 0; padding: 14px 20px; border-bottom: 1px solid var(--line); align-items: center; }
        .notif-row-alt { background: var(--surface-2); }
        .notif-row:last-child { border-bottom: none; }
        .notif-toggle { width: 28px; height: 28px; border-radius: 6px; border: 1.5px solid var(--line-strong); background: var(--surface); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .15s; }
        .notif-toggle:hover { border-color: var(--brand); }
        .notif-toggle.on { background: var(--brand); border-color: var(--brand); color: #fff; }
        .notif-off { width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); display: block; }
        .notif-na { color: var(--ink-faint); font-size: 1rem; }
        .notif-unsaved { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); padding: 10px 18px; display: flex; align-items: center; gap: 10px; box-shadow: var(--shadow-hover); font-size: .88rem; font-weight: 600; color: var(--ink); z-index: 100; }
        @media (max-width: 640px) {
          .notif-table-header, .notif-row { grid-template-columns: 1fr repeat(4, 60px); }
        }
      `}</style>
    </div>
  );
};
