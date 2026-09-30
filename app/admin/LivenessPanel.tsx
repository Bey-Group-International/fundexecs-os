// app/admin/LivenessPanel.tsx
// Is this deployment live? Rendered server-side on the admin page, which is the
// only place that can answer: the environment exists inside the deployment and
// nowhere else, so no external tool can read it — not the Vercel API with a
// token that lacks env-var permission, and not anybody reading the repo.
//
// Findings only, never values. The inspection reports what MODE a credential is
// in; it never returns the credential, and a test asserts that.
import { inspectLiveness, livenessSummary, type Finding, type Severity } from "@/lib/live-readiness";

const TONE: Record<Severity, { dot: string; text: string; border: string; label: string }> = {
  critical: {
    dot: "bg-rose-400",
    text: "text-rose-300",
    border: "border-rose-400/35",
    label: "Blocking",
  },
  warn: {
    dot: "bg-gold-400",
    text: "text-gold-300",
    border: "border-gold-400/30",
    label: "Review",
  },
  ok: { dot: "bg-emerald-400", text: "text-emerald-300", border: "border-line/60", label: "Live" },
};

function Row({ finding }: { finding: Finding }) {
  const tone = TONE[finding.severity];
  return (
    <li className={`rounded-xl border px-4 py-3 ${tone.border}`}>
      <div className="flex items-baseline gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
        <span className="text-sm font-medium text-fg-primary">{finding.subject}</span>
        <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${tone.text}`}>
          {tone.label}
        </span>
      </div>
      <p className="mt-1 pl-3.5 text-xs text-fg-secondary">{finding.detail}</p>
      {finding.action ? (
        <p className="mt-1 pl-3.5 text-xs text-fg-muted">
          <span className="font-medium text-fg-secondary">Fix:</span> {finding.action}
        </p>
      ) : null}
    </li>
  );
}

export function LivenessPanel() {
  const findings = inspectLiveness(process.env);
  const summary = livenessSummary(findings);
  const tone = TONE[summary.severity];

  return (
    <section className="rounded-2xl border border-line/60 bg-surface-1 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-fg-primary">
          Production readiness
        </h2>
        <span className={`font-mono text-[11px] ${tone.text}`}>{summary.headline}</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        Read from this deployment&apos;s own environment. Modes only — no secret is shown here, and
        none is returned to the browser.
      </p>
      <ul className="mt-3 grid gap-2">
        {findings.map((f) => (
          <Row key={`${f.subject}-${f.severity}-${f.detail.slice(0, 24)}`} finding={f} />
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-fg-muted">
        Environment variables are baked in at build time, so a change to any of these takes effect
        only after a redeploy.
      </p>
    </section>
  );
}
