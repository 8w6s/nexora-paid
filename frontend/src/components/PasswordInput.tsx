import type React from "react";
import { useState } from "react";
import { useT } from "../i18n";

export const PasswordInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  id?: string;
  name?: string;
}> = ({ value, onChange, placeholder, className, autoComplete, minLength, required, id, name }) => {
  const [reveal, setReveal] = useState(false);
  const { t } = useT();
  return (
    <div className={`pw ${className ?? ""}`}>
      <input
        id={id}
        name={name}
        className="input pw-input"
        type={reveal ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setReveal((r) => !r)}
        tabIndex={-1}
        aria-label={reveal ? t("storefront.auth.hidePassword") : t("storefront.auth.showPassword")}
      >
        {reveal ? t("storefront.auth.hide") : t("storefront.auth.show")}
      </button>
      <style>{`
        .pw { position: relative; display: block; }
        .pw .pw-input { width: 100%; padding-right: 58px; }
        .pw-toggle { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--brand, #4f46e5); font-family: var(--font-sans); font-weight: 600; font-size: .78rem; cursor: pointer; }
      `}</style>
    </div>
  );
};
