"use client";

import { explainPrompt, type ExplainRecordType } from "@/lib/earn-explain";

// "Ask Earn" on a record page: opens the Earn dock and has it explain this
// record — summary, Earn's take, and the claims worth checking. Only the
// { type, id } reference leaves the page; the server loads the record itself.
export function AskEarnButton({
  type,
  id,
  name,
  className = "",
}: {
  type: ExplainRecordType;
  id: string;
  name: string;
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
      className={`rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 ${className}`}
    >
      Ask Earn
    </button>
  );
}
