import { enrichIntrospection } from "@/lib/avatars/enrich";
import type { Introspection } from "@/lib/avatars/self-model";

const base: Introspection = {
  say: "Heads-down on my current work.",
  intent: "work_at_desk",
  because: ["goal:core_work(0.90)"],
  confidence: 0.6,
  focus: "core_work",
  energy: 0.8,
  mood: "focused",
};

describe("avatars · enrichIntrospection", () => {
  it("replaces say when the enricher yields a non-empty string", async () => {
    const out = await enrichIntrospection(base, async () => "Reviewing the LP data room before the IC call.");
    expect(out.say).toBe("Reviewing the LP data room before the IC call.");
    // Everything else is preserved.
    expect(out.intent).toBe(base.intent);
    expect(out.because).toBe(base.because);
    expect(out).not.toBe(base); // a new object on replacement
  });

  it("trims the enriched say", async () => {
    const out = await enrichIntrospection(base, async () => "   Sizing the raise.   ");
    expect(out.say).toBe("Sizing the raise.");
  });

  it("keeps the original when the enricher returns null", async () => {
    const out = await enrichIntrospection(base, async () => null);
    expect(out).toBe(base);
    expect(out.say).toBe(base.say);
  });

  it("keeps the original when the enricher returns an empty/whitespace string", async () => {
    expect((await enrichIntrospection(base, async () => "")).say).toBe(base.say);
    expect((await enrichIntrospection(base, async () => "   ")).say).toBe(base.say);
  });

  it("keeps the original (no rejection) when the enricher throws", async () => {
    const out = await enrichIntrospection(base, async () => {
      throw new Error("model exploded");
    });
    expect(out).toBe(base);
    expect(out.say).toBe(base.say);
  });
});
