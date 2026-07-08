// Builders for the AI-crawler context files served at /llms.txt, /llms-full.txt,
// and /ai.txt. The hubs and agents are projected directly from the live product
// catalogs (lib/hubs.ts, lib/agents.ts) — the same source the app renders from —
// so this context can never drift from what the product actually ships. Add an
// agent or a hub module and these files update on the next build automatically.
//
// Format follows the emerging llms.txt convention: an H1, a blockquote summary,
// then Markdown sections of links + prose that an LLM can ingest directly.

import { AGENTS } from "@/lib/agents";
import { HUBS } from "@/lib/hubs";
import {
  CRAWLER_DISALLOW,
  SITE_CONTACT_EMAIL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";

// Orchestrator first (the hub-less agent, Earn), then the specialists in catalog
// order — matches how the product frames the roster.
const ORDERED_AGENTS = [
  ...AGENTS.filter((a) => a.hub === null),
  ...AGENTS.filter((a) => a.hub !== null),
];

function hubModules(hub: (typeof HUBS)[number]): string {
  return hub.modules.map((m) => m.label).join(", ");
}

// The three native graphs have no code catalog, so they stay described here.
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

## Operating hubs
${HUBS.map((h) => `- ${h.label}: ${hubModules(h)}.`).join("\n")}

## The AI agents
${ORDERED_AGENTS.map((a) => `- ${a.name}: ${a.role}`).join("\n")}

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

### Operating hubs
${HUBS.map((h) => `#### ${h.label}\n${h.purpose}\nModules: ${hubModules(h)}.`).join("\n\n")}

### The AI agents
${ORDERED_AGENTS.map((a) => `#### ${a.name}\n${a.role}`).join("\n\n")}

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
