// Mocked script for the Scroll-Deck builder. This route is UI-only: there is
// no backend, no AI call, and no persistence. The "build" is driven entirely by
// this scripted sequence so the chat + canvas interplay can be demonstrated
// natively in the fx design system. Each step appends an assistant turn and
// unlocks / edits one deck section.

export type DeckSectionId =
  | "cover"
  | "thesis"
  | "team"
  | "terms"
  | "track-record"
  | "pipeline";

export interface DeckField {
  label: string;
  value: string;
  /** Rendered as a large gold financial figure when true. */
  figure?: boolean;
}

export interface DeckSection {
  id: DeckSectionId;
  title: string;
  /** Short label shown in the canvas outline / progress rail. */
  kicker: string;
  fields: DeckField[];
}

/** A single scripted builder turn. */
export interface BuildStep {
  /** What the user "sends" to trigger this step (also the What's-next chip). */
  prompt: string;
  /** The assistant's streamed reply. */
  reply: string;
  /** The section this step produces / edits. */
  section: DeckSection;
}

export const FUND_NAME = "Meridian Growth Partners I";
export const FUND_TAGLINE = "Lower-middle-market software buyouts";

export const BUILD_STEPS: BuildStep[] = [
  {
    prompt: "Start my fund — vertical SaaS buyout fund",
    reply:
      "Got it. I've drafted a cover for a lower-middle-market vertical-SaaS buyout fund. I set a working name you can rename anytime.",
    section: {
      id: "cover",
      title: FUND_NAME,
      kicker: "Cover",
      fields: [
        { label: "Strategy", value: FUND_TAGLINE },
        { label: "Vintage", value: "2026" },
        { label: "Structure", value: "Delaware LP · 10-year term" },
      ],
    },
  },
  {
    prompt: "Draft the investment thesis",
    reply:
      "Here's a thesis built around control buyouts of profitable vertical-SaaS businesses at 4–7x EBITDA, with an operational value-creation playbook.",
    section: {
      id: "thesis",
      title: "Investment Thesis",
      kicker: "Thesis",
      fields: [
        {
          label: "Focus",
          value:
            "Control buyouts of founder-owned vertical SaaS with $2–8M EBITDA.",
        },
        {
          label: "Edge",
          value:
            "Operator bench + AI-native GTM playbook to compound net revenue retention.",
        },
        { label: "Entry", value: "4–7x EBITDA", figure: true },
      ],
    },
  },
  {
    prompt: "Add the GP team",
    reply:
      "I've added a two-partner GP with complementary operating and finance backgrounds. Edit the bios directly on the canvas.",
    section: {
      id: "team",
      title: "General Partners",
      kicker: "Team",
      fields: [
        {
          label: "Managing Partner",
          value: "Ex-operator, scaled two vertical-SaaS businesses to exit.",
        },
        {
          label: "Partner, Finance",
          value: "15 yrs LMM private equity; led 20+ platform acquisitions.",
        },
        { label: "Team", value: "6 investment professionals" },
      ],
    },
  },
  {
    prompt: "Set the fund terms",
    reply:
      "Standard institutional terms applied: $75M target, 2% management fee, 20% carry over an 8% preferred return.",
    section: {
      id: "terms",
      title: "Fund Terms",
      kicker: "Terms",
      fields: [
        { label: "Target Size", value: "$75M", figure: true },
        { label: "Management Fee", value: "2.0%" },
        { label: "Carried Interest", value: "20%" },
        { label: "Preferred Return", value: "8%" },
      ],
    },
  },
  {
    prompt: "Show the track record",
    reply:
      "Summarized the partners' prior-deal track record. These are illustrative figures — swap in your audited numbers before sharing.",
    section: {
      id: "track-record",
      title: "Track Record",
      kicker: "Record",
      fields: [
        { label: "Gross MOIC", value: "3.1x", figure: true },
        { label: "Net IRR", value: "27%", figure: true },
        { label: "Realized Exits", value: "8 of 11 platforms" },
      ],
    },
  },
  {
    prompt: "Build the deal pipeline",
    reply:
      "Added a near-term pipeline snapshot. The deck is investor-ready — you can export it or move on to legal docs and the data room.",
    section: {
      id: "pipeline",
      title: "Near-Term Pipeline",
      kicker: "Pipeline",
      fields: [
        { label: "Active LOIs", value: "3 platforms · $34M EV" },
        { label: "Under Diligence", value: "5 add-on targets" },
        { label: "Coverage", value: "140+ sourced opportunities" },
      ],
    },
  },
];

export interface NavItem {
  id: string;
  label: string;
  /** Locked items render disabled with a lock badge, mirroring the source page. */
  locked?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { id: "scroll-deck", label: "Scroll Deck" },
  { id: "fund-builder", label: "Fund Builder" },
  { id: "legal", label: "Legal" },
  { id: "calc", label: "Calculator" },
];

export const MARKETPLACE_NAV: NavItem[] = [
  { id: "marketplace", label: "Marketplace" },
];

export const LOCKED_NAV: NavItem[] = [
  { id: "raise", label: "Raise", locked: true },
  { id: "manage", label: "Manage", locked: true },
];
