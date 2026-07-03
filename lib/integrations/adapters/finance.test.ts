// Same honesty fix as inbox.test.ts, for the finance ingest channels: a
// connected-but-unwired Xero/Jax channel must report ok:false rather than
// falsely claiming the action was queued.
import { xeroModule, jaxModule } from "./finance";
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
  { name: "xero", module: xeroModule },
  { name: "jax", module: jaxModule },
])("$name finance adapter", ({ module }) => {
  it("prepares (ok:true, live:false) when not connected", async () => {
    const result = await module.adapter.dispatch(ctx({ connected: false }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
  });

  it("reports an honest not-delivered failure when connected, instead of a fake success", async () => {
    const result = await module.adapter.dispatch(ctx({ connected: true }));
    expect(result.ok).toBe(false);
    expect(result.live).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.detail.toLowerCase()).not.toContain("queued");
  });
});
