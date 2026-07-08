// Builders for the AI-crawler context files served at /llms.txt, /llms-full.txt,
// and /ai.txt. Centralized here (rather than as static files in /public) so the
// product description, hubs, and agents stay derived from a single source and
// never drift from the rest of the site's metadata.
//
// Format follows the emerging llms.txt convention: an H1, a blockquote summary,
// then Markdown sections of links + prose that an LLM can ingest directly.

import {
  CRAWLER_DISALLOW,
  SITE_CONTACT_EMAIL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";

// Product architecture — the authoritative catalog mirrored from the README.
const HUBS: Array<{ name: string; purpose: string }> = [
  { name: "Build", purpose: "Define identity and foundation (Profile, Thesis, Brand, Entity, Track Record, Team, Documents)." },
  { name: "Source", purpose: "Manage pipelines and relationships (LP Pipeline, Debt & Hybrid, Partners, Providers, Deal Pipeline)." },
  { name: "Run", purpose: "Evaluate and manage active deals (Strategy, Diligence, Underwriting, Stress Test, Risk, Outreach, Campaigns)." },
  { name: "Execute", purpose: "Operate assets post-closing (Closing, Capital Events, Asset Management, Reporting, Exit)." },
];

const AGENTS: Array<{ name: string; role: string }> = [
  { name: "Earn", role: "The orchestrating copilot — plans objectives, delegates to specialist agents, gates approvals, and reports outcomes." },
  { name: "Analyst", role: "Ingests deal data, financials, and market comps; produces pro formas and valuations." },
  { name: "Associate", role: "Coordinates workflows and task execution across all hubs." },
  { name: "Investor Relations", role: "Manages LP communications, capital calls, and reporting." },
  { name: "Portfolio Ops", role: "Monitors asset KPIs, budgets, capex, and variance alerts." },
  { name: "Diligence", role: "Parses documents, flags risks, and produces diligence memos." },
  { name: "Fund Admin", role: "Handles waterfall calculations, fund accounting, and audit prep." },
];

const GRAPHS: Array<{ name: string; detail: string }> = [
  { name: "Relationship Graph", detail: "Who knows whom; who invested or financed what." },
  { name: "Deal Graph", detail: "Deals, targets, portfolio companies, SPVs, and funds." },
  { name: "Capital Graph", detail: "LPs, investors, lenders, family offices, and banks." },
];

const AUDIENCE =
  "private equity firms, search funds, family offices, independent sponsors, banks, and capital raisers";

/** Short index — the canonical llms.txt. */
export function buildLlmsTxt(): string {
  return `# ${SITE_NAME}

> ${SITE_TAGLINE}. ${SITE_DESCRIPTION}

${SITE_NAME} is an AI-native operating system for private markets. A copilot named Earn plans work, delegates to a team of specialist AI agents, monitors progress, and routes decisions through approval gates while the agents source deals, raise capital, run diligence, manage relationships, and execute transactions. Built for ${AUDIENCE}.

## Key pages
- [Home](${SITE_URL}/): Product overview and the Command → Plan → Execute → Report operating loop.
- [Request access](${SITE_URL}/login): Sign in or request access to the platform.
- [Sitemap](${SITE_URL}/sitemap.xml): Machine-readable index of indexable pages.

## The four hubs
${HUBS.map((h) => `- ${h.name}: ${h.purpose}`).join("\n")}

## The AI agents
${AGENTS.map((a) => `- ${a.name}: ${a.role}`).join("\n")}

## Native data graphs
${GRAPHS.map((g) => `- ${g.name}: ${g.detail}`).join("\n")}

## Contact
- Email: ${SITE_CONTACT_EMAIL}
- Full context: ${SITE_URL}/llms-full.txt
`;
}

/** Expanded, concatenated context for retrieval-augmented use. */
export function buildLlmsFullTxt(): string {
  return `${buildLlmsTxt()}
---

## About ${SITE_NAME}

${SITE_NAME} unifies relationships, deals, and capital into a single intelligence layer, with AI agents that execute workflows end-to-end. It replaces the fragmented stack of spreadsheets, email threads, and point CRMs that private-market operators juggle today.

### The operating loop
1. Command — the operator gives Earn a private-market objective in plain language.
2. Plan — Earn creates objectives, workstreams, agent assignments, and approval gates.
3. Execute — AI agents source, raise, diligence, document, and follow up across the hubs.
4. Report — outcomes collapse into the dashboard as targets, introductions, packages, and updates.

### The four hubs
${HUBS.map((h) => `#### ${h.name}\n${h.purpose}`).join("\n\n")}

### The AI agents
${AGENTS.map((a) => `#### ${a.name}\n${a.role}`).join("\n\n")}

### Native data graphs
All graphs are first-party data structures with no external dependencies.
${GRAPHS.map((g) => `#### ${g.name}\n${g.detail}`).join("\n\n")}

### Who it is for
${SITE_NAME} is built for ${AUDIENCE} — operators who move capital at scale and need an execution layer rather than another system of record.

### Contact
Reach the team at ${SITE_CONTACT_EMAIL}.
`;
}

/** AI training & usage policy served at /ai.txt. */
export function buildAiTxt(): string {
  return `# AI usage policy for ${SITE_NAME}
# ${SITE_URL}

# Public marketing content on this site may be used by AI crawlers and answer
# engines to describe ${SITE_NAME}, subject to the directives in /robots.txt.
# The authenticated application, customer data, and API surface are off-limits.

Contact: ${SITE_CONTACT_EMAIL}
Preferred-context: ${SITE_URL}/llms.txt
Full-context: ${SITE_URL}/llms-full.txt
Sitemap: ${SITE_URL}/sitemap.xml

# Disallowed for training and retrieval (API surface + authenticated app):
${CRAWLER_DISALLOW.map((path) => `Disallow: ${path}`).join("\n")}
`;
}
