export type EarnModelKey = "claude" | "chatgpt" | "gemini";

export interface EarnAttachmentInput {
  name: string;
  type: string;
  size: number;
}

export const EARN_MODELS: { key: EarnModelKey; label: string; provider: string }[] = [
  { key: "claude", label: "Claude", provider: "Anthropic" },
  { key: "chatgpt", label: "ChatGPT", provider: "OpenAI" },
  { key: "gemini", label: "Gemini", provider: "Google" },
];

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
  attachments: EarnAttachmentInput[];
  voiceUsed?: boolean;
}): string {
  const lines: string[] = [];
  const model = EARN_MODELS.find((m) => m.key === args.model) ?? EARN_MODELS[0];
  lines.push(`[Selected reasoning engine: ${model.label} (${model.provider}). Preserve the existing session context and make output comparison-ready if the operator reruns this across models.]`);
  if (args.voiceUsed) lines.push("[Input mode: voice transcript captured from microphone.]");
  if (args.attachments.length) {
    lines.push(`[Attached media for workflow context: ${attachmentSummary(args.attachments)}. Treat these as first-class workflow inputs and ask for missing extraction details if binary inspection is unavailable.]`);
  }
  lines.push(args.body.trim());
  return lines.join("\n");
}
