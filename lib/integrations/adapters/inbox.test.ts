// Coverage for the shared makeModule() honesty fix: a channel the org has
// connected but that has no real provider call wired up must report an honest
// not-delivered failure (ok:false) rather than the "queued" success it used
// to claim — the exact defect that let an approved reply appear sent while
// the counterparty received nothing.
import { slackModule, googleCalendarModule, zoomModule, googleMeetModule } from "./inbox";
import type { ActionKind } from "@/lib/gates";
import type { DispatchContext } from "../types";

const ctx = (overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  orgId: "org-1",
  actorId: "user-1",
  action: "update_pipeline" as ActionKind,
  target: { name: "Acme Family Office", email: "lp@acme.test" },
  ...overrides,
});

describe.each([
  { name: "slack", module: slackModule },
  { name: "google_calendar", module: googleCalendarModule },
  { name: "zoom", module: zoomModule },
  { name: "google_meet", module: googleMeetModule },
])("$name inbox adapter", ({ module }) => {
  it("prepares (ok:true, live:false) when not connected", async () => {
    const result = await module.adapter.dispatch(ctx({ connected: false }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.detail).toContain("Acme Family Office");
  });

  it("reports an honest not-delivered failure when connected, instead of a fake success", async () => {
    const result = await module.adapter.dispatch(ctx({ connected: true }));
    expect(result.ok).toBe(false);
    expect(result.live).toBe(false);
    expect(result.detail.toLowerCase()).toContain("not");
    expect(result.error).toBeTruthy();
    // The old "Queued ... via connected X" wording claimed a future action
    // that no queue or worker would ever perform — must not reappear.
    expect(result.detail.toLowerCase()).not.toContain("queued");
  });
});

describe("googleCalendarModule / zoomModule / googleMeetModule mock references", () => {
  it("only attach a reference in the not-connected preview, never on a not-delivered result", async () => {
    const notConnected = await zoomModule.adapter.dispatch(ctx({ connected: false }));
    expect(notConnected.reference).toMatch(/^https:\/\/mock\.fundexecs\.local\//);

    const connected = await zoomModule.adapter.dispatch(ctx({ connected: true }));
    expect(connected.reference).toBeUndefined();
  });
});
