// Chat wiring for the Scroll-Deck fund builder. Turns an operator's message
// into ONE investor-ready deck section plus a short reply. When
// ANTHROPIC_API_KEY is absent (or the model call fails), it falls back to the
// scripted BUILD_STEPS so CI/preview builds — and the live no-key demo here —
// keep producing sections. Mirrors the deterministic-fallback convention in
// lib/claude.ts.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import { BUILD_STEPS } from "@/components/scroll-deck/mock-data";
import type { ChatProposal, DeckField, DeckSection } from "@/components/scroll-deck/types";

// Default to Sonnet 4.6, overridable with CLAUDE_MODEL — same idiom as lib/claude.ts.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// JSON schema for the structured output: a short reply plus one deck section in
// the exact DeckSection shape (id, title, kicker, fields:[{label,value,figure?}]).
const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: {
      type: "string",
      description: "A short 1-2 sentence chat reply to the fund manager.",
    },
    section: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          description:
            "Stable slug for the section, e.g. cover, thesis, team, terms, track-record, pipeline.",
        },
        title: { type: "string", description: "Section title shown on the deck." },
        kicker: { type: "string", description: "Short label for the outline/progress rail." },
        fields: {
          type: "array",
          description: "2-4 concise fields for this section.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string", description: "Short field label." },
              value: { type: "string", description: "Concise field value." },
              figure: {
                type: "boolean",
                description: "True when the value is a headline financial figure.",
              },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["id", "title", "kicker", "fields"],
    },
  },
  required: ["reply", "section"],
} as const;

const SYSTEM_PROMPT =
  `You are helping a fund manager assemble an investor-ready fund deck, one section at a time. ` +
  `Given the manager's latest message and the sections already built (provided as JSON), produce ` +
  `exactly ONE new deck section plus a short 1-2 sentence reply. Do not repeat a section that ` +
  `already exists. Keep field values concise and specific; mark headline financial figures ` +
  `(target size, fees, carry, IRR, MOIC, entry multiples) with figure:true. Choose a stable, ` +
  `lowercase-slug id for the section (e.g. cover, thesis, team, terms, track-record, pipeline).`;

// Deterministic fallback: use the scripted step at stepIndex; past the end,
// report the deck is complete with no section.
function fallbackProposal(stepIndex: number): ChatProposal {
  const step = BUILD_STEPS[stepIndex];
  if (step) {
    return { reply: step.reply, section: step.section };
  }
  return {
    reply:
      "Your deck is complete — every core section is in place. You can export it or move on to legal docs and the data room.",
    section: null,
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Coerce a raw model field into a valid DeckField, or null if unusable.
function normalizeField(raw: unknown): DeckField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim() : "";
  const value = typeof r.value === "string" ? r.value.trim() : "";
  if (!label || !value) return null;
  const field: DeckField = { label: label.slice(0, 120), value: value.slice(0, 400) };
  if (r.figure === true) field.figure = true;
  return field;
}

// Coerce a raw model section into a valid DeckSection, or null if unusable.
function normalizeSection(raw: unknown): DeckSection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const kicker = typeof r.kicker === "string" ? r.kicker.trim() : "";
  if (!id || !title) return null;
  const fields = Array.isArray(r.fields)
    ? r.fields.map(normalizeField).filter((f): f is DeckField => f !== null)
    : [];
  if (fields.length === 0) return null;
  return {
    id: id.slice(0, 60),
    title: title.slice(0, 120),
    kicker: (kicker || title).slice(0, 40),
    fields: fields.slice(0, 6),
  };
}

/**
 * Produce one deck section (plus a short reply) for the manager's message.
 * Never throws — always resolves to a valid ChatProposal. With no API key, or
 * on any model/parse error, it returns the deterministic BUILD_STEPS fallback.
 */
export async function buildDeckProposal(input: {
  prompt: string;
  sections: DeckSection[];
  stepIndex: number;
}): Promise<ChatProposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackProposal(input.stepIndex);

  try {
    const anthropic = anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS);
    const builtSummary =
      input.sections.length > 0
        ? JSON.stringify(
            input.sections.map((s) => ({ id: s.id, title: s.title })),
          )
        : "(none yet)";
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "low", PROPOSAL_SCHEMA),
      messages: [
        {
          role: "user",
          content:
            `Sections already built: ${builtSummary}\n\n` +
            `Manager's message: ${input.prompt}\n\n` +
            `Produce the next deck section and a short reply.`,
        },
      ],
    });
    const json = textOf(message);
    if (!json) return fallbackProposal(input.stepIndex);
    const raw = JSON.parse(json) as { reply?: unknown; section?: unknown };
    const section = normalizeSection(raw.section);
    const reply =
      typeof raw.reply === "string" && raw.reply.trim()
        ? raw.reply.trim()
        : fallbackProposal(input.stepIndex).reply;
    if (!section) return fallbackProposal(input.stepIndex);
    return { reply, section };
  } catch (err) {
    console.error("[buildDeckProposal] Claude API error:", err);
    return fallbackProposal(input.stepIndex);
  }
}

// suggestNextPrompt lives in components/scroll-deck/mock-data.ts (client-safe,
// where BUILD_STEPS lives) so the client shell can use it without importing this
// server-only module. Re-exported here for any server-side caller.
export { suggestNextPrompt } from "@/components/scroll-deck/mock-data";
