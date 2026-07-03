import { getAdapter } from "./registry";
import { dispatchAction } from "./index";
import { mockAdapter } from "./adapters/mock";
import type { ActionKind } from "@/lib/gates";
import type { DispatchContext } from "./types";

const ctx = (action: ActionKind): DispatchContext => ({
  orgId: "org-1",
  actorId: "user-1",
  action,
  target: { name: "Acme Family Office", email: "lp@acme.test" },
});

describe("integration registry", () => {
  it("routes the email family to the Gmail adapter", () => {
    for (const action of [
      "draft_message",
      "send_outreach",
      "send_intro_request",
      "send_diligence_request",
      "distribute_report",
      "share_materials",
    ] as ActionKind[]) {
      expect(getAdapter(action).channel).toBe("gmail");
    }
  });

  it("routes the signing family to the Docusign adapter", () => {
    for (const action of [
      "sign_document",
      "execute_subdoc",
      "submit_term_sheet",
    ] as ActionKind[]) {
      expect(getAdapter(action).channel).toBe("docusign");
    }
  });

  it("falls back to the mock adapter for unclaimed actions", () => {
    for (const action of ["update_pipeline", "score", "research", "build_list"] as ActionKind[]) {
      expect(getAdapter(action).channel).toBe("mock");
    }
  });

  it("routes propose_meeting / confirm_booking to the native meeting adapter by default", () => {
    // Three modules claim these ActionKinds: the inbox's permanently-mock
    // calendly placeholder, the real Calendly adapter, and native meeting
    // rooms. Native must win the generic ActionKind route — it has zero
    // external dependency and is always live — or every meeting action
    // silently degrades to a fabricated mock.fundexecs.local link even when
    // Calendly is fully configured.
    expect(getAdapter("propose_meeting").channel).toBe("native_meeting");
    expect(getAdapter("confirm_booking").channel).toBe("native_meeting");
  });

  it("routes an explicit channel=\"calendly\" hint to the real Calendly adapter, not the inbox mock", () => {
    // The inbox's mock calendly module and the real adapter share the literal
    // channel string "calendly". A call site that explicitly pins to that
    // channel (e.g. replying on a Calendly-sourced inbox thread) must reach
    // the real adapter — which itself degrades gracefully when unconfigured —
    // not the mock that can never call the API no matter what is configured.
    expect(getAdapter("update_pipeline", "calendly").channel).toBe("calendly");
  });

  it("routes an explicit channel=\"slack\" hint to the real (native-delivery) Slack adapter", () => {
    expect(getAdapter("update_pipeline", "slack").channel).toBe("slack");
  });
});

describe("mock adapter", () => {
  it("never goes live and always succeeds", async () => {
    const result = await mockAdapter.dispatch(ctx("update_pipeline"));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.channel).toBe("mock");
    expect(result.detail).toContain("Acme Family Office");
  });
});

describe("dispatchAction", () => {
  it("returns a well-formed result for a routed action", async () => {
    const result = await dispatchAction(ctx("send_outreach"));
    expect(result.channel).toBe("gmail");
    expect(result.ok).toBe(true);
    // No credentials in the test env, so it stays in mock mode rather than going live.
    expect(result.live).toBe(false);
  });

  it("captures an adapter error instead of throwing", async () => {
    const boom: DispatchContext = ctx("send_outreach");
    // Force the routed adapter to throw by handing it a context whose getter
    // explodes when the adapter reads `target`.
    Object.defineProperty(boom, "target", {
      get() {
        throw new Error("kaboom");
      },
    });
    const result = await dispatchAction(boom);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("kaboom");
  });
});
