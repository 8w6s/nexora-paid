import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { api, type Product } from "../lib/api";
import { staggerIn } from "../lib/motion";
import { Checkbox } from "./Checkbox";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";
import { ProductCard } from "./ProductCard";
import { SkeletonStyles, SkProductGrid } from "./Skeleton";

interface Category {
  name: string;
  count: number;
}
type SortKey = "newest" | "best" | "price-asc" | "price-desc" | "name";
interface SortOption {
  value: SortKey;
  label: string;
  icon: React.ComponentProps<typeof Icon>["name"];
  desc?: string;
}
function buildSorts(t: (k: string) => string): SortOption[] {
  return [
    { value: "newest", label: t("storefront.sort.newest"), icon: "zap" },
    { value: "best", label: t("storefront.sort.bestSelling"), icon: "star" },
    { value: "price-asc", label: t("storefront.sort.priceLowHigh"), icon: "arrow-right" },
    { value: "price-desc", label: t("storefront.sort.priceHighLow"), icon: "arrow-right" },
    { value: "name", label: t("storefront.sort.nameAZ"), icon: "box" },
  ];
}

export const ProductList: React.FC = () => {
  const { t } = useT();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("newest");
  const [inStockOnly, setInStockOnly] = useState(false);
  // Seed from URL so SearchBox / Free fallback (`/?q=term`) lands on a
  // pre-filtered grid instead of the full catalog.
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  // Load category chips once.
  useEffect(() => {
    api
      .get<Category[]>("/api/categories")
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Re-fetch products server-side when filters change (search debounced).
  useEffect(() => {
    const timer = setTimeout(
      async () => {
        try {
          const params = new URLSearchParams();
          if (category !== "All") params.set("category", category);
          if (sort !== "newest") params.set("sort", sort);
          if (inStockOnly) params.set("inStock", "true");
          if (search.trim()) params.set("q", search.trim());
          const qs = params.toString();
          setProducts(await api.get<Product[]>(`/api/products${qs ? `?${qs}` : ""}`));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : t("storefront.errors.generic"));
        } finally {
          setLoading(false);
        }
      },
      firstLoad.current ? 0 : 220,
    );
    firstLoad.current = false;
    return () => clearTimeout(timer);
  }, [category, sort, inStockOnly, search, t]);

  // Stagger cards in whenever the result set changes.
  useEffect(() => {
    if (gridRef.current && products.length)
      staggerIn(gridRef.current.querySelectorAll(".product-card"));
  }, [products]);

  return (
    <section className="catalog">
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={17} />
          <input
            value={search}
            name="search"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            aria-label={t("common.search")}
          />
          {search && (
            <button className="clear" onClick={() => setSearch("")} aria-label="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="toolbar-right">
          <Checkbox
            checked={inStockOnly}
            onChange={setInStockOnly}
            label={t("storefront.product.inStockOnly")}
            size={20}
          />
          <Dropdown<SortKey>
            value={sort as SortKey}
            onChange={(v) => setSort(v)}
            options={buildSorts(t)}
            width={210}
          />
        </div>
      </div>

      <div className="chips">
        <button
          className={`chip ${category === "All" ? "active" : ""}`}
          onClick={() => setCategory("All")}
        >
          {t("storefront.product.allCategories")}
        </button>
        {categories.map((c) => (
          <button
            key={c.name}
            className={`chip ${category === c.name ? "active" : ""}`}
            onClick={() => setCategory(c.name)}
          >
            {c.name} <span className="chip-n">{c.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <SkProductGrid count={8} />
      ) : error ? (
        <div className="pl-state">
          <Icon name="box" size={30} />
          <p>{error}</p>
        </div>
      ) : products.length === 0 ? (
        <div className="pl-state">
          <Icon name="search" size={30} />
          <p>{t("storefront.product.noResults")}</p>
        </div>
      ) : (
        <div className="grid" ref={gridRef}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      <SkeletonStyles />
      <style>{`
        .catalog { display: flex; flex-direction: column; }
        .toolbar { display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 14px; }
        .search { position: relative; flex: 1 1 280px; display: flex; align-items: center; }
        .search > svg, .search > i { position: absolute; left: 14px; color: var(--ink-faint); pointer-events: none; }
        .search input { width: 100%; height: 44px; padding: 0 40px 0 42px; border: 1px solid var(--line-strong); border-radius: 100px; background: var(--surface); color: var(--ink); font-family: var(--font-sans); font-size: .92rem; outline: none; transition: border-color .16s, box-shadow .16s; }
        .search input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft, rgba(79,70,229,.12)); }
        .search .clear { position: absolute; right: 12px; background: none; border: none; color: var(--ink-faint); cursor: pointer; display: flex; }
        .toolbar-right { display: flex; align-items: center; gap: 14px; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
        .chip { background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink-soft); padding: 6px 14px; border-radius: 100px; cursor: pointer; font-family: var(--font-sans); font-weight: 600; font-size: .82rem; transition: all .16s var(--ease); display: inline-flex; align-items: center; gap: 6px; }
        .chip:hover { border-color: var(--brand); color: var(--ink); }
        .chip.active { background: var(--brand); color: #fff; border-color: var(--brand); }
        .chip-n { font-size: .7rem; opacity: .7; }
        .chip.active .chip-n { opacity: .85; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 18px; }
        .pl-state { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 60px; color: var(--ink-soft); }
        @media (max-width: 560px) { .toolbar-right { width: 100%; justify-content: space-between; } }
      `}</style>
    </section>
  );
};
