import React, { useEffect, useRef } from "react";
import { useCart } from "./CartContext";
import { Icon } from "./Icon";
import { fmtUsd } from "../lib/api";
import anime from "animejs";

// Cart drawer. Checkout requires login + LTC payment, so "Checkout" just routes to /checkout
// (the Checkout island handles auth redirect + order creation). No customer form here anymore.
export const CartDrawer: React.FC = () => {
  const { cart, isCartOpen, setIsCartOpen, removeFromCart, updateQuantity, getCartTotal } = useCart();
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isCartOpen) {
      if (backdropRef.current) backdropRef.current.style.display = "block";
      if (reduce) {
        if (backdropRef.current) backdropRef.current.style.opacity = "1";
        if (drawerRef.current) drawerRef.current.style.transform = "translateX(0%)";
        return;
      }
      anime({ targets: backdropRef.current, opacity: [0, 1], duration: 300, easing: "easeOutQuad" });
      anime({ targets: drawerRef.current, translateX: ["100%", "0%"], duration: 420, easing: "cubicBezier(0.16,1,0.3,1)" });
    } else {
      if (reduce) {
        if (backdropRef.current) { backdropRef.current.style.opacity = "0"; backdropRef.current.style.display = "none"; }
        if (drawerRef.current) drawerRef.current.style.transform = "translateX(100%)";
        return;
      }
      anime({ targets: backdropRef.current, opacity: [1, 0], duration: 260, easing: "easeInQuad", complete: () => { if (backdropRef.current) backdropRef.current.style.display = "none"; } });
      anime({ targets: drawerRef.current, translateX: ["0%", "100%"], duration: 320, easing: "cubicBezier(0.16,1,0.3,1)" });
    }
  }, [isCartOpen]);

  const totalQty = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <div ref={backdropRef} className="cart-backdrop" onClick={() => setIsCartOpen(false)} style={{ display: "none", opacity: 0 }} />
      <aside ref={drawerRef} className="cart-drawer" style={{ transform: "translateX(100%)" }}>
        <div className="drawer-header">
          <h2>Cart ({totalQty})</h2>
          <button className="btn-close" onClick={() => setIsCartOpen(false)} aria-label="Close"><Icon name="close" size={20} /></button>
        </div>

        <div className="drawer-content">
          {cart.length === 0 ? (
            <div className="empty-cart"><Icon name="cart" size={38} /><p>Your cart is empty.</p></div>
          ) : (
            <div className="cart-items">
              {cart.map((item) => (
                <div key={item.product.id} className="cart-item">
                  <img src={item.product.image} alt={item.product.name} />
                  <div className="item-details">
                    <h4>{item.product.name}</h4>
                    <span className="item-price price">{fmtUsd(item.product.priceUsd)}</span>
                    <div className="quantity-controls">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} disabled={item.quantity <= 1} aria-label="Decrease"><Icon name="minus" size={13} /></button>
                      <span>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= item.product.stock} aria-label="Increase"><Icon name="plus" size={13} /></button>
                    </div>
                  </div>
                  <button className="btn-delete" onClick={() => removeFromCart(item.product.id)} aria-label="Remove"><Icon name="trash" size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="drawer-footer">
            <div className="total-row"><span>Total</span><span className="total-amount price">{fmtUsd(getCartTotal())}</span></div>
            <a className="btn" href="/checkout" style={{ width: "100%", justifyContent: "center" }}>
              <span>Continue to checkout</span><Icon name="arrow-right" size={17} />
            </a>
          </div>
        )}
      </aside>

      <style>{`
        .cart-backdrop { position: fixed; inset: 0; background: rgba(31,35,41,.4); z-index: 1000; }
        .cart-drawer { position: fixed; top: 0; right: 0; width: 100%; max-width: 420px; height: 100vh; z-index: 1001; display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--line-strong); }
        .drawer-header { padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; background: var(--surface); border-bottom: 1px solid var(--line); }
        .drawer-header h2 { font-size: 1.1rem; }
        .btn-close { background: transparent; border: none; color: var(--ink-soft); cursor: pointer; padding: 2px; }
        .btn-close:hover { color: var(--price); }
        .drawer-content { flex-grow: 1; overflow-y: auto; padding: 18px 22px; }
        .empty-cart { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--ink-faint); gap: 12px; }
        .cart-items { display: flex; flex-direction: column; gap: 12px; }
        .cart-item { display: flex; gap: 12px; padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .cart-item img { width: 64px; height: 64px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
        .item-details { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; min-width: 0; }
        .item-details h4 { font-size: .88rem; font-weight: 600; }
        .item-price { font-size: .92rem; }
        .quantity-controls { display: flex; align-items: center; gap: 10px; margin-top: 3px; }
        .quantity-controls button { background: var(--surface); border: 1px solid var(--line-strong); color: var(--ink); width: 25px; height: 25px; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .quantity-controls button:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
        .quantity-controls button:disabled { opacity: .35; cursor: not-allowed; }
        .quantity-controls span { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 14px; text-align: center; }
        .btn-delete { background: transparent; border: none; color: var(--ink-faint); cursor: pointer; padding: 3px; height: fit-content; }
        .btn-delete:hover { color: var(--price); }
        .drawer-footer { padding: 16px 22px; border-top: 1px solid var(--line); background: var(--surface); }
        .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
        .total-row > span:first-child { color: var(--ink-soft); font-size: .88rem; }
        .total-amount { font-size: 1.4rem; }
      `}</style>
    </>
  );
};
