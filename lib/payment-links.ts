// lib/payment-links.ts
// WICG "Payment Link" support (https://github.com/WICG/paymentlink). The spec
// standardizes  <link rel="facilitated-payment" href="<payment-method-uri>">  on
// a checkout page so a compatible browser/wallet can passively detect a push-
// payment method and offer it as an "alternate" representation beside card
// checkout — no explicit merchant API integration needed on the payer's side.
//
// This module is the pure core: recognize/normalize a push-payment URI, and
// build the common one (UPI, the spec's canonical example). No DOM here — the
// public pay page renders the actual <link rel="facilitated-payment"> element
// from a URI this module has validated.

// The rel value the spec defines.
export const FACILITATED_PAYMENT_REL = "facilitated-payment";

// URI schemes the spec calls out as push-payment methods, plus common wallets.
// A scheme NOT on this list is rejected, so we never emit an arbitrary (and
// potentially unsafe, e.g. javascript:) href into the document <head>.
export const FACILITATED_PAYMENT_SCHEMES = [
  "upi", // India UPI — upi://pay?pa=…
  "bitcoin", // BIP-21 — bitcoin:<address>?amount=…
  "ethereum", // EIP-681 — ethereum:<address>?value=…
  "pix", // Brazil Pix
  "paypal", // eWallet scheme
] as const;

export type FacilitatedScheme = (typeof FACILITATED_PAYMENT_SCHEMES)[number];

// The lowercased scheme of a URI (the token before the first ':'), or null when
// the string isn't a scheme-prefixed URI.
export function uriScheme(uri: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(uri.trim());
  return m ? m[1].toLowerCase() : null;
}

// Whether a URI is a recognized facilitated-payment method we're willing to emit.
export function isFacilitatedPaymentUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const scheme = uriScheme(uri);
  return scheme != null && (FACILITATED_PAYMENT_SCHEMES as readonly string[]).includes(scheme);
}

// Normalize a candidate to a safe facilitated-payment href, or null if it isn't
// a recognized push-payment URI. Used both to validate merchant input on save
// and to gate what the pay page actually renders into <head>.
export function facilitatedPaymentHref(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  return isFacilitatedPaymentUri(trimmed) ? trimmed : null;
}

// Build a UPI push-payment URI (the spec's canonical example):
//   upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=<currency>&tn=<note>
export function buildUpiUri(params: {
  payeeVpa: string;
  payeeName?: string;
  amount?: number; // major units (e.g. rupees)
  currency?: string; // ISO 4217, default INR
  note?: string;
}): string {
  const q = new URLSearchParams();
  q.set("pa", params.payeeVpa);
  if (params.payeeName) q.set("pn", params.payeeName);
  if (params.amount != null && Number.isFinite(params.amount)) q.set("am", params.amount.toFixed(2));
  q.set("cu", (params.currency ?? "INR").toUpperCase());
  if (params.note) q.set("tn", params.note);
  return `upi://pay?${q.toString()}`;
}
