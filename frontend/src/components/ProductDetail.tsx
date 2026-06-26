import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { api, fmtUsd, type Product } from "../lib/api";
import { fadeRise, staggerIn } from "../lib/motion";
import { useCart } from "./CartContext";
import { Icon } from "./Icon";
import { ProductCard } from "./ProductCard";
import { ProductReviews } from "./ProductReviews";

// AdminProductEditor saves HTML markup into product.description; the
// storefront paragraph rendered it as text, displaying literal
// '<b>foo</b>' to visitors. Strip tags and decode the small entity set
// the editor produces. Decode & LAST so < doesn't double-decode.
// If styled descriptions are wanted later, swap this for DOMPurify +
// dangerouslySetInnerHTML.
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/ /g, " ")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Product is fetched server-side and passed in as a prop (SSR -> good SEO + no client flash).
export const ProductDetail: React.FC<{ product: Product }> = ({ product }) => {
  const { addToCart } = useCart();
  const { t } = useT();
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const relRef = useRef<HTMLDivElement>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants && product.variants.length > 0 ? product.variants[0].id : null,
  );

  const selectedVariant = product.variants?.find((v) => v.id === selectedVariantId);
  const activePrice = selectedVariant ? selectedVariant.priceUsd : product.priceUsd;
  const activeComparePrice = selectedVariant
    ? selectedVariant.compareAtPrice
    : product.compareAtPrice;
  const activeStock = selectedVariant ? selectedVariant.stock : product.stock;
  const activeOut = selectedVariant ? !selectedVariant.inStock : !product.inStock;
  const hasImage = product.image && product.image.trim().length > 0;

  const handleAdd = () => {
    if (!addBtnRef.current) return;
    for (let i = 0; i < qty; i++)
      addToCart(product, selectedVariant, i === 0 ? addBtnRef.current : undefined);
  };

  useEffect(() => {
    setQty(1);
  }, []);

  // Related products (same category, excluding this one).
  useEffect(() => {
    api
      .get<Product[]>(`/api/products?category=${encodeURIComponent(product.category)}`)
      .then((list) => setRelated(list.filter((p) => p.id !== product.id).slice(0, 4)))
      .catch(() => {});
  }, [product.id, product.category]);

  useEffect(() => {
    fadeRise(infoRef.current, { duration: 480 });
  }, []);
  useEffect(() => {
    if (relRef.current && related.length)
      staggerIn(relRef.current.querySelectorAll(".product-card"));
  }, [related]);

  return (
    <div className="pd container">
      {/* Real anchors so middle-click opens a new tab and screen readers
          announce them as links — the previous span+onClick rendered as
          plain StaticText in the a11y tree. */}
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span>/</span>
        <a href={`/?category=${encodeURIComponent(product.category)}`}>{product.category}</a>
        <span>/</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="pd-grid">
        <div className="pd-media">
          {hasImage ? (
            <img src={product.image} alt={product.name} />
          ) : (
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--surface-2)",
              }}
            >
              <Icon name="package" size={64} style={{ opacity: 0.3, color: "var(--ink-soft)" }} />
            </div>
          )}
          {activeOut && <span className="pd-soldout">{t("storefront.product.outOfStock")}</span>}
          <span className="pd-tag">
            <Icon name="zap" size={13} /> {t("storefront.product.instantDelivery")}
          </span>
        </div>

        <div className="pd-info" ref={infoRef}>
          <span className="pill cat-pill">{product.category}</span>
          <h1 className="pd-name">{product.name}</h1>
          <div className="pd-meta">
            <span className={activeOut ? "muted" : "stock-ok"}>
              <Icon name="box" size={13} />{" "}
              {!activeOut
                ? t("storefront.product.inStock", { count: String(activeStock) })
                : t("storefront.product.outOfStock")}
            </span>
            {product.sold > 0 && (
              <>
                <span className="dot">·</span>
                <span className="muted">{t("storefront.product.sold", { count: String(product.sold) })}</span>
              </>
            )}
          </div>
          <p className="pd-desc">{stripHtml(product.description)}</p>

          <div
            className="pd-price-row"
            style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}
          >
            <span className="price pd-price">{fmtUsd(activePrice)}</span>
            {activeComparePrice && activeComparePrice > activePrice && (
              <>
                <span
                  style={{
                    textDecoration: "line-through",
                    color: "var(--ink-faint)",
                    fontSize: "1.3rem",
                  }}
                >
                  {fmtUsd(activeComparePrice)}
                </span>
                <span
                  className="pill"
                  style={{
                    background: "var(--price-soft)",
                    color: "var(--price)",
                    fontWeight: "700",
                    fontSize: "0.82rem",
                  }}
                >
                  -{Math.round(((activeComparePrice - activePrice) / activeComparePrice) * 100)}%
                </span>
              </>
            )}
          </div>

          {product.variants && product.variants.length > 0 && (
            <div className="pd-variants" style={{ margin: "14px 0 6px" }}>
              <span
                style={{
                  display: "block",
                  fontSize: ".82rem",
                  fontWeight: "700",
                  color: "var(--ink-soft)",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  marginBottom: "8px",
                }}
              >
                {t("storefront.product.choosePackage")}
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {product.variants.map((v) => {
                  const isSelected = selectedVariantId === v.id;
                  const vStock = v.stock;
                  const vOut = vStock <= 0;
                  return (
                    <button
                      key={v.id}
                      onClick={() => !vOut && setSelectedVariantId(v.id)}
                      disabled={vOut}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "100px",
                        border: "1px solid " + (isSelected ? "var(--brand)" : "var(--line-strong)"),
                        outline: isSelected ? "1px solid var(--brand)" : "none",
                        outlineOffset: -2,
                        background: isSelected ? "var(--brand-soft)" : "var(--surface)",
                        color: isSelected
                          ? "var(--brand)"
                          : vOut
                            ? "var(--ink-faint)"
                            : "var(--ink)",
                        fontWeight: "600",
                        fontSize: "0.88rem",
                        cursor: vOut ? "not-allowed" : "pointer",
                        opacity: vOut ? 0.55 : 1,
                        transition: "all 0.15s ease",
                      }}
                      type="button"
                    >
                      {v.name} - {fmtUsd(v.priceUsd)} {vOut && `(${t("storefront.product.outOfStockShort")})`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pd-buy">
            {!activeOut && (
              <div className="qty">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  aria-label="Decrease quantity"
                >
                  <Icon name="minus" size={14} />
                </button>
                <span>{qty}</span>
                <button
                  onClick={() => setQty((q) => Math.min(activeStock, q + 1))}
                  disabled={qty >= activeStock}
                  aria-label="Increase quantity"
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            )}
            <button ref={addBtnRef} className="btn pd-add" onClick={handleAdd} disabled={activeOut}>
              {!activeOut && <Icon name="cart" size={17} />}
              <span>{activeOut ? t("storefront.product.outOfStockShort") : t("storefront.product.addToCart")}</span>
            </button>
          </div>

          <div className="pd-trust">
            <div>
              <Icon name="zap" size={16} variant="badge" />
              <div>
                <strong>{t("storefront.product.instantDeliveryTitle")}</strong>
                <span>{t("storefront.product.instantDeliverySub")}</span>
              </div>
            </div>
            <div>
              <Icon name="shield" size={16} variant="badge" />
              <div>
                <strong>{t("storefront.product.securePaymentTitle")}</strong>
                <span>{t("storefront.product.securePaymentSub")}</span>
              </div>
            </div>
            <div>
              <Icon name="key" size={16} variant="badge" />
              <div>
                <strong>{t("storefront.product.alwaysAvailableTitle")}</strong>
                <span>{t("storefront.product.alwaysAvailableSub")}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="pd-related">
          <h2>{t("storefront.product.relatedProducts")}</h2>
          <div className="rel-grid" ref={relRef}>
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <ProductReviews slug={product.slug} />

      <style>{`
        .pd { padding: 22px 20px 70px; }
        .crumbs { display: flex; align-items: center; gap: 8px; font-size: .82rem; color: var(--ink-faint); margin-bottom: 18px; flex-wrap: wrap; }
        .crumbs a { color: var(--ink-soft); font-weight: 500; text-decoration: none; cursor: pointer; }
        .crumbs a:hover { color: var(--brand); }
        .crumbs span[aria-current] { color: var(--ink); font-weight: 600; }
        .pd-grid { display: grid; grid-template-columns: minmax(280px, 0.9fr) 1.1fr; gap: 30px; align-items: start; }
        .pd-media { position: relative; aspect-ratio: 4/3; overflow: hidden; border-radius: var(--radius); border: 1px solid var(--line); box-shadow: var(--shadow); background: var(--surface-2); }
        .pd-media img { width: 100%; height: 100%; object-fit: cover; }
        .pd-soldout { position: absolute; inset: 0; background: rgba(31,35,41,.55); color: #fff; font-weight: 700; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; }
        .pd-tag { position: absolute; left: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 5px; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(4px); color: var(--auto,#137333); font-weight: 600; font-size: .78rem; padding: 5px 11px; border-radius: 100px; }
        .pd-info { display: flex; flex-direction: column; gap: 14px; }
        .cat-pill { align-self: flex-start; background: var(--tag-soft); color: var(--tag); }
        .pd-name { font-size: 1.9rem; line-height: 1.2; }
        .pd-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: .84rem; }
        .pd-meta > span { display: inline-flex; align-items: center; gap: 5px; }
        .stock-ok { color: var(--auto,#137333); font-weight: 600; }
        .muted { color: var(--ink-faint); }
        .pd-meta .dot { color: var(--line-strong); }
        .pd-desc { color: var(--ink-soft); line-height: 1.7; font-size: .96rem; }
        .pd-price-row { padding-top: 8px; }
        .pd-price { font-size: 2rem; }
        .pd-buy { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 4px 0 6px; }
        .qty { display: flex; align-items: center; gap: 12px; border: 1px solid var(--line-strong); border-radius: 100px; padding: 6px 14px; }
        .qty button { background: none; border: none; color: var(--ink); cursor: pointer; display: flex; }
        .qty button:disabled { opacity: .3; cursor: not-allowed; }
        .qty span { font-weight: 700; font-variant-numeric: tabular-nums; min-width: 14px; text-align: center; }
        .pd-add { padding: 12px 26px; font-size: .95rem; }
        .pd-add:disabled { opacity: .55; cursor: not-allowed; background: var(--ink-faint); border-color: var(--ink-faint); }
        .pd-trust { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; padding-top: 18px; border-top: 1px solid var(--line); }
        .pd-trust > div { display: flex; align-items: center; gap: 12px; }
        .pd-trust strong { display: block; font-size: .88rem; }
        .pd-trust span { font-size: .8rem; color: var(--ink-faint); }
        .pd-related { margin-top: 56px; }
        .pd-related h2 { font-size: 1.3rem; margin-bottom: 18px; }
        .rel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; max-width: 720px; }
        @media (max-width: 760px) { .pd-grid { grid-template-columns: 1fr; gap: 20px; } .pd-name { font-size: 1.5rem; } }
      `}</style>
    </div>
  );
};
