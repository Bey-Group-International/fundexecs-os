import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { formatSeconds, type InvestorActivity, type Signal } from "@/lib/data-room-engagement";
import { loadRoomEngagement } from "@/lib/data-room-engagement.server";
import type { DataRoomEngagementRead } from "@/lib/supabase/database.types";
import { AskEarnButton } from "./AskEarnButton";

// Who read what in one room: a line per investor (named first, then by time
// read), their documents and day-by-day timeline on expand, Earn's read of
// their interest, and the room's most-read documents.

const SHOWN = 50;

const SIGNAL: Record<Signal, { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  warm: { label: "Warm", cls: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  cold: { label: "Cold", cls: "border-line bg-surface-0 text-fg-muted" },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ago(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : day(iso);
}

function SignalPill({ signal }: { signal: Signal }) {
  const s = SIGNAL[signal];
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${s.cls}`}>
      {s.label}
    </span>
  );
}

function Investor({ a, read, now }: { a: InvestorActivity; read: DataRoomEngagementRead | undefined; now: number }) {
  const docsRead = a.documents.filter((d) => d.seconds > 0).length;
  // Newer activity than Earn has seen: its read may no longer hold.
  const stale = read?.activity_through ? a.lastSeen > read.activity_through : false;
  return (
    <details className="group rounded-xl border border-line bg-surface-1">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <SignalPill signal={read?.signal ?? a.signal} />
        <span className="min-w-0 truncate text-sm font-medium text-fg-primary">{a.label}</span>
        <span className="font-mono text-[11px] text-fg-muted">
          {formatSeconds(a.seconds)} · {docsRead} doc{docsRead === 1 ? "" : "s"}
          {a.downloads ? ` · ${a.downloads} download${a.downloads === 1 ? "" : "s"}` : ""}
        </span>
        <span className="ml-auto font-mono text-[11px] text-fg-muted">{ago(a.lastSeen, now)}</span>
        <span aria-hidden className="font-mono text-[11px] text-fg-muted transition group-open:rotate-90">
          ›
        </span>
        {read ? (
          // <summary> takes phrasing content only, so a block <span>, not a <p>.
          <span className="block basis-full text-xs leading-relaxed text-fg-secondary">
            {read.summary} <span className="text-gold-300">Next: {read.follow_up}</span>
            {stale ? <span className="ml-1 text-fg-muted">(new activity since Earn&apos;s read)</span> : null}
          </span>
        ) : null}
      </summary>

      <div className="grid gap-4 border-t border-line/60 px-4 py-4 md:grid-cols-2">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Documents</p>
          {a.documents.length === 0 ? (
            <p className="text-xs text-fg-muted">Opened the room; no document yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {a.documents.map((d) => (
                <li key={d.documentId} className="flex items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-fg-secondary">{d.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                    {d.seconds ? formatSeconds(d.seconds) : "—"}
                    {d.downloads ? " · ↓" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 font-mono text-[10px] text-fg-muted">
            First seen {day(a.firstSeen)} · {a.visitDays} day{a.visitDays === 1 ? "" : "s"} active · via{" "}
            {a.links.join(", ")}
          </p>
        </div>
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Timeline</p>
          <ol className="space-y-1.5">
            {a.timeline.slice(0, 20).map((t) => (
              <li key={`${t.day}|${t.documentId ?? ""}`} className="flex items-baseline gap-2 text-xs">
                <span className="w-12 shrink-0 font-mono text-[11px] text-fg-muted">{day(t.lastAt)}</span>
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{t.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                  {[
                    t.seconds ? `read ${formatSeconds(t.seconds)}` : null,
                    t.opens ? "opened" : null,
                    t.downloads ? "downloaded" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}

/** Engagement for one room's links. */
export async function ViewerAnalytics({ roomId }: { roomId?: string } = {}) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !roomId) return null;
  const supabase = await createServerClient();
  const { engagement, reads } = await loadRoomEngagement(supabase, ctx.orgId, roomId);
  const { investors, topDocuments, totals } = engagement;
  const now = Date.now();
  const maxDocSeconds = Math.max(1, ...topDocuments.map((d) => d.seconds));
  const readCount = investors.filter((a) => reads.has(a.key)).length;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">Investor activity</h3>
          <p className="mt-0.5 text-sm text-fg-secondary">
            Who opened this room, what they read and for how long. Time counts only while a document is on screen and the
            reader is active.
          </p>
        </div>
        {investors.length > 0 ? <AskEarnButton roomId={roomId} hasReads={readCount > 0} /> : null}
      </div>

      {investors.length === 0 && totals.opens === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">No investor activity yet.</p>
          <p className="mt-1 text-xs text-fg-muted">It appears here once someone opens a link to this room.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Readers", String(totals.readers)],
              ["Reading time", formatSeconds(totals.seconds)],
              ["Room opens", String(totals.opens)],
              ["Downloads", String(totals.downloads)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface-1 px-4 py-3">
                <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{k}</dt>
                <dd className="mt-1 font-display text-xl font-semibold text-fg-primary">{v}</dd>
              </div>
            ))}
          </dl>

          {topDocuments.length > 0 ? (
            <section>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Most-read documents</p>
              <ul className="space-y-2 rounded-xl border border-line bg-surface-1 p-4">
                {topDocuments.slice(0, 8).map((d) => (
                  <li key={d.documentId} className="text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-fg-secondary">{d.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                        {formatSeconds(d.seconds)} · {d.readers} reader{d.readers === 1 ? "" : "s"}
                        {d.downloads ? ` · ${d.downloads} ↓` : ""}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-0">
                      <div
                        className="h-full rounded-full bg-gold-500/60"
                        style={{ width: `${(d.seconds / maxDocSeconds) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {investors.length > 0 ? (
            <section>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                Investors · {investors.length}
              </p>
              <div className="space-y-2">
                {investors.slice(0, SHOWN).map((a) => (
                  <Investor key={a.key} a={a} read={reads.get(a.key)} now={now} />
                ))}
              </div>
              {investors.length > SHOWN ? (
                <p className="mt-2 font-mono text-[11px] text-fg-muted">
                  And {investors.length - SHOWN} more. Export the audit log for everyone.
                </p>
              ) : null}
            </section>
          ) : (
            <p className="text-xs text-fg-muted">The room was opened, but no reader has passed a gate or read anything yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
