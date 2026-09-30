// lib/document-review.server.ts
//
// Earn's review of an uploaded document: a one-paragraph summary, specific
// recommended adjustments ranked by severity, and the section it belongs in.
//
// Earn recommends; it does not edit. The operator changes the original and
// re-uploads, and the new version gets a fresh review (reviews are keyed to the
// storage object they read). The deterministic rules in lib/document-review run
// every time underneath the model, and on their own when no API key is set.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { mergeFindings, ruleFindings, suggestSection } from "@/lib/document-review";
import type { DocumentText } from "@/lib/document-text.server";
import type {
  DocumentReview,
  DocumentReviewRecommendation,
} from "@/lib/supabase/database.types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
/** Enough for a full LPA or deck; the long tail of a 400-page PPM adds little. */
const MAX_PROMPT_CHARS = 120_000;
const SECTION_KEYS = DATA_ROOM_SECTIONS.map((s) => s.key);

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "2–3 sentences: what this document is and whether it is ready to share." },
    suggested_section: { type: "string", enum: SECTION_KEYS },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocker", "suggestion", "nit"] },
          title: { type: "string", description: "Under 8 words." },
          detail: { type: "string", description: "The specific fix, in one or two sentences." },
          location: { type: ["string", "null"], description: "Page, slide, sheet or a short quote locating the issue." },
        },
        required: ["severity", "title", "detail", "location"],
      },
    },
  },
  required: ["summary", "suggested_section", "recommendations"],
} as const;

const SYSTEM =
  "You are Earn, the AI associate in FundExecs OS, reviewing a document a private-markets fund manager has uploaded to share with " +
  "institutional investors (LPs) through a data room. Review it the way a sharp associate and the firm's compliance officer would " +
  "before it goes out.\n\n" +
  "Report only real, specific problems, most important first, at most 10:\n" +
  "- blocker: must fix before any investor sees it — unfilled placeholders, internal comments or tracked changes left in, numbers " +
  "that contradict each other, performance shown without a past-performance disclaimer or gross/net basis, missing required legal " +
  "language in offering documents, another firm's or fund's name left in from a template.\n" +
  "- suggestion: materially improves how an LP reads it — stale or missing as-of dates, missing confidentiality legend, unclear " +
  "fee terms, a key metric an allocator will look for and not find.\n" +
  "- nit: polish — typos, inconsistent formatting of figures.\n\n" +
  "Quote or locate each finding (page, slide, sheet, or a short quote). Never invent content that is not in the text. If the " +
  "document is clean, say so and return few or no recommendations. Also pick the data-room section it belongs in.\n\n" +
  `Sections: ${DATA_ROOM_SECTIONS.map((s) => `${s.key} (${s.label})`).join(", ")}.`;

type ReviewCore = Pick<DocumentReview, "summary" | "recommendations" | "suggested_section" | "source">;

function fallbackSummary(name: string, text: DocumentText | null): string {
  if (!text || text.status === "unsupported") {
    return `Earn can't read inside this file type, so this review covers only its name and filing. Convert it to PDF or a current Office format (.docx, .xlsx, .pptx) for a full review.`;
  }
  if (text.status === "empty") return `"${name}" has no text layer — it looks like a scan.`;
  if (text.status === "failed") return `Earn could not open "${name}". The file may be password-protected or damaged.`;
  return `Automated checks on "${name}". Connect Earn's model (ANTHROPIC_API_KEY) for a full read of the contents.`;
}

export async function reviewDocumentText(input: {
  name: string;
  section: string;
  text: DocumentText | null;
}): Promise<ReviewCore> {
  const body = input.text?.status === "ok" ? input.text.text : "";
  const rules = ruleFindings({
    name: input.name,
    section: input.section,
    text: body,
    textStatus: input.text?.status ?? null,
  });
  const guess = suggestSection(input.name, body);
  const ruleSection = guess.confidence >= 0.35 ? guess.section : null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !body.trim()) {
    return {
      summary: fallbackSummary(input.name, input.text),
      recommendations: rules,
      suggested_section: ruleSection,
      source: "rules",
    };
  }

  try {
    const anthropic = anthropicClient(apiKey, LONG_RUN_TIMEOUT_MS);
    const truncated = body.length > MAX_PROMPT_CHARS;
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "medium", REVIEW_SCHEMA),
      messages: [
        {
          role: "user",
          content:
            `Document: ${input.name}\nCurrently filed under: ${input.section}\n` +
            (truncated ? `(Text truncated to the first ${MAX_PROMPT_CHARS.toLocaleString()} characters.)\n` : "") +
            `\n<document>\n${body.slice(0, MAX_PROMPT_CHARS)}\n</document>`,
        },
      ],
    });
    const json = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const raw = JSON.parse(json) as {
      summary?: string;
      suggested_section?: string;
      recommendations?: DocumentReviewRecommendation[];
    };
    const model = (raw.recommendations ?? [])
      .filter((r) => r && ["blocker", "suggestion", "nit"].includes(r.severity) && r.title && r.detail)
      .slice(0, 10)
      .map((r) => ({ severity: r.severity, title: r.title, detail: r.detail, location: r.location ?? null }));
    return {
      summary: (raw.summary ?? "").trim() || fallbackSummary(input.name, input.text),
      recommendations: mergeFindings(model, rules),
      suggested_section:
        raw.suggested_section && SECTION_KEYS.includes(raw.suggested_section) ? raw.suggested_section : ruleSection,
      source: "earn",
    };
  } catch (err) {
    console.warn("[document-review] model review failed; using rules", err);
    return {
      summary: fallbackSummary(input.name, input.text),
      recommendations: rules,
      suggested_section: ruleSection,
      source: "rules",
    };
  }
}
