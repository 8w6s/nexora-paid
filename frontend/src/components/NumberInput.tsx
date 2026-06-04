import React from "react";

/**
 * Numeric text input — no spinner arrows, no auto-prefixing zeros, no "0 when empty" surprise.
 *
 * Why not <input type="number">? It shows browser spinners, accepts "e"/"+"/"-",
 * and when paired with a number-typed React state it forces "" -> 0 (so backspacing
 * the last digit silently becomes 0) and pre-pads leading zeros ("01"). This wraps
 * <input type="text" inputMode="numeric"> with a regex filter so the user always
 * sees the literal text they typed.
 *
 * Value is a STRING in the parent state. Call `Number(value)` when you submit.
 * Pass `decimal` for price-style fields (lets "." through); default = integers only.
 */
export const NumberInput: React.FC<{
  value: string;
  onChange: (next: string) => void;
  decimal?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
  id?: string;
  name?: string;
}> = ({ value, onChange, decimal = false, min, max, placeholder, required, autoFocus, className = "input", id, name, ...rest }) => {
  const accept = decimal ? /^\d*\.?\d*$/ : /^\d*$/;
  const handle = (raw: string) => {
    if (raw === "" || accept.test(raw)) {
      // Clamp on the fly only when fully numeric — keep "" / "12." while editing.
      if (raw !== "" && !raw.endsWith(".")) {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          if (max !== undefined && n > max) return onChange(String(max));
          if (min !== undefined && n < min) return onChange(String(min));
        }
      }
      onChange(raw);
    }
  };
  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      className={className}
      value={value}
      onChange={(e) => handle(e.target.value)}
      placeholder={placeholder}
      required={required}
      autoFocus={autoFocus}
      id={id}
      name={name}
      aria-label={rest["aria-label"]}
    />
  );
};
