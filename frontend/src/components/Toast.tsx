import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  text: string;
}

interface ToastCtx {
  push: (text: string, tone?: Tone) => void;
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  // Track auto-dismiss timers so we can flush them on unmount — otherwise a
  // late-firing setTimeout would call setItems on an unmounted provider.
  const timersRef = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timersRef.current.delete(id);
    }
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: Tone = "success") => {
      const id = ++idRef.current;
      setItems((xs) => [...xs, { id, tone, text }]);
      const t = window.setTimeout(() => remove(id), 3800);
      timersRef.current.set(id, t);
    },
    [remove],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => {
        window.clearTimeout(t);
      });
      timersRef.current.clear();
    };
  }, []);

  // Memoize so consumers don't re-render on every parent render.
  const value = useMemo<ToastCtx>(
    () => ({
      push,
      success: (t) => push(t, "success"),
      error: (t) => push(t, "error"),
      info: (t) => push(t, "info"),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Stack rendered in a fixed corner, above everything except modal dialogs. */}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            <Icon
              name={t.tone === "success" ? "check" : t.tone === "error" ? "close" : "bell"}
              size={16}
            />
            <span>{t.text}</span>
            <button className="t-x" onClick={() => remove(t.id)} aria-label="Dismiss">
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
      <style>{`
        .toast-stack { position: fixed; top: 16px; right: 16px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .toast { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--brand); border-radius: var(--radius-sm); box-shadow: var(--shadow-hover); font-family: var(--font-sans); font-size: .88rem; color: var(--ink); min-width: 240px; max-width: 380px; pointer-events: auto; animation: toast-in .22s cubic-bezier(.16,1,.3,1) both; }
        .toast.success { border-left-color: var(--auto, #16a34a); }
        .toast.success svg { color: var(--auto, #16a34a); }
        .toast.error { border-left-color: var(--price); }
        .toast.error svg { color: var(--price); }
        .toast.info svg { color: var(--brand); }
        .toast span { flex: 1; }
        .t-x { background: none; border: none; color: var(--ink-faint); cursor: pointer; display: flex; padding: 4px; border-radius: 4px; }
        .t-x:hover { color: var(--ink); background: var(--surface-2); }
        @keyframes toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
      `}</style>
    </Ctx.Provider>
  );
};

export const useToast = (): ToastCtx => {
  const c = useContext(Ctx);
  // Safe noop fallback so components can call useToast even outside a provider.
  if (!c)
    return {
      push: (_t) => {},
      success: (_t) => {},
      error: (_t) => {},
      info: (_t) => {},
    };
  return c;
};
