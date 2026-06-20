import Link from "next/link";
import {
  getMissionControl,
  scoreTone,
  type HubSignal,
  type SignalTone,
} from "@/lib/mission-control";

// Mission control: a glanceable strip across the top of the dashboard. One tile
// per hub — its headline metric, an optional score ring, and the single
// next-best action — so the operator sees where every hub stands and the one
// move that advances it without leaving the dashboard. Pure server component:
// the rings are server-rendered SVG (no client JS), matching RunCommandCenter.

const TONE_RING: Record<SignalTone, string> = {
  good: "text-emerald-400",
  warn: "text-gold-400",
  muted: "text-fg-muted",
};

const TONE_DOT: Record<SignalTone, string> = {
  good: "bg-emerald-400",
  warn: "bg-gold-400",
  muted: "bg-fg-muted",
};

// Score ring — pure SVG, renders server-side with no client JS. Mirrors the
// conviction ring idiom in RunCommandCenter, sized down for a compact tile.
function Ring({ value, tone }: { value: number; tone: SignalTone }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative shrink-0">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-line" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={TONE_RING[tone]}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[11px] font-semibold text-fg-primary">
        {value}
      </span>
    </div>
  );
}

function HubTile({ signal }: { signal: HubSignal }) {
  const tone = scoreTone(signal.score);
  return (
    <Link
      href={signal.href}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/40 hover:bg-surface-2/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
          {signal.label}
        </span>
        {signal.score == null ? (
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {signal.score != null ? <Ring value={signal.score} tone={tone} /> : null}
        <p className="min-w-0 text-sm font-medium leading-snug text-fg-primary">{signal.metric}</p>
      </div>

      {signal.nextAction ? (
        <span className="mt-auto flex items-center gap-1.5 text-xs text-fg-secondary transition group-hover:text-gold-300">
          <span className="font-mono text-[10px] text-gold-400">→</span>
          <span className="truncate">{signal.nextAction.label}</span>
        </span>
      ) : (
        <span className="mt-auto text-xs text-fg-muted">All caught up</span>
      )}
    </Link>
  );
}

export async function MissionControl({ orgId }: { orgId: string }) {
  const { hubs } = await getMissionControl(orgId);
  if (hubs.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
          Mission control
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {hubs.map((signal) => (
          <HubTile key={signal.hub} signal={signal} />
        ))}
      </div>
    </section>
  );
}
