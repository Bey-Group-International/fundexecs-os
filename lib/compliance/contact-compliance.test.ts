// Coverage for the contact compliance gate. Contracts:
//   - evaluateContactability hard-blocks on suppression, non-"allowed" status,
//     and blocking compliance flags; allows a clean contact.
//   - checkContactable consults both the CRM row and the do-not-contact list.

import {
  evaluateContactability,
  checkContactable,
} from "./contact-compliance";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

describe("evaluateContactability", () => {
  it("allows a clean, allowed contact", () => {
    const r = evaluateContactability({ communication_status: "allowed", compliance_flags: [] });
    expect(r.contactable).toBe(true);
    expect(r.status).toBe("allowed");
  });

  it("treats a missing state as allowed", () => {
    expect(evaluateContactability(null).contactable).toBe(true);
  });

  it("blocks when suppressed regardless of status", () => {
    const r = evaluateContactability({ communication_status: "allowed" }, { suppressed: true });
    expect(r.contactable).toBe(false);
    expect(r.status).toBe("do_not_contact");
  });

  it("blocks a non-allowed communication status", () => {
    for (const status of ["unsubscribed", "bounced", "do_not_contact", "blocked"]) {
      const r = evaluateContactability({ communication_status: status });
      expect(r.contactable).toBe(false);
    }
  });

  it("blocks on a blocking compliance flag", () => {
    const r = evaluateContactability({ communication_status: "allowed", compliance_flags: ["restricted"] });
    expect(r.contactable).toBe(false);
    expect(r.status).toBe("blocked");
    expect(r.reason).toContain("restricted");
  });

  it("ignores a non-blocking flag", () => {
    const r = evaluateContactability({ communication_status: "allowed", compliance_flags: ["vip"] });
    expect(r.contactable).toBe(true);
  });
});

// Minimal chainable Supabase stub. maybeSingle() returns the contact row;
// the do_not_contact query resolves to `suppressionRows`.
function stubDb(opts: {
  contactRow?: Record<string, unknown> | null;
  suppressionRows?: unknown[];
}): SupabaseClient<Database> {
  const builder = (table: string) => {
    const rowsForTable = table === "do_not_contact" ? opts.suppressionRows ?? [] : [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.or = self;
    chain.ilike = self;
    chain.limit = async () => ({ data: rowsForTable, error: null });
    chain.maybeSingle = async () => ({ data: opts.contactRow ?? null, error: null });
    return chain;
  };
  return { from: builder } as unknown as SupabaseClient<Database>;
}

describe("checkContactable", () => {
  it("allows a clean contact not on the suppression list", async () => {
    const db = stubDb({
      contactRow: { communication_status: "allowed", compliance_flags: [], email: "a@b.com", company_domain: "b.com" },
      suppressionRows: [],
    });
    const r = await checkContactable(db, "org1", { contactId: "c1" });
    expect(r.contactable).toBe(true);
  });

  it("blocks when the contact is on the do-not-contact list", async () => {
    const db = stubDb({
      contactRow: { communication_status: "allowed", compliance_flags: [], email: "a@b.com" },
      suppressionRows: [{ id: "dnc1" }],
    });
    const r = await checkContactable(db, "org1", { contactId: "c1" });
    expect(r.contactable).toBe(false);
    expect(r.status).toBe("do_not_contact");
  });

  it("blocks an unsubscribed contact even with an empty suppression list", async () => {
    const db = stubDb({
      contactRow: { communication_status: "unsubscribed", compliance_flags: [] },
      suppressionRows: [],
    });
    const r = await checkContactable(db, "org1", { contactId: "c1" });
    expect(r.contactable).toBe(false);
    expect(r.status).toBe("unsubscribed");
  });
});
