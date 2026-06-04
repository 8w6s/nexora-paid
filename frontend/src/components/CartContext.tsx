import React, { createContext, useContext, useState, useEffect } from "react";
import anime from "animejs";
import type { Product } from "../lib/api";

export type { Product };

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextType {
  cart: CartItem[];
  isCartOpen: boolean;
  addToCart: (product: Product, startEl?: HTMLElement) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  setIsCartOpen: (open: boolean) => void;
}

const CART_KEY = "Nexora_cart";

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Load cart from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(CART_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCart(parsed);
      } catch (e) {
        console.error("Failed to read cart", e);
      }
    }
  }, []);

  // Persist cart to localStorage
  const saveCart = (newCart: CartItem[]) => {
    setCart(newCart);
    localStorage.setItem(CART_KEY, JSON.stringify(newCart));
  };

  const addToCart = (product: Product, startEl?: HTMLElement) => {
    const existing = cart.find((item) => item.product.id === product.id);
    const newCart = cart.map((item) => ({ ...item }));

    if (existing) {
      const current = newCart.find((item) => item.product.id === product.id)!;
      if (current.quantity >= product.stock) return; // respect stock as max
      current.quantity += 1;
      // keep product snapshot fresh (price/stock may have changed)
      current.product = product;
    } else {
      if (product.stock <= 0) return;
      newCart.push({ product, quantity: 1 });
    }

    saveCart(newCart);

    // Optional anime fly-to-cart effect
    if (startEl) {
      triggerFlyAnimation(startEl);
    }
  };

  const triggerFlyAnimation = (startEl: HTMLElement) => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const cartIcon = document.getElementById("cart-trigger-btn");
    if (!cartIcon) return;

    const startRect = startEl.getBoundingClientRect();
    const endRect = cartIcon.getBoundingClientRect();

    const particle = document.createElement("div");
    particle.className = "flying-particle";
    particle.style.left = `${startRect.left + startRect.width / 2}px`;
    particle.style.top = `${startRect.top + startRect.height / 2}px`;
    document.body.appendChild(particle);

    anime({
      targets: particle,
      translateX: [0, endRect.left - startRect.left],
      translateY: [0, endRect.top - startRect.top],
      scale: [1, 0.35],
      opacity: [1, 0.6],
      duration: 750,
      easing: "cubicBezier(0.25, 1, 0.5, 1)",
      complete: () => {
        particle.remove();
        anime({
          targets: cartIcon,
          scale: [1, 1.18, 1],
          duration: 320,
          easing: "easeOutElastic(1, .6)",
        });
      },
    });
  };

  const removeFromCart = (productId: string) => {
    const newCart = cart.filter((item) => item.product.id !== productId);
    saveCart(newCart);
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    const newCart = cart.map((item) => {
      if (item.product.id === productId) {
        return { ...item, quantity: Math.min(quantity, item.product.stock) };
      }
      return item;
    });
    saveCart(newCart);
  };

  const clearCart = () => {
    saveCart([]);
  };

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + item.product.priceUsd * item.quantity, 0);
  };

  return (
    <CartContext.Provider
      value={{
        cart,
        isCartOpen,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        getCartTotal,
        setIsCartOpen,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
};
