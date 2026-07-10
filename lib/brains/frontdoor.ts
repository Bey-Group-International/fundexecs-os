// Earn Front Door — the Routing Layer.
//
// Earnest Fundmaker qualifies a visitor with five questions and routes them into
// one of five paths. The first question (who you are) determines the path; the
// rest refine the lead summary Earnest produces.

export type PathKey =
  | "emerging_manager"
  | "lp_investor"
  | "business_owner"
  | "advisor_partner"
  | "internal_bgi";

export interface FrontDoorPath {
  key: PathKey;
  label: string;
  blurb: string;
  // What Earnest moves this person toward.
  actions: { label: string; href: string }[];
}

export const PATHS: Record<PathKey, FrontDoorPath> = {
  emerging_manager: {
    key: "emerging_manager",
    label: "Emerging fund manager",
    blurb: "Build your fund strategy, deck, LP list, and outreach engine.",
    actions: [
      { label: "Build fund strategy", href: "/build/profile#thesis" },
      { label: "Open LP pipeline", href: "/source/lp_pipeline" },
      { label: "Ask Earn", href: "/workspace" },
    ],
  },
  lp_investor: {
    key: "lp_investor",
    label: "LP / investor",
    blurb: "Review BGI Fund I, request materials, and book a call.",
    actions: [
      { label: "Run a diligence review", href: "/earn/diligence" },
      { label: "Ask Earn", href: "/workspace" },
    ],
  },
  business_owner: {
    key: "business_owner",
    label: "Business owner",
    blurb: "Submit an acquisition opportunity for review.",
    actions: [
      { label: "Submit a deal", href: "/source/deal_pipeline" },
      { label: "Score my business", href: "/earn/diligence" },
    ],
  },
  advisor_partner: {
    key: "advisor_partner",
    label: "Advisor / partner",
    blurb: "Strategic alignment intake.",
    actions: [
      { label: "Add as partner", href: "/source/partners" },
      { label: "Ask Earn", href: "/workspace" },
    ],
  },
  internal_bgi: {
    key: "internal_bgi",
    label: "Internal BGI team",
    blurb: "Pipeline, research, diligence, and communication.",
    actions: [
      { label: "Command Center", href: "/dashboard" },
      { label: "Diligence Brain", href: "/earn/diligence" },
      { label: "Ask Earn", href: "/workspace" },
    ],
  },
};

export interface FrontDoorQuestion {
  id: string;
  prompt: string;
  options: { value: string; label: string; path?: PathKey }[];
}

// Five qualifying questions. Q1 sets the path; Q2–Q5 refine the lead summary.
export const QUESTIONS: FrontDoorQuestion[] = [
  {
    id: "role",
    prompt: "First — who are we working with today?",
    options: [
      { value: "manager", label: "An emerging fund manager", path: "emerging_manager" },
      { value: "lp", label: "An LP / investor", path: "lp_investor" },
      { value: "owner", label: "A business owner", path: "business_owner" },
      { value: "advisor", label: "An advisor / partner", path: "advisor_partner" },
      { value: "internal", label: "Internal BGI team", path: "internal_bgi" },
    ],
  },
  {
    id: "stage",
    prompt: "Where are you in the journey?",
    options: [
      { value: "exploring", label: "Just exploring" },
      { value: "active", label: "Actively working a raise or deal" },
      { value: "ready", label: "Ready to move now" },
    ],
  },
  {
    id: "focus",
    prompt: "What's the focus?",
    options: [
      { value: "capital", label: "Raising capital" },
      { value: "deal", label: "A specific deal / target" },
      { value: "materials", label: "Materials & diligence" },
      { value: "relationships", label: "Relationships & introductions" },
    ],
  },
  {
    id: "size",
    prompt: "What scale are we working at?",
    options: [
      { value: "sub10", label: "Under $10M" },
      { value: "10to50", label: "$10M – $50M" },
      { value: "50plus", label: "$50M+" },
    ],
  },
  {
    id: "timeline",
    prompt: "And the timeline?",
    options: [
      { value: "now", label: "Now / this quarter" },
      { value: "soon", label: "Next 6 months" },
      { value: "later", label: "Longer-term" },
    ],
  },
];

export function pathFromAnswers(answers: Record<string, string>): PathKey {
  const role = QUESTIONS[0].options.find((o) => o.value === answers["role"]);
  return role?.path ?? "internal_bgi";
}
