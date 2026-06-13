import { atom, map } from "nanostores";

export interface CartItem {
  productId: string;
  variantId?: string | null;
  qty: number;
  name: string;
  priceUsd: number;
  image?: string;
}

export const cartStore = map<Record<string, CartItem>>({});

export function addToCart(item: CartItem) {
  const key = `${item.productId}-${item.variantId || "default"}`;
  const existing = cartStore.get()[key];
  if (existing) {
    cartStore.setKey(key, { ...existing, qty: existing.qty + item.qty });
  } else {
    cartStore.setKey(key, item);
  }
}

export function removeFromCart(productId: string, variantId?: string | null) {
  const key = `${productId}-${variantId || "default"}`;
  const current = { ...cartStore.get() };
  delete current[key];
  cartStore.set(current);
}

export function clearCart() {
  cartStore.set({});
}

export const isCartOpen = atom(false);

export interface User {
  id: string;
  email: string;
  role: "customer" | "admin";
}

export const userStore = atom<User | null>(null);
