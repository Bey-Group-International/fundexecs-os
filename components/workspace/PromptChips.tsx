"use client";

export function PromptChips({ examples }: { examples: string[] }) {
  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {examples.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("earn:set-composer-prompt", {
                detail: { prompt: example },
              }),
            )
          }
          className="rounded-full border border-line/60 bg-surface-2/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-fg-muted transition hover:border-gold-400/50 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {example}
        </button>
      ))}
    </div>
  );
}
