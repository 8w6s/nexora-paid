import React, { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";

interface Suggestion {
  id: string;
  name: string;
  slug: string;
  priceUsd: number;
  image: string;
}

/**
 * Storefront search box with debounced autocomplete.
 *
 * Paid build: `/api/products/suggest` returns up to 8 suggestions; dropdown
 * renders thumbnail + name + price, supports ↑/↓/Enter/Esc keyboard nav,
 * Enter on a highlighted row navigates to `/p/<slug>`.
 *
 * Free build: the suggest endpoint doesn't exist, so the fetch quietly errors
 * (caught + ignored) and the dropdown stays empty. Enter on the input always
 * navigates to `/?q=<term>` so the catalog page does a server-side LIKE.
 *
 * That dual behavior means this component ships unchanged in both tiers —
 * the endpoint is the source of truth for whether autocomplete works, not
 * a feature flag the user can flip and produce 404s.
 */
export const SearchBox: React.FC = () => {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const reqIdRef = useRef(0);

  // Debounced fetch. Skip queries shorter than 1 char to avoid paging the
  // whole catalog on focus. 250ms matches the spec in .loop/PROMPT.md.
  useEffect(() => {
    const term = q.trim();
    if (term.length === 0) {
      setItems([]);
      setHighlight(-1);
      return;
    }
    const myReq = ++reqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: Suggestion[] }>(`/api/products/suggest?q=${encodeURIComponent(term)}`);
        // Drop stale responses (user kept typing after this request fired).
        if (myReq !== reqIdRef.current) return;
        setItems(res.items ?? []);
        setHighlight(res.items && res.items.length > 0 ? 0 : -1);
      } catch {
        // Free build (404) or transient network — silently degrade to "no
        // suggestions"; Enter still falls through to the full page nav.
        if (myReq === reqIdRef.current) {
          setItems([]);
          setHighlight(-1);
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const goToCatalog = (term: string) => {
    if (typeof window === "undefined") return;
    const url = term ? `/?q=${encodeURIComponent(term)}` : "/";
    window.location.href = url;
  };

  const goToProduct = (s: Suggestion) => {
    if (typeof window === "undefined") return;
    window.location.href = `/p/${s.slug}`;
  };

  const onKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      if (items.length === 0) return;
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setHighlight((h) => (h <= 0 ? items.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlight >= 0 && items[highlight]) goToProduct(items[highlight]);
      else goToCatalog(q.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const activeId = open && highlight >= 0 && items[highlight] ? `${listboxId}-opt-${highlight}` : undefined;

  return (
    <div className="sf-search" ref={wrapRef}>
      <Icon name="search" size={16} className="sf-search-icon" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search products…"
        aria-label="Search products"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        className="sf-search-input"
      />
      {open && items.length > 0 && (
        <ul id={listboxId} role="listbox" className="sf-search-list">
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={`sf-search-opt${i === highlight ? " is-active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => { e.preventDefault(); goToProduct(s); }}
            >
              {s.image
                ? <img src={s.image} alt="" className="sf-search-thumb" loading="lazy" />
                : <span className="sf-search-thumb sf-search-thumb-placeholder" />}
              <span className="sf-search-name">{s.name}</span>
              <span className="sf-search-price">${s.priceUsd.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .sf-search { position: relative; flex: 1 1 280px; max-width: 360px; min-width: 200px; }
        .sf-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-faint); pointer-events: none; }
        .sf-search-input { width: 100%; padding: 9px 12px 9px 36px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); font-size: .9rem; outline: none; transition: border-color .15s, box-shadow .15s; }
        .sf-search-input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
        .sf-search-list { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; margin: 0; padding: 6px; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.12); max-height: 360px; overflow-y: auto; }
        .sf-search-opt { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: background .12s; }
        .sf-search-opt.is-active, .sf-search-opt:hover { background: var(--brand-soft); }
        .sf-search-thumb { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; background: var(--line); flex: none; }
        .sf-search-thumb-placeholder { display: block; }
        .sf-search-name { flex: 1; font-size: .88rem; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sf-search-price { font-size: .82rem; font-weight: 600; color: var(--brand); font-variant-numeric: tabular-nums; flex: none; }
        @media (max-width: 600px) { .sf-search { max-width: none; min-width: 0; flex-basis: 100%; order: 3; } }
      `}</style>
    </div>
  );
};
