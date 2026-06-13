import type React from "react";
import { useState } from "react";

// Simple password field with a Show/Hide toggle, styled to match the shop's .input.
export const PasswordInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  id?: string;
}> = ({ value, onChange, placeholder, className, autoComplete, minLength, required, id }) => {
  const [reveal, setReveal] = useState(false);
  return (
    <div className={`pw ${className ?? ""}`}>
      <input
        id={id}
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
        aria-label={reveal ? "Hide password" : "Show password"}
      >
        {reveal ? "Hide" : "Show"}
      </button>
      <style>{`
        .pw { position: relative; display: block; }
        .pw .pw-input { width: 100%; padding-right: 58px; }
        .pw-toggle { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--brand, #4f46e5); font-family: var(--font-sans); font-weight: 600; font-size: .78rem; cursor: pointer; }
      `}</style>
    </div>
  );
};
