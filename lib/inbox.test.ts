// lib/inbox.test.ts — pure helpers for the notifications inbox. No DB, no
// server-only imports: we exercise the shaping + counting logic on in-memory
// fixtures so it holds independently of Supabase and the Next runtime.
import {
  inboxTotal,
  isInboxEmpty,
  isInboxOverdue,
  workflowToApprovalItem,
  diligenceToOverdueItem,
  dealToIcReadyItem,
  riskToInboxItem,
  buildInbox,
  EMPTY_INBOX,
} from "@/lib/inbox";
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

function task(over: Partial<Task> & { id: string }): Pick<Task, "id" | "title" | "session_id"> {
  return { id: over.id, title: over.title ?? "Workflow", session_id: over.session_id ?? null };
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
  it("workflowToApprovalItem falls back to /inbox without a session", () => {
    expect(workflowToApprovalItem(task({ id: "t2", session_id: null })).href).toBe("/inbox");
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
});
