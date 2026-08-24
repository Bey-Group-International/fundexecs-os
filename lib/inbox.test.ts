// lib/inbox.test.ts — pure helpers for the notifications inbox. No DB, no
// server-only imports: we exercise the shaping + counting logic on in-memory
// fixtures so it holds independently of Supabase and the Next runtime.
import {
  inboxTotal,
  isInboxEmpty,
  isInboxOverdue,
  workflowToApprovalItem,
  approvalPreview,
  riskForHub,
  diligenceToOverdueItem,
  dealToIcReadyItem,
  riskToInboxItem,
  buildInbox,
  isPrematureFollowupPack,
  EMPTY_INBOX,
} from "@/lib/inbox";
import type { InboxMeeting } from "@/lib/inbox";
import type { DealConviction } from "@/lib/run-conviction";
import type { Deal, DiligenceItem, Task } from "@/lib/supabase/database.types";

const TODAY = "2026-06-20";

// --- Fixture builders -------------------------------------------------------

function deal(id: string, name: string): Deal {
  return {
    id,
    organization_id: "org",
    name,
    stage: "diligence",
    asset_class: null,
    geography: null,
    target_amount: null,
    fund_id: null,
    source: null,
    lead_principal: null,
    thesis_fit: null,
    expected_close: null,
    notes: null,
    session_id: null,
    created_at: "",
    updated_at: "",
  } as unknown as Deal;
}

function dilItem(over: Partial<DiligenceItem> & { id: string; deal_id: string }): DiligenceItem {
  return {
    organization_id: "org",
    document_id: null,
    category: "legal",
    title: "Item",
    status: "open",
    risk_severity: null,
    finding: null,
    likelihood: null,
    mitigation: null,
    residual_severity: null,
    owner: null,
    due_date: null,
    created_at: "",
    updated_at: "",
    ...over,
  } as unknown as DiligenceItem;
}

function conviction(
  d: Deal,
  opts: { stageKey?: DealConviction["stage"]["key"]; diligence?: DiligenceItem[]; openRisks?: DiligenceItem[] } = {},
): DealConviction {
  return {
    deal: d,
    score: 0,
    stage: { key: opts.stageKey ?? "building", label: "", tone: "" },
    checks: [],
    doneCount: 0,
    total: 0,
    baseCase: null,
    cases: [],
    diligence: opts.diligence ?? [],
    coverage: 0,
    openRisks: opts.openRisks ?? [],
    projectedIrr: null,
    projectedMoic: null,
  } as DealConviction;
}

function task(over: Partial<Task> & { id: string }): Pick<Task, "id" | "title" | "description" | "session_id" | "assigned_agent"> {
  return { id: over.id, title: over.title ?? "Workflow", description: over.description ?? null, session_id: over.session_id ?? null, assigned_agent: over.assigned_agent ?? "analyst" };
}

// --- isInboxOverdue ---------------------------------------------------------

describe("isInboxOverdue", () => {
  it("is true for an open item past its due date", () => {
    expect(isInboxOverdue({ due_date: "2026-06-01", status: "open" }, TODAY)).toBe(true);
  });
  it("is false when due date is today or in the future", () => {
    expect(isInboxOverdue({ due_date: TODAY, status: "open" }, TODAY)).toBe(false);
    expect(isInboxOverdue({ due_date: "2026-07-01", status: "open" }, TODAY)).toBe(false);
  });
  it("is false for resolved items even when past due", () => {
    expect(isInboxOverdue({ due_date: "2026-06-01", status: "cleared" }, TODAY)).toBe(false);
    expect(isInboxOverdue({ due_date: "2026-06-01", status: "waived" }, TODAY)).toBe(false);
  });
  it("is false with no due date", () => {
    expect(isInboxOverdue({ due_date: null, status: "open" }, TODAY)).toBe(false);
  });
});

// --- Item shapers -----------------------------------------------------------

describe("item shapers", () => {
  it("workflowToApprovalItem links to the owning session", () => {
    const item = workflowToApprovalItem(task({ id: "t1", title: "Draft IC memo", session_id: "s1" }));
    expect(item).toMatchObject({ id: "approval:t1", kind: "approval", tone: "approval", href: "/session/s1" });
    expect(item.title).toBe("Draft IC memo");
  });
  it("workflowToApprovalItem falls back to /workspace without a session", () => {
    expect(workflowToApprovalItem(task({ id: "t2", session_id: null })).href).toBe("/workspace");
  });
  it("diligenceToOverdueItem links to the deal and names it", () => {
    const item = diligenceToOverdueItem(
      { id: "d1", title: "QoE", category: "financial", due_date: "2026-06-01", deal_id: "deal-1" },
      "Project Atlas",
    );
    expect(item).toMatchObject({ id: "overdue:d1", kind: "overdue", href: "/deal/deal-1" });
    expect(item.subtitle).toContain("Project Atlas");
    expect(item.subtitle).toContain("2026-06-01");
  });
  it("dealToIcReadyItem links to the deal war-room", () => {
    expect(dealToIcReadyItem({ id: "deal-2", name: "Project Beta" })).toMatchObject({
      id: "ic-ready:deal-2",
      kind: "ready",
      href: "/deal/deal-2",
      title: "Project Beta",
    });
  });
  it("riskToInboxItem surfaces the finding when present", () => {
    const withFinding = riskToInboxItem(
      { id: "r1", title: "Customer concentration", finding: "Top client is 60% of revenue", deal_id: "deal-3" },
      "Project Gamma",
    );
    expect(withFinding.href).toBe("/deal/deal-3");
    expect(withFinding.subtitle).toContain("Top client is 60% of revenue");
    const noFinding = riskToInboxItem({ id: "r2", title: "X", finding: null, deal_id: "deal-3" }, "Project Gamma");
    expect(noFinding.subtitle).toContain("Project Gamma");
  });
});

