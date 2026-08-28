// components/copilot/conversation-export.ts
//
// Turning an Earn conversation into something the operator can take with them.
// Pure functions only — no DOM, no fetch — so the transcript format is testable
// and the dock stays a rendering concern.

/** The shape the dock keeps per turn. Structural, so the dock's own union fits. */
export interface ExportableTurn {
  role: "user" | "earn";
  text?: string;
  answer?: string;
  planTitle?: string;
  steps?: { agent: string; title: string }[];
  stopped?: boolean;
}

/** A filesystem-safe slug for the download filename. */
export function conversationFilename(label: string, now: Date): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "conversation";
  const date = now.toISOString().slice(0, 10);
  return `earn-${slug}-${date}.md`;
}

/**
 * The conversation as markdown: a heading, then each turn attributed. A plan
 * turn renders its steps, because "Earn routed this to three agents" is the
 * substance of that turn — dropping it would export a blank.
 */
export function threadToMarkdown(
  turns: ExportableTurn[],
  meta: { label: string; operator?: string | null; exportedAt: Date },
): string {
  const header = [
    `# Earn · ${meta.label}`,
    "",
    meta.operator ? `**Operator:** ${meta.operator}  ` : null,
    `**Exported:** ${meta.exportedAt.toISOString().slice(0, 10)}`,
    "",
    "---",
    "",
  ].filter((line) => line !== null);

  const body = turns.flatMap((turn) => {
    if (turn.role === "user") {
      const text = (turn.text ?? "").trim();
      return text ? [`### You`, "", text, ""] : [];
    }

    const parts: string[] = [];
    const answer = (turn.answer ?? "").trim();
    if (answer) {
      parts.push(answer);
      // A stopped answer is a partial one; an export that hides that reads as a
      // complete reply Earn never finished giving.
      if (turn.stopped) parts.push("", "_(answer stopped early)_");
    }
    if (turn.planTitle) {
      parts.push(`**Planned:** ${turn.planTitle}`);
      for (const step of turn.steps ?? []) parts.push(`- ${step.agent}: ${step.title}`);
    }
    return parts.length ? [`### Earn`, "", ...parts, ""] : [];
  });

  if (body.length === 0) return `${header.join("\n")}_This conversation is empty._\n`;
  return `${header.join("\n")}${body.join("\n")}\n`;
}
