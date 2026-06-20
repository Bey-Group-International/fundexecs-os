// components/activity/ActivityFeed.tsx — the cross-hub timeline.
//
// Renders activity grouped by day (mono-uppercase headings), each entry showing
// the authoring agent badge, the hub chip, the title, a status pill, a relative
// timestamp, and a deep link into the originating session when present.
import Link from "next/link";
import {
  groupByDay,
  relativeTime,
  statusTone,
  statusLabel,
  type ActivityEntry,
  type StatusTone,
} from "@/lib/activity";
import { AGENT_BY_KEY } from "@/lib/agents";
import { HUB_BY_KEY } from "@/lib/hubs";

const TONE_CLASS: Record<StatusTone, string> = {
  active: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  pending: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  blocked: "border-red-500/40 bg-red-500/10 text-red-300",
  muted: "border-line bg-surface-2 text-fg-muted",
};

function StatusPill({ entry }: { entry: ActivityEntry }) {
  const tone = statusTone(entry.status);
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TONE_CLASS[tone]}`}
    >
      {statusLabel(entry.status)}
    </span>
  );
}

function AgentBadge({ entry }: { entry: ActivityEntry }) {
  const agent = entry.agent ? AGENT_BY_KEY[entry.agent] : undefined;
  if (!agent) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: agent.color }}
        aria-hidden
      />
      {agent.name}
    </span>
  );
}

function HubChip({ entry }: { entry: ActivityEntry }) {
  const hub = entry.hub ? HUB_BY_KEY[entry.hub] : undefined;
  if (!hub) return null;
  return (
    <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
      {hub.label}
    </span>
  );
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-4">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          entry.kind === "artifact" ? "bg-gold-400/70" : "bg-cyan-400/70"
        }`}
        aria-label={entry.kind}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">{entry.title}</span>
          <HubChip entry={entry} />
          {entry.kind === "artifact" ? (
            <span className="rounded-full border border-gold-500/30 bg-gold-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300/80">
              Artifact
            </span>
          ) : null}
          <StatusPill entry={entry} />
        </div>

        {entry.summary ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
            {entry.summary}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AgentBadge entry={entry} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {relativeTime(entry.when)}
          </span>
          {entry.sessionId ? (
            <Link
              href={`/session/${entry.sessionId}`}
              className="font-mono text-[10px] uppercase tracking-wider text-gold-400 transition hover:text-gold-300"
            >
              Open session →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
        Nothing yet. As Earn and the agent team run workflows across your hubs,
        their work appears here as one timeline.
      </p>
    );
  }

  const groups = groupByDay(entries);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.day}>
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            {group.label}
          </h2>
          <div className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