// --- inboxTotal / isInboxEmpty ----------------------------------------------

describe("inboxTotal & isInboxEmpty", () => {
  it("EMPTY_INBOX totals zero and is empty", () => {
    expect(inboxTotal(EMPTY_INBOX)).toBe(0);
    expect(isInboxEmpty(EMPTY_INBOX)).toBe(true);
  });
  it("sums across every group", () => {
    const inbox = {
      needsApproval: [{} as never],
      overdueDiligence: [{} as never, {} as never],
      icReady: [{} as never],
      openRisks: [{} as never, {} as never, {} as never],
    };
    expect(inboxTotal(inbox)).toBe(7);
    expect(isInboxEmpty(inbox)).toBe(false);
  });
});

// --- Deciding an approval in the inbox --------------------------------------
//
// The inbox is the only place approvals get cleared, so an approval row has to
// carry everything the decision needs: the pending approval id, how sensitive
// the action is, and enough of the agent's output to judge it — all resolved on
// the server so opening the detail costs no round-trip.

describe("riskForHub", () => {
  it("grades outward-facing / capital-moving work as high", () => {
    expect(riskForHub("execute")).toBe("high");
  });
  it("grades evaluation work as medium", () => {
    expect(riskForHub("run")).toBe("medium");
  });
  it("grades everything else — and an unknown hub — as routine", () => {
    expect(riskForHub("source")).toBe("low");
    expect(riskForHub("build")).toBe("low");
    expect(riskForHub(null)).toBe("low");
  });
});

describe("approvalPreview", () => {
  it("returns a plain string result as-is", () => {
    expect(approvalPreview("The memo draft")).toBe("The memo draft");
  });
  it("prefers summary over the other prose keys", () => {
    expect(approvalPreview({ body: "body text", summary: "the summary" })).toBe("the summary");
  });
  it("falls through to the next prose key when the preferred one is blank", () => {
    expect(approvalPreview({ summary: "   ", draft: "the draft" })).toBe("the draft");
  });
  it("caps the excerpt at 600 characters", () => {
    expect(approvalPreview({ summary: "x".repeat(900) })).toHaveLength(600);
  });
  it("is null for a result with no prose, an array, or nothing at all", () => {
    expect(approvalPreview({ score: 4, ok: true })).toBeNull();
    expect(approvalPreview(["a", "b"])).toBeNull();
    expect(approvalPreview(null)).toBeNull();
    expect(approvalPreview("")).toBeNull();
  });
});

describe("workflowToApprovalItem — inline decision payload", () => {
  it("carries the approval id, risk, and output excerpt when there is a pending approval", () => {
    const item = workflowToApprovalItem({
      ...task({ id: "t9", title: "Send the LP update", session_id: "s9" }),
      hub: "execute",
      result: { summary: "Draft LP update for Q2." },
      created_at: "2026-06-20T09:00:00.000Z",
      approvalId: "appr-1",
    });
    expect(item.approval).toMatchObject({
      approvalId: "appr-1",
      taskId: "t9",
      risk: "high",
      hubLabel: expect.any(String),
      requestedAt: "2026-06-20T09:00:00.000Z",
      preview: "Draft LP update for Q2.",
    });
    // The deep link survives as an escape hatch, not as the only way to act.
    expect(item.href).toBe("/session/s9");
  });

  it("omits the payload without a pending approval, so the row falls back to its link", () => {
    const item = workflowToApprovalItem({ ...task({ id: "t10" }), hub: "execute", approvalId: null });
    expect(item.approval).toBeUndefined();
    expect(item.href).toBe("/workspace");
  });

  it("does not repeat a deep-link description as detail text", () => {
    // Marketplace interest tasks encode the listing path in `description`; it is
    // already consumed by `href` and would read as gibberish in the detail panel.
    const item = workflowToApprovalItem({
      ...task({ id: "t11", description: "/marketplace/listing-3" }),
      approvalId: "appr-2",
    });
    expect(item.href).toBe("/marketplace/listing-3");
    expect(item.approval?.detail).toBeNull();
  });

  it("keeps a real description as the detail the operator reads before deciding", () => {
    const item = workflowToApprovalItem({
      ...task({ id: "t12", description: "Reply to Acme on the data-room request." }),
      approvalId: "appr-3",
    });
    expect(item.approval?.detail).toBe("Reply to Acme on the data-room request.");
  });
});

