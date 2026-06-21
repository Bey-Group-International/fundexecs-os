export type EarnModelKey = "earn" | "claude" | "chatgpt" | "gemini";

export interface EarnAttachmentInput {
  name: string;
  type: string;
  size: number;
}

// "Earn" is the house reasoning engine and the default the composer opens on.
// The named external models stay available so an operator can rerun a turn and
// compare outputs.
export const EARN_MODELS: { key: EarnModelKey; label: string; provider: string; default?: boolean }[] = [
  { key: "earn", label: "Earn", provider: "FundExecs", default: true },
  { key: "claude", label: "Claude Sonnet", provider: "Anthropic" },
  { key: "chatgpt", label: "ChatGPT", provider: "OpenAI" },
  { key: "gemini", label: "Gemini", provider: "Google" },
];

export const DEFAULT_EARN_MODEL: EarnModelKey =
  EARN_MODELS.find((m) => m.default)?.key ?? EARN_MODELS[0].key;

// Operator modes mirror the composer's mode selector. Each carries a directive
// that travels with the prompt so Earn knows how far it is cleared to act
// before pausing at the approval gate.
export type EarnModeKey = "accept-edits" | "plan" | "auto";

export const EARN_MODES: { key: EarnModeKey; label: string; hint: string; directive: string }[] = [
  {
    key: "accept-edits",
    label: "Accept edits",
    hint: "Apply changes, gate outbound actions",
    directive:
      "[Operator mode: Accept edits. Apply edits and stage the plan, but stop at the approval gate before any irreversible or outbound automation.]",
  },
  {
    key: "plan",
    label: "Plan Mode",
    hint: "Plan only, no execution",
    directive:
      "[Operator mode: Plan Mode. Produce the plan and recommendation only — do not execute or queue any agent actions until the operator approves.]",
  },
  {
    key: "auto",
    label: "Auto Mode",
    hint: "Proceed autonomously, gate risk",
    directive:
      "[Operator mode: Auto Mode. Proceed autonomously through low-risk steps; still gate irreversible or outbound actions for approval.]",
  },
];

export const DEFAULT_EARN_MODE: EarnModeKey = EARN_MODES[0].key;

function compactBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentSummary(attachments: EarnAttachmentInput[]): string {
  return attachments
    .map((file) => `${file.name} (${file.type || "unknown"}, ${compactBytes(file.size)})`)
    .join("; ");
}

export function buildEarnPromptEnvelope(args: {
  body: string;
  model: EarnModelKey;
  mode?: EarnModeKey;
  attachments: EarnAttachmentInput[];
  voiceUsed?: boolean;
}): string {
  const lines: string[] = [];
  const model = EARN_MODELS.find((m) => m.key === args.model) ?? EARN_MODELS[0];
  lines.push(`[Selected reasoning engine: ${model.label} (${model.provider}). Preserve the existing session context and make output comparison-ready if the operator reruns this across models.]`);
  const mode = EARN_MODES.find((m) => m.key === (args.mode ?? DEFAULT_EARN_MODE)) ?? EARN_MODES[0];
  lines.push(mode.directive);
  if (args.voiceUsed) lines.push("[Input mode: voice transcript captured from microphone.]");
  if (args.attachments.length) {
    lines.push(`[Attached media for workflow context: ${attachmentSummary(args.attachments)}. Treat these as first-class workflow inputs and ask for missing extraction details if binary inspection is unavailable.]`);
  }
  lines.push(args.body.trim());
  return lines.join("\n");
}
