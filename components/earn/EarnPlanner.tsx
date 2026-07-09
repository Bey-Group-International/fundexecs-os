"use client";

// The "Plan with Earn" surface: an operator types a directive, Earn returns a
// plan — delegate to the team (A) or execute directly (B) — with action bullets
// and a next-step line. Backed by /api/earn/plan (Claude, deterministic
// fallback). Reused by the Build hub's Plan module; the session composer runs
// the same endpoint but renders the result inline in its chat transcript.
import { useRef, useState } from "react";
import type { EarnPlan } from "@/lib/earn-plan";

export function EarnPlanner({
  placeholder = "Give Earn a directive — e.g. open an anchor-LP raise for Fund III…",
  heading = "Plan with Earn",
  subheading = "Describe what you want to move forward. Earn decides whether to delegate to the team or take it directly, and lays out the play.",
}: {
  placeholder?: string;
  heading?: string;
  subheading?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<EarnPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function run(directive: string) {
    const text = directive.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/earn/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      if (!res.ok) throw new Error(`Plan failed: ${res.status}`);
      setPlan((await res.json()) as EarnPlan);
    } catch (err) {
      console.error("[EarnPlanner] error:", err);
      setError("Earn couldn't draft that plan just now — please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
          {heading}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{subheading}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt);
        }}
        className="rounded-2xl border border-line bg-surface-1 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run(prompt);
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={placeholder}
          className="w-full resize-none bg-transparent px-1 py-1 text-sm text-fg-primary outline-none placeholder:text-fg-muted"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            ⌘↵ to plan
          </span>
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="flex h-9 items-center rounded-lg bg-gold-400 px-4 text-xs font-semibold text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Planning…" : "Plan with Earn"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          {error}
        </p>
      ) : null}

      {plan ? <EarnPlanCard plan={plan} /> : null}
    </div>
  );
}

/** Presentational card for an EarnPlan. Exported for reuse (e.g. tests). */
export function EarnPlanCard({ plan }: { plan: EarnPlan }) {
  const delegate = plan.kind === "A";
  return (
    <article className="animate-fade-up rounded-xl border border-line bg-surface-1 p-5">
      <header className="mb-3 flex items-center gap-2">
        <span
          className={[
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium",
            delegate
              ? "border border-neural-400/50 bg-neural-400/10 text-neural-300"
              : "border border-gold-400/50 bg-gold-400/10 text-gold-300",
          ].join(" ")}
        >
          {delegate ? "Delegate to the team" : "Earn executes directly"}
        </span>
      </header>

      <p className="font-display text-base font-medium leading-relaxed text-fg-primary">
        {plan.recommendation}
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {plan.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-fg-secondary">
            <span
              className={[
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                delegate ? "bg-neural-400" : "bg-gold-400",
              ].join(" ")}
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-sm text-fg-muted">{plan.closing}</p>
    </article>
  );
}