// --- buildInbox -------------------------------------------------------------

describe("buildInbox", () => {
  it("groups approvals, overdue diligence, IC-ready, and open risks", () => {
    const atlas = deal("deal-1", "Project Atlas");
    const beta = deal("deal-2", "Project Beta");

    const overdue = dilItem({ id: "di-1", deal_id: "deal-1", title: "QoE", due_date: "2026-06-01", status: "open" });
    const notOverdue = dilItem({ id: "di-2", deal_id: "deal-1", title: "Tax", due_date: "2026-07-01", status: "open" });
    const risk = dilItem({
      id: "di-3",
      deal_id: "deal-2",
      title: "Litigation",
      status: "flagged",
      risk_severity: "critical",
    });

    const inbox = buildInbox(
      [
        conviction(atlas, { diligence: [overdue, notOverdue] }),
        conviction(beta, { stageKey: "ic_ready", openRisks: [risk] }),
      ],
      [task({ id: "t1", title: "Approve & automate: Draft memo", session_id: "s1" })],
      TODAY,
    );

    expect(inbox.needsApproval).toHaveLength(1);
    expect(inbox.overdueDiligence).toHaveLength(1);
    expect(inbox.overdueDiligence[0].id).toBe("overdue:di-1");
    expect(inbox.icReady).toHaveLength(1);
    expect(inbox.icReady[0].id).toBe("ic-ready:deal-2");
    expect(inbox.openRisks).toHaveLength(1);
    expect(inbox.openRisks[0].id).toBe("risk:di-3");
    expect(inboxTotal(inbox)).toBe(4);
  });

  it("yields an empty inbox when nothing is actionable", () => {
    const beta = deal("deal-2", "Project Beta");
    const inbox = buildInbox([conviction(beta, { stageKey: "building" })], [], TODAY);
    expect(isInboxEmpty(inbox)).toBe(true);
  });

  it("holds back a follow-up pack whose meeting is still upcoming, but keeps the prep pack", () => {
    const meetings: InboxMeeting[] = [
      { title: "BGI x Evolution Accelerator", status: "waiting", scheduled_at: "2026-06-25T15:00:00.000Z" },
    ];
    const inbox = buildInbox(
      [],
      [
        task({ id: "t1", title: "BGI x Evolution Accelerator – FundExecs OS Walkthrough Prep Pack" }),
        task({ id: "t2", title: "BGI x Evolution Accelerator Follow-Up Prep Pack" }),
      ],
      TODAY,
      meetings,
      `${TODAY}T00:00:00.000Z`,
    );
    expect(inbox.needsApproval).toHaveLength(1);
    expect(inbox.needsApproval[0].id).toBe("approval:t1");
  });
});

describe("isPrematureFollowupPack", () => {
  const NOW = "2026-06-20T00:00:00.000Z";
  const followup = "BGI x Evolution Accelerator Follow-Up Prep Pack";
  const meeting = (over: Partial<InboxMeeting> = {}): InboxMeeting => ({
    title: "BGI x Evolution Accelerator",
    status: "waiting",
    scheduled_at: "2026-06-25T15:00:00.000Z",
    ...over,
  });

  it("suppresses a follow-up whose matching meeting is scheduled in the future", () => {
    expect(isPrematureFollowupPack(followup, [meeting()], NOW)).toBe(true);
  });

  it("suppresses a follow-up whose matching meeting has no time and isn't ended", () => {
    expect(isPrematureFollowupPack(followup, [meeting({ scheduled_at: null })], NOW)).toBe(true);
  });

  it("keeps a follow-up once its meeting has ended", () => {
    expect(isPrematureFollowupPack(followup, [meeting({ status: "ended" })], NOW)).toBe(false);
  });

  it("keeps a follow-up once the scheduled time has passed", () => {
    expect(
      isPrematureFollowupPack(followup, [meeting({ scheduled_at: "2026-06-10T15:00:00.000Z" })], NOW),
    ).toBe(false);
  });

  it("never suppresses a prep / walkthrough pack, even with an upcoming meeting", () => {
    const prep = "BGI x Evolution Accelerator – FundExecs OS Walkthrough Prep Pack";
    expect(isPrematureFollowupPack(prep, [meeting()], NOW)).toBe(false);
  });

  it("keeps a follow-up that matches no meeting", () => {
    expect(isPrematureFollowupPack(followup, [meeting({ title: "Unrelated Deal" })], NOW)).toBe(false);
    expect(isPrematureFollowupPack(followup, [], NOW)).toBe(false);
  });
});
