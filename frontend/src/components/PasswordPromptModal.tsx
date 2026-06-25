import type React from "react";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

/**
 * Re-auth gate for high-impact admin actions (rotating wallet xpub, rotating
 * email provider credentials). Replaces `window.prompt` — that worked but
 * (a) renders the masked input as plaintext in some mobile browsers,
 * (b) is blocked entirely inside iframes,
 * (c) doesn't survive a focus-stealing autofill popup on iOS Safari.
 *
 * The caller owns the open state. Resolves with the typed password (caller
 * is responsible for forwarding it to the API in `currentPassword`), or
 * `null` if the admin cancels / closes the dialog.
 */
export const PasswordPromptModal: React.FC<{
  open: boolean;
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel = "Confirm", onSubmit, onCancel }) => {
  const [pw, setPw] = useState("");
  useEffect(() => {
    if (!open) setPw("");
  }, [open]);

  const submit = () => {
    if (!pw) return;
    onSubmit(pw);
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title ?? "Confirm your admin password"}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={submit} disabled={!pw}>
            <Icon name="shield" size={14} /> {confirmLabel}
          </button>
        </>
      }
    >
      {message && (
        <p style={{ color: "var(--ink-soft)", fontSize: ".88rem", marginBottom: 12 }}>{message}</p>
      )}
      <input
        className="input"
        type="password"
        autoComplete="current-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Current admin password"
        autoFocus
        style={{ width: "100%" }}
      />
    </Modal>
  );
};
