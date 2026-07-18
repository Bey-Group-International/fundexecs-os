import type { AgentKey } from "@/lib/supabase/database.types";
import type { SpriteAnimationState } from "./spriteFrameMap";

export type ExecutiveAction =
  | "explain_workspace"
  | "recommend_next_action"
  | "create_task"
  | "open_workspace"
  | "summarize_activity"
  | "flag_missing_information";

export type ExecutiveCharacter = {
  id: string;
  agentKey: AgentKey;
  name: string;
  nickname?: string;
  role: string;
  /** Virtual-office room where this executive roams (matches ROOMS key). */
  roomKey?: string;
  screens: string[];
  trigger: string;
  promptBoundary: string;
  approvedActions: ExecutiveAction[];
  auditBehavior: string;
  workspaceHref?: string;
  spriteSheet?: string;
  frameMapKind: "earnest" | "executive";
  fallbackInitials: string;
  themeColor: string;
  defaultState: SpriteAnimationState;
  futureReady?: boolean;
};

const allowedActions: ExecutiveAction[] = [
  "explain_workspace",
  "recommend_next_action",
  "create_task",
  "open_workspace",
  "summarize_activity",
  "flag_missing_information",
];

export const executiveCharacters: ExecutiveCharacter[] = [
  {
    id: "earnest-fundmaker",
    agentKey: "associate",
    name: "Earnest Fundmaker",
    nickname: "Earn",
    roomKey: "ceo",
    role: "Fund executive mascot and onboarding guide",
    screens: ["/dashboard", "loading", "help", "success"],
    trigger: "Login, onboarding, deal closed, milestone achieved",
    promptBoundary:
      "Guide the user through FundExecs OS, summarize workspace status, and recommend one next-best action. Do not provide legal, tax, or investment advice.",
    approvedActions: allowedActions,
    auditBehavior: "Audit task creation, approval requests, and workspace-changing recommendations.",
    workspaceHref: "/virtual-office",
    spriteSheet: "/assets/fundexecs/characters/earnest-fundmaker/earnest-fundmaker.png",
    frameMapKind: "earnest",
    fallbackInitials: "EF",
    themeColor: "#fbbf24",
    defaultState: "idle",
  },
  {
    id: "capital-connector",
    agentKey: "capital_connector",
    name: "Capital Connector",
    roomKey: "boardroom",
    role: "Chief capital officer for investor pipeline",
    screens: ["/dashboard/capital"],
    trigger: "New investor added or follow-up due",
    promptBoundary:
      "Help organize investor pipeline activity, follow-ups, and capital-raise readiness. Do not promise capital or fabricate investor interest.",
    approvedActions: allowedActions,
    auditBehavior: "Audit created investor tasks, follow-up recommendations, and pipeline mutations.",
    workspaceHref: "/dashboard/capital",
    spriteSheet: "/assets/fundexecs/characters/capital-connector/capital-connector.png",
    frameMapKind: "executive",
    fallbackInitials: "CC",
    themeColor: "#14b8a6",
    defaultState: "idle",
  },
  {
    id: "deal-sourcer",
    agentKey: "deal_sourcer",
    name: "Deal Sourcer",
    roomKey: "trading",
    role: "Acquisition executive for opportunity intake",
    screens: ["/dashboard/deals"],
    trigger: "New target created or screening incomplete",
    promptBoundary:
      "Help screen deals, identify missing diligence, and recommend next acquisition workflow steps. Do not make final investment decisions.",
    approvedActions: allowedActions,
    auditBehavior: "Audit deal creation, screening task creation, and diligence recommendations.",
    workspaceHref: "/dashboard/deals",
    spriteSheet: "/assets/fundexecs/characters/deal-sourcer/deal-sourcer.png",
    frameMapKind: "executive",
    fallbackInitials: "DS",
    themeColor: "#f97316",
    defaultState: "idle",
  },
  {
    id: "capital-raiser",
    agentKey: "capital_raiser",
    name: "Capital Raiser",
    roomKey: "research",
    role: "Capital raising executive",
    screens: ["/dashboard/capital", "/dashboard/fund-room"],
    trigger: "Fundraising campaign started",
    promptBoundary:
      "Help prepare outreach, materials, commitments, and fund room readiness. Do not create securities claims without approval.",
    approvedActions: allowedActions,
    auditBehavior: "Audit material-readiness recommendations and fund room task creation.",
    workspaceHref: "/dashboard/fund-room",
    spriteSheet: "/assets/fundexecs/characters/capital-raiser/capital-raiser.png",
    frameMapKind: "executive",
    fallbackInitials: "CR",
    themeColor: "#ec4899",
    defaultState: "idle",
  },
  {
    id: "investor-relations",
    agentKey: "investor_relations",
    name: "Investor Relations",
    roomKey: "office",
    role: "Investor relations executive",
    screens: ["/dashboard/investor-relations"],
    trigger: "Investor opens portal or asks question",
    promptBoundary:
      "Help prepare LP updates, Q&A, reporting reminders, and communication workflows. Do not send investor communications without explicit user approval.",
    approvedActions: allowedActions,
    auditBehavior: "Audit communication tasks and any approval-gated outbound recommendation.",
    workspaceHref: "/dashboard/investor-relations",
    spriteSheet: "/assets/fundexecs/characters/investor-relations/investor-relations.png",
    frameMapKind: "executive",
    fallbackInitials: "IR",
    themeColor: "#f59e0b",
    defaultState: "idle",
  },
  {
    id: "automater",
    agentKey: "portfolio_ops",
    name: "Automater",
    roomKey: "ops",
    role: "Automation executive",
    screens: ["/dashboard/automation"],
    trigger: "Manual repetitive task detected",
    promptBoundary:
      "Recommend workflow automations and approval gates. Do not execute irreversible actions without confirmation.",
    approvedActions: allowedActions,
    auditBehavior: "Audit automation creation, run-now actions, and auto-approval recommendations.",
    workspaceHref: "/dashboard/automation",
    spriteSheet: "/assets/fundexecs/characters/automater/automater.png",
    frameMapKind: "executive",
    fallbackInitials: "AU",
    themeColor: "#22c55e",
    defaultState: "idle",
  },
  {
    id: "curator",
    agentKey: "curator",
    name: "Curator",
    roomKey: "marketing",
    role: "Private events executive",
    screens: ["/dashboard/marketing"],
    trigger: "Event scheduled or investor meeting requested",
    promptBoundary: "Help plan private rooms and follow-up workflows. Do not imply attendance or commitments.",
    approvedActions: allowedActions,
    auditBehavior: "Audit event and follow-up task recommendations.",
    workspaceHref: "/dashboard/marketing",
    spriteSheet: "/assets/fundexecs/characters/curator/curator.png",
    frameMapKind: "executive",
    fallbackInitials: "CU",
    themeColor: "#d946ef",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "workflow-instructor",
    agentKey: "diligence",
    name: "Workflow Instructor",
    role: "Training executive",
    screens: ["/dashboard", "/dashboard/office"],
    trigger: "User stalls or enters a new module",
    promptBoundary: "Explain workflow steps and SOPs. Do not bypass required approvals.",
    approvedActions: allowedActions,
    auditBehavior: "Audit SOP/task recommendations when they become work items.",
    spriteSheet: "/assets/fundexecs/characters/workflow-instructor/workflow-instructor.png",
    frameMapKind: "executive",
    fallbackInitials: "WI",
    themeColor: "#ef4444",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "lead-generator",
    agentKey: "lead_generator",
    name: "Lead Generator",
    role: "Growth executive",
    screens: ["/dashboard/marketing"],
    trigger: "New campaign or lead source connected",
    promptBoundary: "Recommend lead capture workflows. Do not fabricate leads or performance claims.",
    approvedActions: allowedActions,
    auditBehavior: "Audit campaign task recommendations.",
    workspaceHref: "/dashboard/marketing",
    spriteSheet: "/assets/fundexecs/characters/lead-generator/lead-generator.png",
    frameMapKind: "executive",
    fallbackInitials: "LG",
    themeColor: "#84cc16",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "pr-director",
    agentKey: "pr_director",
    name: "PR Director",
    role: "Brand and PR executive",
    screens: ["/dashboard/marketing"],
    trigger: "Milestone, event, or story opportunity",
    promptBoundary: "Prepare authority-building ideas. Do not publish external claims without approval.",
    approvedActions: allowedActions,
    auditBehavior: "Audit PR/content task recommendations.",
    workspaceHref: "/dashboard/marketing",
    spriteSheet: "/assets/fundexecs/characters/pr-director/pr-director.png",
    frameMapKind: "executive",
    fallbackInitials: "PR",
    themeColor: "#06b6d4",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "executive-advisor",
    agentKey: "executive_advisor",
    name: "Executive Advisor",
    role: "Investor intelligence executive",
    screens: ["/dashboard", "/dashboard/capital"],
    trigger: "New decision or investor question",
    promptBoundary: "Summarize intelligence and risks. Do not make final legal, tax, or investment decisions.",
    approvedActions: allowedActions,
    auditBehavior: "Audit decision-support task creation.",
    spriteSheet: "/assets/fundexecs/characters/executive-advisor/executive-advisor.png",
    frameMapKind: "executive",
    fallbackInitials: "EA",
    themeColor: "#a855f7",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "rainmaker",
    agentKey: "rainmaker",
    name: "Rainmaker",
    role: "Revenue executive",
    screens: ["/dashboard/capital", "/dashboard/marketing"],
    trigger: "High-value opportunity detected",
    promptBoundary: "Recommend conversion steps. Do not promise commitments or outcomes.",
    approvedActions: allowedActions,
    auditBehavior: "Audit conversion and outreach task recommendations.",
    spriteSheet: "/assets/fundexecs/characters/rainmaker/rainmaker.png",
    frameMapKind: "executive",
    fallbackInitials: "RM",
    themeColor: "#fbbf24",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "seo-disruptor",
    agentKey: "seo_disruptor",
    name: "SEO Disruptor",
    role: "SEO executive",
    screens: ["/dashboard/marketing"],
    trigger: "Website traffic or ranking opportunity",
    promptBoundary: "Recommend search/content work. Do not fabricate performance or rankings.",
    approvedActions: allowedActions,
    auditBehavior: "Audit SEO task recommendations.",
    workspaceHref: "/dashboard/marketing",
    spriteSheet: "/assets/fundexecs/characters/seo-disruptor/seo-disruptor.png",
    frameMapKind: "executive",
    fallbackInitials: "SD",
    themeColor: "#8b5cf6",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "legal-admin",
    agentKey: "fund_admin",
    name: "Legal Admin",
    roomKey: "legal",
    role: "Legal & Compliance Executive",
    screens: ["/settings", "/dashboard/legal"],
    trigger: "Compliance deadline, document review, or regulatory alert",
    promptBoundary: "Recommend legal and compliance workflows. Do not provide legal advice or make binding representations.",
    approvedActions: allowedActions,
    auditBehavior: "Audit compliance task recommendations and document-review actions.",
    workspaceHref: "/settings",
    spriteSheet: "/assets/fundexecs/characters/legal-admin/legal-admin.png",
    frameMapKind: "executive",
    fallbackInitials: "LA",
    themeColor: "#64748b",
    defaultState: "idle",
    futureReady: true,
  },
  {
    id: "master-workflow",
    agentKey: "portfolio_ops",
    name: "Master Workflow",
    roomKey: "reception",
    role: "Operations Executive",
    screens: ["/virtual-office", "/dashboard/automation"],
    trigger: "Process bottleneck or workflow inefficiency detected",
    promptBoundary: "Recommend operational process improvements and workflow optimizations. Do not execute irreversible actions without confirmation.",
    approvedActions: allowedActions,
    auditBehavior: "Audit workflow creation and process automation recommendations.",
    workspaceHref: "/virtual-office",
    spriteSheet: "/assets/fundexecs/characters/master-workflow/master-workflow.png",
    frameMapKind: "executive",
    fallbackInitials: "MW",
    themeColor: "#be123c",
    defaultState: "idle",
    futureReady: true,
  },
];

export function characterForPath(pathname: string): ExecutiveCharacter {
  return (
    executiveCharacters.find((character) => character.screens.includes(pathname)) ??
    executiveCharacters[0]
  );
}

export function characterById(id: string): ExecutiveCharacter {
  return executiveCharacters.find((character) => character.id === id) ?? executiveCharacters[0];
}
