// The two product flows as deterministic scripts. Both open with a user prompt
// and an Earn recommendation gated on approval; they diverge at execution:
//
//   Flow A — User-Driven Automation: Earn delegates, the executive team takes
//            over the work in parallel across their offices.
//   Flow B — Earn-Driven Execution: Earn takes the work directly; executives
//            assist as needed.
//
// A live-Earn adapter can synthesize the same Step[] at runtime instead of
// replaying these constants.

import type { Step } from "./engine";

export const FLOW_A_PROMPT =
  "Open an outbound capital raise to anchor LPs for Fund III — $40M target.";

export const FLOW_A: Step[] = [
  { kind: "say", role: "user", text: FLOW_A_PROMPT },
  { kind: "phase", label: "Earn analyzing the mandate" },
  { kind: "wait", ms: 900 },
  {
    kind: "say",
    role: "earn",
    text: "Here's the play. We anchor first, then widen the funnel.",
    detail: [
      "Capital Raiser opens the Founding Capital Circle to 12 anchor LPs",
      "Investor Relations stages the data room + Fund III LP update",
      "Rainmaker sequences warm intros from the relationship graph",
      "Lead Generator runs the qualified-LP funnel in parallel",
    ],
    awaitsApproval: true,
  },
  { kind: "gateApproval" },
  { kind: "phase", label: "Approved — automating" },
  {
    kind: "say",
    role: "earn",
    text: "Approved. I'm delegating to the capital team now — watch the floor.",
  },
  { kind: "delegate", who: "earn" },
  { kind: "wait", ms: 700 },
  { kind: "assign", who: "capital_raiser", room: "relationship", standIndex: 1, task: "Anchor LP outreach" },
  { kind: "assign", who: "investor_relations", room: "relationship", standIndex: 0, task: "Stage data room + LP update" },
  { kind: "assign", who: "rainmaker", room: "outbound", standIndex: 0, task: "Warm-intro sequencing" },
  { kind: "assign", who: "lead_generator", room: "outbound", standIndex: 1, task: "Qualified-LP funnel" },
  { kind: "awaitArrivals" },
  {
    kind: "say",
    role: "earn",
    text: "Team's in position. Capital Raiser and IR are on anchors; Rainmaker and Lead Gen are working the funnel.",
  },
  { kind: "awaitWork", ms: 4200 },
  {
    kind: "say",
    role: "earn",
    text: "First pass done: 12 anchors contacted, data room live, 38 qualified LPs queued. Want me to schedule the intro calls?",
  },
  { kind: "completeAll" },
  { kind: "done" },
];

export const FLOW_B_PROMPT =
  "Tighten the Fund III mandate thesis and flag any diligence gaps before we send it.";

export const FLOW_B: Step[] = [
  { kind: "say", role: "user", text: FLOW_B_PROMPT },
  { kind: "phase", label: "Earn analyzing the mandate" },
  { kind: "wait", ms: 900 },
  {
    kind: "say",
    role: "earn",
    text: "This one I'll take directly — it's a tight reasoning loop, not a campaign.",
    detail: [
      "I'll rewrite the thesis for sector focus and check size discipline",
      "Analyst pulls comps to pressure-test the return profile",
      "Diligence sweeps the data room for open risk flags",
    ],
    awaitsApproval: true,
  },
  { kind: "gateApproval" },
  { kind: "phase", label: "Accepted — Earn taking over" },
  {
    kind: "say",
    role: "earn",
    text: "Accepted. Taking it to the Mandate desk myself; pulling Analyst and Diligence in to assist.",
  },
  { kind: "earnGoto", room: "mandate", standIndex: 0, task: "Refining mandate thesis" },
  { kind: "assign", who: "analyst", room: "mandate", standIndex: 1, task: "Comp pressure-test" },
  { kind: "assign", who: "diligence", room: "diligence", standIndex: 0, task: "Risk-flag sweep" },
  { kind: "awaitArrivals" },
  {
    kind: "say",
    role: "earn",
    text: "Working it now. Thesis is narrowing to lower-mid-market services; Analyst is rerunning comps, Diligence is on the data room.",
  },
  { kind: "awaitWork", ms: 4200 },
  {
    kind: "say",
    role: "earn",
    text: "Done. Thesis tightened, 3 diligence gaps flagged (customer concentration, lease tail, working-capital swing). Ready to send?",
  },
  { kind: "completeAll" },
  { kind: "done" },
];

export interface FlowDescriptor {
  kind: "A" | "B";
  title: string;
  blurb: string;
  prompt: string;
  steps: Step[];
}

export const FLOWS: FlowDescriptor[] = [
  {
    kind: "A",
    title: "Flow A — Automate with the team",
    blurb: "Earn delegates; executives take over in parallel.",
    prompt: FLOW_A_PROMPT,
    steps: FLOW_A,
  },
  {
    kind: "B",
    title: "Flow B — Earn executes directly",
    blurb: "Earn takes the work; executives assist.",
    prompt: FLOW_B_PROMPT,
    steps: FLOW_B,
  },
];
