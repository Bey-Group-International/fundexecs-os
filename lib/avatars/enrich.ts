// lib/avatars/enrich.ts
// Optional async enrichment for the avatar self-model's `say` line (LIVING-EXECS
// M3 "attachBrain" slow loop). The deterministic FAST loop in self-model.ts
// (introspect()) always produces a sensible local `say`; this layer lets a
// Claude-backed enricher replace it with richer, in-persona phrasing WITHOUT
// touching the sync path. It is intentionally defensive: a null/empty result OR
// a thrown enricher leaves the original Introspection untouched, so the office
// silently keeps its local line whenever enrichment is unavailable or fails.

import type { Introspection } from "@/lib/avatars/self-model";

/**
 * An async producer of a replacement `say` line for an Introspection. Returns a
 * non-empty string to override, or null/empty to keep the original. May throw —
 * enrichIntrospection swallows it and falls back to the original.
 */
export type SayEnricher = (i: Introspection) => Promise<string | null>;

/**
 * Run an optional enricher over an Introspection. Returns a copy of `i` with
 * `say` replaced when the enricher yields a non-empty (trimmed) string; returns
 * the ORIGINAL `i` unchanged when the enricher returns null/empty OR throws.
 * Never rejects — the fast-loop introspection is always a safe fallback.
 */
export async function enrichIntrospection(
  i: Introspection,
  enricher: SayEnricher,
): Promise<Introspection> {
  try {
    const say = await enricher(i);
    if (typeof say === "string" && say.trim().length > 0) {
      return { ...i, say: say.trim() };
    }
    return i;
  } catch {
    return i;
  }
}
