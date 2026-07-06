import {
  uriScheme,
  isFacilitatedPaymentUri,
  facilitatedPaymentHref,
  buildUpiUri,
  FACILITATED_PAYMENT_REL,
} from "@/lib/payment-links";

describe("uriScheme", () => {
  it("extracts and lowercases the scheme", () => {
    expect(uriScheme("UPI://pay?pa=x")).toBe("upi");
    expect(uriScheme("bitcoin:175tWpb8?amount=1")).toBe("bitcoin");
  });
  it("returns null for a non-URI", () => {
    expect(uriScheme("just some text")).toBeNull();
    expect(uriScheme("")).toBeNull();
  });
});

describe("isFacilitatedPaymentUri", () => {
  it("accepts recognized push-payment schemes", () => {
    expect(isFacilitatedPaymentUri("upi://pay?pa=merchant@icici&am=123&cu=INR")).toBe(true);
    expect(isFacilitatedPaymentUri("bitcoin:175tWpb8K1S7?amount=20.3")).toBe(true);
    expect(isFacilitatedPaymentUri("ethereum:0xabc?value=1")).toBe(true);
  });
  it("rejects unknown or unsafe schemes", () => {
    expect(isFacilitatedPaymentUri("javascript:alert(1)")).toBe(false);
    expect(isFacilitatedPaymentUri("https://example.com/pay")).toBe(false);
    expect(isFacilitatedPaymentUri(null)).toBe(false);
    expect(isFacilitatedPaymentUri(undefined)).toBe(false);
  });
});

describe("facilitatedPaymentHref", () => {
  it("passes through a valid URI, trimmed", () => {
    expect(facilitatedPaymentHref("  upi://pay?pa=x  ")).toBe("upi://pay?pa=x");
  });
  it("returns null for anything not a recognized method", () => {
    expect(facilitatedPaymentHref("https://example.com")).toBeNull();
    expect(facilitatedPaymentHref("")).toBeNull();
  });
});

describe("buildUpiUri", () => {
  it("builds the spec's canonical shape", () => {
    const uri = buildUpiUri({ payeeVpa: "merchant3@icici", payeeName: "test", amount: 123, currency: "INR" });
    expect(uriScheme(uri)).toBe("upi");
    expect(uri).toContain("pa=merchant3%40icici");
    expect(uri).toContain("pn=test");
    expect(uri).toContain("am=123.00");
    expect(uri).toContain("cu=INR");
    // Round-trips through the validator we gate rendering on.
    expect(isFacilitatedPaymentUri(uri)).toBe(true);
  });
  it("defaults the currency to INR and omits an absent amount", () => {
    const uri = buildUpiUri({ payeeVpa: "x@bank" });
    expect(uri).toContain("cu=INR");
    expect(uri).not.toContain("am=");
  });
});

describe("FACILITATED_PAYMENT_REL", () => {
  it("is the rel value from the WICG spec", () => {
    expect(FACILITATED_PAYMENT_REL).toBe("facilitated-payment");
  });
});
