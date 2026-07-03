import { docusignAdapter } from "./docusign";
import type { ActionKind } from "@/lib/gates";
import type { DispatchContext } from "../types";

const ctx = (action: ActionKind): DispatchContext => ({
  orgId: "org-1",
  actorId: "user-1",
  action,
  target: { name: "Acme Family Office", email: "lp@acme.test" },
});

describe("docusign adapter", () => {
  it("is unconfigured in the test env (no Docusign credentials)", () => {
    expect(docusignAdapter.isConfigured()).toBe(false);
  });

  it("prepares a mock envelope for every handled action", async () => {
    for (const action of [
      "sign_document",
      "execute_subdoc",
      "submit_term_sheet",
    ] as ActionKind[]) {
      const result = await docusignAdapter.dispatch(ctx(action));
      expect(result.ok).toBe(true);
      // No credentials in the test env, so it stays in mock mode rather than going live.
      expect(result.live).toBe(false);
      expect(result.channel).toBe("docusign");
      // The detail names both the action and the target.
      expect(result.detail).toContain(action.replace(/_/g, " "));
      expect(result.detail).toContain("Acme Family Office");
    }
  });

  it("prefers the per-org connected flag over the env check", async () => {
    // ctx.connected wins even with no env credentials — but since no real
    // Docusign call is actually wired up yet, a "connected" org must be told
    // honestly that nothing was delivered, not that it was "queued" (the
    // previous behavior, which reported false success and marked the task
    // "completed" for an envelope that was never created).
    const connected = await docusignAdapter.dispatch({ ...ctx("sign_document"), connected: true });
    expect(connected.ok).toBe(false);
    expect(connected.detail).toContain("was not sent");
    expect(connected.error).toBeTruthy();

    // Explicitly not connected keeps it in the prepared (mock) state.
    const notConnected = await docusignAdapter.dispatch({ ...ctx("sign_document"), connected: false });
    expect(notConnected.ok).toBe(true);
    expect(notConnected.detail).toContain("not connected");
  });
});
