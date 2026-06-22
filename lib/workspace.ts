// lib/workspace.ts
// Knowledge Workspace logic — Notion clone.
// Block types, document helpers, template presets.

export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bullet_list"
  | "numbered_list"
  | "callout"
  | "divider"
  | "data_embed"
  | "ai_generated";

export type DocType =
  | "note"
  | "ic_memo"
  | "fund_thesis"
  | "deal_memo"
  | "diligence_report"
  | "lp_update"
  | "template"
  | "wiki";

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  metadata?: {
    embedType?: "deal" | "fund" | "investor" | "asset" | "kpi";
    embedId?: string;
    embedLabel?: string;
    level?: 1 | 2 | 3;
    checked?: boolean;
    calloutIcon?: string;
    calloutColor?: "gold" | "blue" | "emerald" | "amber" | "red";
    aiAgent?: string;
  };
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  note: "Note",
  ic_memo: "IC Memo",
  fund_thesis: "Fund Thesis",
  deal_memo: "Deal Memo",
  diligence_report: "Diligence Report",
  lp_update: "LP Update",
  template: "Template",
  wiki: "Wiki",
};

export const DOC_TYPE_ICONS: Record<DocType, string> = {
  note: "○",
  ic_memo: "◈",
  fund_thesis: "▣",
  deal_memo: "◎",
  diligence_report: "⊞",
  lp_update: "◆",
  template: "⊕",
  wiki: "⟷",
};

export const DOC_TYPE_COLORS: Record<DocType, string> = {
  note: "text-slate-400",
  ic_memo: "text-gold-400",
  fund_thesis: "text-emerald-400",
  deal_memo: "text-blue-400",
  diligence_report: "text-amber-400",
  lp_update: "text-purple-400",
  template: "text-slate-300",
  wiki: "text-fg-muted",
};

// Predefined IC Memo template blocks
export const IC_MEMO_TEMPLATE: Block[] = [
  { id: "h1", type: "heading_1", content: "Investment Committee Memo" },
  { id: "h2-exec", type: "heading_2", content: "Executive Summary" },
  { id: "p-exec", type: "paragraph", content: "Brief description of the investment opportunity." },
  { id: "h2-thesis", type: "heading_2", content: "Investment Thesis" },
  { id: "p-thesis", type: "paragraph", content: "Why this investment fits the fund mandate and generates target returns." },
  { id: "h2-struct", type: "heading_2", content: "Transaction Structure" },
  { id: "p-struct", type: "paragraph", content: "Deal structure, pricing, key terms." },
  { id: "h2-dd", type: "heading_2", content: "Diligence Summary" },
  { id: "p-dd", type: "paragraph", content: "Key diligence findings, confirmations, and outstanding items." },
  { id: "h2-risk", type: "heading_2", content: "Risks & Mitigants" },
  { id: "p-risk", type: "paragraph", content: "Material risks identified and how they are mitigated." },
  { id: "h2-returns", type: "heading_2", content: "Return Analysis" },
  { id: "p-returns", type: "paragraph", content: "Base, bear, and bull case returns. Sensitivity analysis summary." },
  { id: "h2-rec", type: "heading_2", content: "Recommendation" },
  { id: "callout-rec", type: "callout", content: "Recommendation: Approve / Decline / Table", metadata: { calloutIcon: "◈", calloutColor: "gold" } },
  { id: "div", type: "divider", content: "" },
];

// Fund Thesis template
export const FUND_THESIS_TEMPLATE: Block[] = [
  { id: "h1", type: "heading_1", content: "Fund Thesis" },
  { id: "h2-focus", type: "heading_2", content: "Investment Focus" },
  { id: "p-focus", type: "paragraph", content: "Asset class, sector, geography, stage." },
  { id: "h2-edge", type: "heading_2", content: "Competitive Advantage" },
  { id: "p-edge", type: "paragraph", content: "Why this team, why now, why this strategy." },
  { id: "h2-target", type: "heading_2", content: "Target Returns" },
  { id: "p-target", type: "paragraph", content: "Gross/net IRR targets, MOIC targets, hold period." },
  { id: "h2-mandate", type: "heading_2", content: "Investment Mandate" },
  { id: "p-mandate", type: "paragraph", content: "Check size, ownership targets, co-investment appetite." },
];

// Generate a unique block ID
export function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}`;
}

// Word count from blocks
export function countWords(blocks: Block[]): number {
  return blocks.reduce((total, block) => {
    return total + (block.content?.split(/\s+/).filter(Boolean).length ?? 0);
  }, 0);
}
