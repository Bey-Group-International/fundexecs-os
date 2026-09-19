import { planMerge, strictestCommunicationStatus, type MergeableContact } from "@/lib/network-merge";

function contact(over: Partial<MergeableContact> = {}): MergeableContact {
  return { id: "c1", full_name: "Ada Lovelace", ...over };
}

describe("strictestCommunicationStatus", () => {
  it("keeps an opt-out whichever record carried it", () => {
    expect(strictestCommunicationStatus("allowed", "unsubscribed")).toBe("unsubscribed");
    expect(strictestCommunicationStatus("unsubscribed", "allowed")).toBe("unsubscribed");
  });

  it("ranks do_not_contact and blocked above unsubscribed", () => {
    expect(strictestCommunicationStatus("unsubscribed", "do_not_contact")).toBe("do_not_contact");
    expect(strictestCommunicationStatus("do_not_contact", "blocked")).toBe("blocked");
  });

  it("treats a null as allowed", () => {
    expect(strictestCommunicationStatus(null, null)).toBe("allowed");
    expect(strictestCommunicationStatus(null, "bounced")).toBe("bounced");
  });

  it("treats an unknown status as restrictive rather than permissive", () => {
    // A status this code does not recognise must not be a way to recover
    // permission to contact someone.
    expect(strictestCommunicationStatus("allowed", "quarantined")).toBe("quarantined");
  });
});

describe("planMerge", () => {
  it("fills empty fields on the winner without overwriting populated ones", () => {
    const { patch } = planMerge(
      contact({ title: "Partner", email: null, phone: null }),
      contact({ id: "c2", title: "Managing Director", email: "ada@example.com", phone: "+1 555 0100" }),
    );
    expect(patch.email).toBe("ada@example.com");
    expect(patch.phone).toBe("+1 555 0100");
    // The winner's own title stands.
    expect(patch).not.toHaveProperty("title");
  });

  it("treats a blank string as empty", () => {
    const { patch } = planMerge(contact({ company: "   " }), contact({ id: "c2", company: "Analytical Engines" }));
    expect(patch.company).toBe("Analytical Engines");
  });

  it("unions tags and compliance flags", () => {
    const { patch } = planMerge(
      contact({ tags: ["lp"], compliance_flags: ["kyc_pending"] }),
      contact({ id: "c2", tags: ["lp", "priority"], compliance_flags: ["sanctions_review"] }),
    );
    expect(patch.tags).toEqual(["lp", "priority"]);
    expect(patch.compliance_flags).toEqual(["kyc_pending", "sanctions_review"]);
  });

  it("carries the stricter outbound status onto the surviving record", () => {
    const { patch } = planMerge(
      contact({ communication_status: "allowed" }),
      contact({ id: "c2", communication_status: "unsubscribed" }),
    );
    expect(patch.communication_status).toBe("unsubscribed");
  });

  it("never relaxes an opt-out the winner already had", () => {
    const { patch } = planMerge(
      contact({ communication_status: "do_not_contact" }),
      contact({ id: "c2", communication_status: "allowed" }),
    );
    expect(patch).not.toHaveProperty("communication_status");
  });

  it("takes the higher warmth score with its matching label", () => {
    const { patch } = planMerge(
      contact({ strength_score: 20, strength_label: "cold" }),
      contact({ id: "c2", strength_score: 80, strength_label: "strong" }),
    );
    expect(patch.strength_score).toBe(80);
    expect(patch.strength_label).toBe("strong");
  });

  it("leaves the winner's score alone when it is already higher", () => {
    const { patch } = planMerge(
      contact({ strength_score: 80, strength_label: "strong" }),
      contact({ id: "c2", strength_score: 20, strength_label: "cold" }),
    );
    expect(patch).not.toHaveProperty("strength_score");
  });

  it("takes the more recent activity date", () => {
    const { patch } = planMerge(
      contact({ last_activity_at: "2026-01-01T00:00:00.000Z" }),
      contact({ id: "c2", last_activity_at: "2026-06-01T00:00:00.000Z" }),
    );
    expect(patch.last_activity_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("appends the duplicate's notes rather than replacing them", () => {
    const { patch } = planMerge(
      contact({ notes: "Met at the AGM." }),
      contact({ id: "c2", notes: "Introduced by Grace." }),
    );
    expect(patch.notes).toContain("Met at the AGM.");
    expect(patch.notes).toContain("Introduced by Grace.");
  });

  it("does not duplicate notes that are already present", () => {
    const { patch } = planMerge(
      contact({ notes: "Met at the AGM. Introduced by Grace." }),
      contact({ id: "c2", notes: "Introduced by Grace." }),
    );
    expect(patch).not.toHaveProperty("notes");
  });

  it("carries verification over but not away", () => {
    const gained = planMerge(
      contact({ verified: false, confidence: 40 }),
      contact({ id: "c2", verified: true, confidence: 90 }),
    );
    expect(gained.patch.verified).toBe(true);
    expect(gained.patch.confidence).toBe(90);

    const kept = planMerge(contact({ verified: true }), contact({ id: "c2", verified: false }));
    expect(kept.patch).not.toHaveProperty("verified");
  });

  it("keeps organization visibility when a shared record is merged into a private one", () => {
    const { patch } = planMerge(
      contact({ visibility: "private" }),
      contact({ id: "c2", visibility: "org" }),
    );
    // The information was already visible to the org; a merge cannot un-share it.
    expect(patch.visibility).toBe("org");
  });

  it("does not make a private record public when the duplicate was also private", () => {
    const { patch } = planMerge(
      contact({ visibility: "private" }),
      contact({ id: "c2", visibility: "private" }),
    );
    expect(patch).not.toHaveProperty("visibility");
  });

  it("produces an empty patch when there is nothing to merge", () => {
    const same = contact({ title: "Partner", email: "ada@example.com", tags: ["lp"] });
    const { patch, summary } = planMerge(same, { ...same, id: "c2" });
    expect(patch).toEqual({});
    expect(summary).toEqual([]);
  });

  it("describes what it did, for the timeline entry", () => {
    const { summary } = planMerge(
      contact({ email: null }),
      contact({ id: "c2", email: "ada@example.com", communication_status: "unsubscribed" }),
    );
    expect(summary).toContain("filled email");
    expect(summary.some((s) => s.includes("stricter outbound status"))).toBe(true);
  });
});
