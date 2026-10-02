"use client";

import { explainPrompt, type ExplainRecordType } from "@/lib/earn-explain";

// "Ask Earn" on a record page: opens the Earn dock and has it explain this
// record — summary, Earn's take, and the claims worth checking. Only the
// { type, id } reference leaves the page; the server loads the record itself.
export function AskEarnButton({
  type,
  id,
  name,
  variant = "primary",
  className = "",
}: {
  type: ExplainRecordType;
  id: string;
  name: string;
  /** "secondary" for a row of actions where another button leads. */
  variant?: "primary" | "secondary";
  className?: string;
}) {
  function open() {
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", {
        detail: { prompt: explainPrompt(type, name), autoSend: true, chatContext: { record: { type, id } } },
      }),
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Summary, Earn's take, and the claims worth checking"
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
        variant === "primary"
          ? "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
          : "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
      } ${className}`}
    >
      Ask Earn
    </button>
  );
}
