import React, { useEffect, useRef, useState } from "react";
import { useCart } from "./CartContext";
import { Icon } from "./Icon";
import { api, fmtUsd, type Product } from "../lib/api";
import { ProductCard } from "./ProductCard";
import { ProductReviews } from "./ProductReviews";
import { fadeRise, staggerIn } from "../lib/motion";

// Product is fetched server-side and passed in as a prop (SSR -> good SEO + no client flash).
export const ProductDetail: React.FC<{ product: Product }> = ({ product }) => {
  const { addToCart } = useCart();
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);
  const relRef = useRef<HTMLDivElement>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);
  const out = !product.inStock;

  const handleAdd = () => {
    if (!addBtnRef.current) return;
    for (let i = 0; i < qty; i++) addToCart(product, i === 0 ? addBtnRef.current : undefined);
  };

  // Related products (same category, excluding this one).
  useEffect(() => {
    api.get<Product[]>(`/api/products?category=${encodeURIComponent(product.category)}`)
      .then((list) => setRelated(list.filter((p) => p.id !== product.id).slice(0, 4)))
      .catch(() => {});
  }, [product.id, product.category]);

  useEffect(() => { fadeRise(infoRef.current, { duration: 480 }); }, [product.id]);
  useEffect(() => { if (relRef.current && related.length) staggerIn(relRef.current.querySelectorAll(".product-card")); }, [related]);

  return (
    <div className="pd container">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span>/</span>
        <a href={`/?category=${encodeURIComponent(product.category)}`}>{product.category}</a><span>/</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="pd-grid">
        <div className="pd-media">
          <img src={product.image} alt={product.name} />
          {out && <span className="pd-soldout">Out of stock</span>}
          <span className="pd-tag"><Icon name="zap" size={13} /> Instant delivery</span>
        </div>

        <div className="pd-info" ref={infoRef}>
          <span className="pill cat-pill">{product.category}</span>
          <h1 className="pd-name">{product.name}</h1>
          <div className="pd-meta">
            <span className={out ? "muted" : "stock-ok"}><Icon name="box" size={13} /> {product.inStock ? `${product.stock} in stock` : "Out of stock"}</span>
            {product.sold > 0 && <><span className="dot">·</span><span className="muted">{product.sold} sold</span></>}
          </div>
          <p className="pd-desc">{product.description}</p>

          <div className="pd-price-row">
            <span className="price pd-price">{fmtUsd(product.priceUsd)}</span>
          </div>

          <div className="pd-buy">
            {!out && (
              <div className="qty">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity"><Icon name="minus" size={14} /></button>
                <span>{qty}</span>
                <button onClick={() => setQty((q) => Math.min(product.stock, q + 1))} disabled={qty >= product.stock} aria-label="Increase quantity"><Icon name="plus" size={14} /></button>
              </div>
            )}
            <button ref={addBtnRef} className="btn pd-add" onClick={handleAdd} disabled={out}>
              {!out && <Icon name="cart" size={17} />}
              <span>{out ? "Sold out" : "Add to cart"}</span>
            </button>
          </div>

          <div className="pd-trust">
            <div><Icon name="zap" size={16} variant="badge" /><div><strong>Instant delivery</strong><span>Keys sent automatically after payment</span></div></div>
            <div><Icon name="shield" size={16} variant="badge" /><div><strong>Secure payment</strong><span>Pay in Litecoin, settled on-chain</span></div></div>
            <div><Icon name="key" size={16} variant="badge" /><div><strong>Always available</strong><span>Re-view your keys anytime in My Orders</span></div></div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="pd-related">
          <h2>Related products</h2>
          <div className="rel-grid" ref={relRef}>
            {related.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      <ProductReviews slug={product.slug} />

      <style>{`
        .pd { padding: 22px 20px 70px; }
        .crumbs { display: flex; align-items: center; gap: 8px; font-size: .82rem; color: var(--ink-faint); margin-bottom: 18px; flex-wrap: wrap; }
        .crumbs a { color: var(--ink-soft); font-weight: 500; }
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
