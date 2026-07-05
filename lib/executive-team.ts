export type VirtualExecutiveRole =
  | "executive_assistant"
  | "analyst"
  | "scout"
  | "associate"
  | "rainmaker"
  | "investor_relations"
  | "dealmaker"
  | "closer"
  | "accountant"
  | "tax_specialist"
  | "legal_counsel"
  | "operating_agent";

export type VerificationLevel =
  | "verified"
  | "high_confidence"
  | "medium_confidence"
  | "low_confidence"
  | "unavailable";

export interface ExecutiveRoleDefinition {
  role: VirtualExecutiveRole;
  label: string;
  remit: string;
  approvalBoundary: "internal" | "external_facing" | "capital_binding";
}

export interface ExecutiveRoleRoute {
  role: VirtualExecutiveRole;
  label: string;
  rationale: string;
  approvalBoundary: ExecutiveRoleDefinition["approvalBoundary"];
}

export interface ResearchContactStandard {
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  verification: VerificationLevel;
  sourceUrl: string;
}

export interface ResearchEntityStandard {
  entity: string;
  category: string;
  website: string;
  pointOfContact: ResearchContactStandard;
  strategicFit: string;
  confidence: VerificationLevel;
  sources: string[];
  recommendedNextAction: string;
}

export const EXECUTIVE_ROLES: ExecutiveRoleDefinition[] = [
  { role: "executive_assistant", label: "Executive Assistant", remit: "priorities, follow-ups, scheduling, operating cadence", approvalBoundary: "internal" },
  { role: "analyst", label: "Analyst", remit: "market, company, competitor, financial, and risk analysis", approvalBoundary: "internal" },
  { role: "scout", label: "Scout", remit: "target, investor, partner, contact, and opportunity discovery", approvalBoundary: "external_facing" },
  { role: "associate", label: "Associate", remit: "deal execution, diligence, data rooms, IC memos, and workstreams", approvalBoundary: "internal" },
  { role: "rainmaker", label: "Rainmaker", remit: "strategic relationships, warm paths, partnerships, and capital formation", approvalBoundary: "external_facing" },
  { role: "investor_relations", label: "Investor Relations", remit: "LP updates, investor materials, fundraising follow-up, and reporting", approvalBoundary: "external_facing" },
  { role: "dealmaker", label: "Dealmaker", remit: "transaction strategy, structure, negotiation, financing, and closing probability", approvalBoundary: "capital_binding" },
  { role: "closer", label: "High-Ticket Closer", remit: "qualified prospect conversion, objection handling, and proposals", approvalBoundary: "external_facing" },
  { role: "accountant", label: "Accountant", remit: "budgeting, forecasting, cash flow, reporting, and financial controls", approvalBoundary: "internal" },
  { role: "tax_specialist", label: "Tax Specialist Support", remit: "tax workflow organization and advisor-prep materials", approvalBoundary: "capital_binding" },
  { role: "legal_counsel", label: "Legal Counsel Support", remit: "legal workflow organization, issue spotting, and counsel-prep memos", approvalBoundary: "capital_binding" },
  { role: "operating_agent", label: "Agent for the User", remit: "approved multi-step execution within mandate boundaries", approvalBoundary: "capital_binding" },
];

const ROLE_BY_KEY = Object.fromEntries(EXECUTIVE_ROLES.map((r) => [r.role, r])) as Record<VirtualExecutiveRole, ExecutiveRoleDefinition>;

const ROLE_RULES: Array<{ role: VirtualExecutiveRole; test: RegExp; rationale: string }> = [
  { role: "scout", test: /\b(source|find|search|prospect|target|contact discovery|market map|partner list|investor list)\b/i, rationale: "The request asks for new entities, contacts, targets, investors, or market coverage." },
  { role: "analyst", test: /\b(research|analyze|compare|competitor|market|financial|risk|company profile|brief)\b/i, rationale: "The request requires evidence-backed market, company, competitor, or financial analysis." },
  { role: "associate", test: /\b(diligence|data room|ic memo|checklist|cim|closing checklist|workstream)\b/i, rationale: "The request needs structured execution materials or diligence workstreams." },
  { role: "investor_relations", test: /\b(lp update|investor|fundrais|quarterly|capital raise|subscription|commitment)\b/i, rationale: "The request touches LP communication, capital formation, or investor reporting." },
  { role: "rainmaker", test: /\b(partner|relationship|warm intro|sponsor|strategic|referral|ecosystem)\b/i, rationale: "The request depends on relationship mapping or strategic partnership conversion." },
  { role: "dealmaker", test: /\b(loi|deal structure|negotiate|capital stack|financing|close|transaction|term sheet)\b/i, rationale: "The request involves transaction structure, financing, or closing decisions." },
  { role: "closer", test: /\b(close the prospect|proposal|objection|conversion|sponsor package|sales|commitment)\b/i, rationale: "The request is about moving qualified prospects toward commitment." },
  { role: "accountant", test: /\b(budget|cash flow|forecast|invoice|expense|financial report|variance)\b/i, rationale: "The request requires financial organization, forecasting, or controls." },
  { role: "tax_specialist", test: /\b(tax|k-1|deduction|jurisdictional tax|tax advisor)\b/i, rationale: "The request touches tax-sensitive workflow preparation." },
  { role: "legal_counsel", test: /\b(legal|nda|contract|agreement|compliance|regulatory|side letter|aml|kyc)\b/i, rationale: "The request requires legal/compliance issue spotting and approval boundaries." },
  { role: "executive_assistant", test: /\b(schedule|follow up|remind|meeting prep|daily brief|operating rhythm|task priority)\b/i, rationale: "The request is about operating cadence, follow-up, or prioritization." },
  { role: "operating_agent", test: /\b(execute|automate|run this workflow|agent for me|manage this)\b/i, rationale: "The request asks Earn to operate an approved multi-step workflow." },
];

export function routeExecutiveRoles(prompt: string, maxRoles = 4): ExecutiveRoleRoute[] {
  const matches = ROLE_RULES.filter((rule) => rule.test.test(prompt));
  const selected = matches.length
    ? matches
    : [{ role: "executive_assistant" as const, rationale: "Default operating role for ambiguous requests.", test: /./ }];

  const seen = new Set<VirtualExecutiveRole>();
  return selected
    .filter((rule) => {
      if (seen.has(rule.role)) return false;
      seen.add(rule.role);
      return true;
    })
    .slice(0, maxRoles)
    .map((rule) => {
      const def = ROLE_BY_KEY[rule.role];
      return {
        role: def.role,
        label: def.label,
        rationale: rule.rationale,
        approvalBoundary: def.approvalBoundary,
      };
    });
}

export function emptyResearchContact(): ResearchContactStandard {
  return {
    name: "Not publicly verified",
    role: "Not publicly verified",
    email: "Not publicly verified",
    phone: "Not publicly verified",
    linkedin: "Not publicly verified",
    verification: "unavailable",
    sourceUrl: "Not publicly verified",
  };
}
