import type React from "react";
import { useRef } from "react";
import { fmtUsd, type Product } from "../lib/api";
import { useCart } from "./CartContext";
import { Icon } from "./Icon";

export const ProductCard: React.FC<{ product: Product }> = ({ product }) => {
  const { addToCart } = useCart();
  const btnRef = useRef<HTMLButtonElement>(null);
  const handleAdd = () => {
    if (btnRef.current) addToCart(product, btnRef.current);
  };
  const out = !product.inStock;

  return (
    <article className="product-card">
      <div
        onClick={() => window.location.assign(`/product/${product.slug}`)}
        className="banner"
        style={{ cursor: "pointer" }}
        role="link"
        aria-label={`View ${product.name}`}
      >
        <img src={product.image} alt={product.name} loading="lazy" decoding="async" />
        <span className="tag-auto banner-tag">
          <Icon name="zap" size={12} />
          Instant delivery
        </span>
        {out && <span className="sold-out">Out of stock</span>}
      </div>

      <div className="info">
        <span className="pill cat-pill">{product.category}</span>
        <span
          onClick={() => window.location.assign(`/product/${product.slug}`)}
          className="name-link"
          style={{ cursor: "pointer" }}
          role="link"
        >
          <h3 className="name">{product.name}</h3>
        </span>
        <p className="desc">{product.description}</p>

        <div className="meta">
          <span>{product.inStock ? `${product.stock} in stock` : "Out of stock"}</span>
        </div>

        <div className="footer">
          <span className="price">{fmtUsd(product.priceUsd)}</span>
          <div className="card-actions">
            <button
              onClick={() => window.location.assign(`/product/${product.slug}`)}
              className="btn btn-ghost detail-btn"
              style={{ cursor: "pointer" }}
            >
              Details
            </button>
            <button
              ref={btnRef}
              className="btn add-btn"
              onClick={handleAdd}
              disabled={out}
              aria-label={out ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
            >
              {!out && <Icon name="cart" size={16} />}
              <span>{out ? "Sold out" : "Add"}</span>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .product-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; overflow: hidden; transition: box-shadow .22s var(--ease), transform .22s var(--ease); }
        .product-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-3px); }
        .banner { position: relative; aspect-ratio: 16/9; overflow: hidden; background: var(--surface-2); display:block; }
        .banner img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s var(--ease); }
        .product-card:hover .banner img { transform: scale(1.05); }
        .banner-tag { position: absolute; left: 10px; bottom: 10px; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(4px); }
        .sold-out { position: absolute; inset: 0; background: rgba(31,35,41,.55); color: #fff; font-weight: 700; font-size: 1.05rem; display: flex; align-items: center; justify-content: center; }
        .info { padding: 14px 15px 16px; display: flex; flex-direction: column; flex-grow: 1; }
        .cat-pill { align-self: flex-start; background: var(--tag-soft); color: var(--tag); margin-bottom: 9px; }
        .name-link { color: inherit; display: block; }
        .name-link:hover .name { color: var(--brand); }
        .name { font-size: 1rem; font-weight: 700; line-height: 1.35; margin-bottom: 6px; transition: color .16s var(--ease); }
        .desc { font-size: .82rem; color: var(--ink-soft); line-height: 1.5; margin-bottom: 12px; flex-grow: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .meta { display: flex; align-items: center; gap: 7px; font-size: .76rem; color: var(--ink-faint); margin-bottom: 12px; }
        .footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
        .footer .price { font-size: 1.25rem; }
        .card-actions { display: flex; align-items: center; gap: 8px; }
        .detail-btn { padding: 8px 13px; font-size: .85rem; }
        .add-btn { padding: 8px 15px; font-size: .85rem; }
        .add-btn:disabled { opacity: .55; cursor: not-allowed; background: var(--ink-faint); border-color: var(--ink-faint); }
      `}</style>
    </article>
  );
};
