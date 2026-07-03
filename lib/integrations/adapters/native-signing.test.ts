// Coverage for the native-signing adapter (audit P2 — the Tier-3 signing
// family used to route to a DocuSign placeholder that could never send; the
// in-repo e-sign system existed but was unreachable from dispatch). The
// contract: post-approval dispatch creates a real DRAFT envelope with the
// counterparty as recipient — never auto-sends — degrades honestly to a
// wizard link when it cannot persist, and reports failure as failure.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionKind } from "@/lib/gates";
import { nativeSigningAdapter, nativeSigningModule } from "./native-signing";
import { getAdapter } from "../registry";
import { docusignAdapter } from "./docusign";
import type { DispatchContext } from "../types";

const ACTOR = "123e4567-e89b-12d3-a456-426614174000";

function makeSupabase(opts: { failEnvelope?: boolean } = {}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const supabase = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown> | Record<string, unknown>[]) {
          const rows = Array.isArray(row) ? row : [row];
          for (const r of rows) inserts.push({ table, row: r });
          const listResult = { data: rows.map((_, i) => ({ id: `rec-${i}` })), error: null };
          const singleResult =
            table === "signing_envelopes" && opts.failEnvelope
              ? { data: null, error: { message: "insert denied" } }
              : { data: { id: "env-1" }, error: null };
          return {
            // .insert().select().single() (envelope) and .insert().select()
            // awaited as a list (recipients) both resolve here.
            select: () => ({
              single: async () => singleResult,
              then: (onFulfilled: (v: unknown) => unknown) =>
                Promise.resolve(listResult).then(onFulfilled),
            }),
            // .insert() awaited directly (signing_events).
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(listResult).then(onFulfilled),
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, inserts };
}

function ctx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    orgId: "org-1",
    actorId: ACTOR,
    action: "sign_document" as ActionKind,
    target: { name: "Dana LP", email: "dana@lp.test" },
    subject: "Subscription Agreement — Fund II",
    body: "Please review and sign the attached subscription agreement.",
    ...overrides,
  };
}

describe("nativeSigningAdapter.dispatch", () => {
  it("creates a real draft envelope with the counterparty as recipient", async () => {
    const { supabase, inserts } = makeSupabase();
    const result = await nativeSigningAdapter.dispatch(ctx({ supabase }));

    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(result.reference).toContain("/envelopes/env-1");

    const envelope = inserts.find((i) => i.table === "signing_envelopes")!.row;
    // Draft only — Tier 3 means a human presses send from the wizard.
    expect(envelope.status).toBe("draft");
    expect(envelope.organization_id).toBe("org-1");
    expect(envelope.created_by).toBe(ACTOR);
    expect(envelope.title).toBe("Subscription Agreement — Fund II");

    const recipient = inserts.find((i) => i.table === "signing_recipients")!.row;
    expect(recipient.email).toBe("dana@lp.test");
    expect(recipient.name).toBe("Dana LP");
    expect(recipient.status).toBe("pending");
  });

  it("degrades to a wizard link (live:false) without a Supabase client", async () => {
    const result = await nativeSigningAdapter.dispatch(ctx());
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.reference).toContain("/envelopes/new");
  });

  it("degrades for a system actor and for a target with no email", async () => {
    const { supabase, inserts } = makeSupabase();
    const system = await nativeSigningAdapter.dispatch(ctx({ supabase, actorId: "system" }));
    expect(system.live).toBe(false);

    const noEmail = await nativeSigningAdapter.dispatch(
      ctx({ supabase, target: { name: "Dana LP" } }),
    );
    expect(noEmail.live).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("reports a persistence failure as a failure, never fake success", async () => {
    const { supabase } = makeSupabase({ failEnvelope: true });
    const result = await nativeSigningAdapter.dispatch(ctx({ supabase }));
    expect(result.ok).toBe(false);
    expect(result.live).toBe(false);
    expect(result.error).toContain("insert denied");
  });
});

describe("registry precedence for the signing family", () => {
  it("routes every signing ActionKind to native_signing by default", () => {
    for (const kind of nativeSigningModule.handles) {
      expect(getAdapter(kind).channel).toBe("native_signing");
    }
  });

  it("still reaches DocuSign via an explicit channel hint", () => {
    expect(getAdapter("sign_document" as ActionKind, "docusign")).toBe(docusignAdapter);
  });
});
