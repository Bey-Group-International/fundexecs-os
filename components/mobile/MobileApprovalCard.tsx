import Link from "next/link";
import { relativeTime } from "./format";

export interface MobileApproval {
  id: string;
  title: string;
  summary: string | null;
  agentLabel: string | null;
  risk?: "high" | "medium" | "low";
  requestedAt: string | null;
  href: string;
}

const RISK_META: Record<string, { label: string; cls: string }> = {
  high: { label: "High-sensitivity", cls: "border-status-danger/40 text-status-danger" },
  medium: { label: "Review", cls: "border-gold-500/40 text-gold-400" },
  low: { label: "Routine", cls: "border-status-success/40 text-status-success" },
};

// Approval card — deliberate by design. Surfaces context, risk level, and a
// clear affordance to open the full approval decision. The actual approve /
// reject / revise controls live on the destination for auditability.
export function MobileApprovalCard({ approval }: { approval: MobileApproval }) {
  const risk = RISK_META[approval.risk ?? "medium"];
  const when = relativeTime(approval.requestedAt);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold-500/25 bg-surface-1/80 p-3.5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-gold-400/80 via-gold-500/40 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold leading-tight text-fg-primary">{approval.title}</p>
          <p className="mt-0.5 text-[11.5px] text-fg-secondary">
            {approval.agentLabel ?? "Earn"}
            {when ? ` · ${when}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${risk.cls}`}>
          {risk.label}
        </span>
      </div>
      {approval.summary && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-fg-secondary">{approval.summary}</p>
      )}
      <Link
        href={approval.href}
        className="fx-tap mt-3 flex items-center justify-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/[0.08] px-4 py-2.5 text-[13px] font-semibold text-gold-300 transition active:scale-[0.99]"
      >
        Review &amp; decide
        <span aria-hidden>›</span>
      </Link>
    </div>
  );
}
