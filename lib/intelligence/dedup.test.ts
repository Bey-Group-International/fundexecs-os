// Tests for content hashing + dedup keys — idempotent ingestion depends on these.
import { contentHash, deduplicationKey } from "./dedup";
import type { ProviderObservation } from "./types";

function obs(over: Partial<ProviderObservation> = {}): ProviderObservation {
  return {
    provider: "signal_bureau",
    providerRecordId: "sig_1",
    providerSchemaVersion: "sb.signals.v1",
    observationType: "signal",
    title: "Acme raising Series C",
    summary: "Reported raise",
    observedAt: "2026-07-01T00:00:00.000Z",
    providerAsOf: "2026-07-01T00:00:00.000Z",
    evidenceStatus: "receipted",
    confidence: 0.8,
    sourceUrls: ["https://a.example/1", "https://b.example/2"],
    rawPayload: { id: "sig_1", extra: "x" },
    entityHints: [{ name: "Acme Corp" }],
    expiresAt: null,
    ...over,
  };
}

describe("contentHash", () => {
  it("is stable across identical observations", () => {
    expect(contentHash(obs())).toBe(contentHash(obs()));
  });

  it("ignores source-url ordering and entity-hint case/order", () => {
    const a = contentHash(obs({ sourceUrls: ["https://a.example/1", "https://b.example/2"], entityHints: [{ name: "Acme Corp" }] }));
    const b = contentHash(obs({ sourceUrls: ["https://b.example/2", "https://a.example/1"], entityHints: [{ name: "acme corp" }] }));
    expect(a).toBe(b);
  });

  it("changes when meaning-bearing content changes", () => {
    expect(contentHash(obs())).not.toBe(contentHash(obs({ title: "Acme raising Series D" })));
    expect(contentHash(obs())).not.toBe(contentHash(obs({ providerAsOf: "2026-07-02T00:00:00.000Z" })));
    expect(contentHash(obs())).not.toBe(contentHash(obs({ evidenceStatus: "unreceipted" })));
  });

  it("ignores volatile raw-payload-only noise", () => {
    // rawPayload is not part of the content identity.
    expect(contentHash(obs({ rawPayload: { id: "sig_1", fetched: "now" } }))).toBe(contentHash(obs()));
  });
});

describe("deduplicationKey", () => {
  it("prefers the provider record id", () => {
    const o = obs();
    expect(deduplicationKey(o, "abc")).toBe("signal_bureau:sig_1");
  });

  it("falls back to the content hash when no record id", () => {
    const o = obs({ providerRecordId: null });
    expect(deduplicationKey(o, "abc")).toBe("signal_bureau:hash:abc");
  });
});
