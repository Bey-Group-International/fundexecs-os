import { nudgeGuests, type BroadcastCapable } from "./admission-broadcast";
import { ADMISSION_NUDGE, admissionChannelName } from "./admission-channel";

/** A client that records what was published, and can be made to fail. */
function client(opts: { throws?: boolean; legacy?: boolean; neither?: boolean } = {}) {
  const sent: Array<{ channel: string; event: string; payload: unknown }> = [];
  const supabase: BroadcastCapable = {
    channel: (name: string) => {
      if (opts.neither) return {};
      if (opts.legacy) {
        return {
          send: async (args: { type: string; event: string; payload: unknown }) => {
            if (opts.throws) throw new Error("down");
            sent.push({ channel: name, event: args.event, payload: args.payload });
            return "ok";
          },
        };
      }
      return {
        httpSend: async (event: string, payload: unknown) => {
          if (opts.throws) throw new Error("down");
          sent.push({ channel: name, event, payload });
          return "ok";
        },
      };
    },
  };
  return { supabase, sent };
}

describe("nudgeGuests", () => {
  it("publishes one nudge per guest, on that guest's channel", async () => {
    const c = client();
    const result = await nudgeGuests(c.supabase, "abc-defg-hi", ["g1", "g2"]);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(c.sent.map((s) => s.channel)).toEqual([
      admissionChannelName("abc-defg-hi", "g1"),
      admissionChannelName("abc-defg-hi", "g2"),
    ]);
  });

  it("uses the agreed event name", async () => {
    const c = client();
    await nudgeGuests(c.supabase, "abc-defg-hi", ["g1"]);
    expect(c.sent[0].event).toBe(ADMISSION_NUDGE);
  });

  // The message is a nudge, not a verdict: a payload saying "admitted" on a
  // channel anyone with the room code can publish to would be worth forging.
  it("carries no verdict — nothing for a forger to imitate usefully", async () => {
    const c = client();
    await nudgeGuests(c.supabase, "abc-defg-hi", ["g1"]);
    expect(c.sent[0].payload).toEqual({});
    expect(JSON.stringify(c.sent[0].payload)).not.toMatch(/admit|deny|status/i);
  });

  it("does nothing, successfully, for no guests", async () => {
    const c = client();
    expect(await nudgeGuests(c.supabase, "abc-defg-hi", [])).toEqual({ sent: 0, failed: 0 });
    expect(c.sent).toHaveLength(0);
  });

  // Delivery is best-effort by design: the decision is already stored, and every
  // guest polls as a safety net. This must never throw into the caller.
  it("reports failures instead of throwing", async () => {
    const c = client({ throws: true });
    await expect(nudgeGuests(c.supabase, "abc-defg-hi", ["g1", "g2"])).resolves.toEqual({ sent: 0, failed: 2 });
  });

  it("falls back to send() on a client without httpSend", async () => {
    const c = client({ legacy: true });
    expect(await nudgeGuests(c.supabase, "abc-defg-hi", ["g1"])).toEqual({ sent: 1, failed: 0 });
    expect(c.sent[0].event).toBe(ADMISSION_NUDGE);
  });

  it("counts a client that can do neither as failed, rather than crashing", async () => {
    const c = client({ neither: true });
    expect(await nudgeGuests(c.supabase, "abc-defg-hi", ["g1"])).toEqual({ sent: 0, failed: 1 });
  });
});
