// lib/builder-wizard.ts
// The document builder's "guided setup" — a short, section-aware questionnaire.
// The operator answers plain questions; Earn then expands the answers into an
// institutional-grade document. Pure: question sets + a deterministic fallback
// assembler (used when Earn is offline), both unit-tested.

export interface WizardQuestion {
  id: string;
  label: string;
  hint?: string;
  multiline?: boolean;
}

const GENERIC: WizardQuestion[] = [
  { id: "purpose", label: "What should this document accomplish?", hint: "The job it needs to do." },
  { id: "audience", label: "Who is the audience?", hint: "LPs, co-investors, lenders, partners…" },
  { id: "key_points", label: "Key points to include", multiline: true },
  { id: "constraints", label: "Anything specific to emphasize or avoid?", multiline: true },
];

const BY_SECTION: Record<string, WizardQuestion[]> = {
  overview: [
    { id: "oneliner", label: "In one sentence, what does your firm do?" },
    { id: "edge", label: "What is your differentiated edge?" },
    { id: "highlights", label: "Top highlights to lead with", multiline: true },
    { id: "audience", label: "Who is this for?", hint: "LPs, co-investors, lenders…" },
  ],
  marketing: [
    { id: "oneliner", label: "One-line positioning for the firm?" },
    { id: "highlights", label: "Three things that make you stand out", multiline: true },
    { id: "proof", label: "Best proof points (performance, marquee deals)?", multiline: true },
    { id: "ask", label: "What's the ask / call to action?" },
  ],
  thesis: [
    { id: "what", label: "What do you invest in?", hint: "Asset classes / sectors." },
    { id: "where", label: "Which geographies or markets?" },
    { id: "check", label: "Check size range and stage?" },
    { id: "why_now", label: "Why now — the market tailwind?", multiline: true },
    { id: "edge", label: "Why do you win these deals?", multiline: true },
    { id: "targets", label: "Target returns (IRR / MOIC)?" },
  ],
  track_record: [
    { id: "headline", label: "Headline performance (gross IRR / MOIC)?" },
    { id: "notable", label: "2–3 notable deals and outcomes", multiline: true },
    { id: "realizations", label: "Notable realizations / exits?", multiline: true },
    { id: "attribution", label: "What drove the returns?", multiline: true },
  ],
  portfolio: [
    { id: "holdings", label: "Current holdings worth featuring", multiline: true },
    { id: "case_study", label: "A representative case study (entry → value creation → status)", multiline: true },
    { id: "marks", label: "Current marks / valuation approach?" },
  ],
  team: [
    { id: "principals", label: "Key principals and their roles", multiline: true },
    { id: "experience", label: "Most relevant prior experience", multiline: true },
    { id: "why_team", label: "Why this team wins" },
  ],
  fund_terms: [
    { id: "structure", label: "Fund structure and target size?" },
    { id: "economics", label: "Management fee and carried interest?" },
    { id: "key_terms", label: "Key terms (term, GP commit, hurdle, etc.)", multiline: true },
  ],
  legal: [
    { id: "entities", label: "Entity structure (GP, management co., funds, SPVs)?", multiline: true },
    { id: "jurisdiction", label: "Jurisdictions of formation?" },
    { id: "agreements", label: "Material agreements to reference?", multiline: true },
  ],
  financials: [
    { id: "summary", label: "Financial summary (AUM, NAV, key figures)?", multiline: true },
    { id: "audit", label: "Auditor and audit status?" },
  ],
  compliance: [
    { id: "registrations", label: "Registrations / filings (e.g. Form ADV)?" },
    { id: "policies", label: "Key compliance policies (AML/KYC, etc.)", multiline: true },
  ],
  diligence: [
    { id: "scope", label: "What does this DDQ cover?" },
    { id: "answers", label: "Key questions and your responses", multiline: true },
  ],
};

/** Questions for a document, by section, with an exec-summary set by name. */
export function getWizardQuestions(docName: string, section: string | null): WizardQuestion[] {
  const name = docName.toLowerCase();
  if (name.includes("executive summary") || name.includes("one-pager") || name.includes("one pager")) {
    return BY_SECTION.marketing;
  }
  return (section && BY_SECTION[section]) || GENERIC;
}

/** Deterministic assembly of answers into markdown — the offline fallback. */
export function answersToMarkdown(
  docName: string,
  questions: WizardQuestion[],
  answers: Record<string, string>,
): string {
  const lines = [`# ${docName}`, ""];
  for (const q of questions) {
    const a = (answers[q.id] ?? "").trim();
    if (!a) continue;
    lines.push(`## ${q.label.replace(/\?$/, "")}`, a, "");
  }
  if (lines.length <= 2) lines.push("[TODO: add details]");
  return lines.join("\n").trim();
}
