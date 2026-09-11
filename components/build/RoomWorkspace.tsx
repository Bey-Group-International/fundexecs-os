"use client";

// The GP-side data room, shaped like the virtual data rooms allocators already
// work in: a persistent index rail on the left, and one working pane on the
// right that switches between curating contents, issuing links, reading
// activity, and seeing the room exactly as a recipient does.
//
// The rail is the point. In a room with sixty documents the old single scroll
// forced the operator to hunt; here the index is always visible, always
// counted, and search narrows every pane at once.
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { RoomContents, type RoomContentSection, type AvailableDoc } from "./RoomContents";

type Tab = "contents" | "sharing" | "activity" | "preview";

export interface RoomWarnings {
  /** Published but still marked draft or in review. */
  unfinished: string[];
  /** Published with neither a file link nor written content. */
  empty: string[];
}

interface Props {
  roomId: string;
  roomName: string;
  roomDescription: string | null;
  sections: RoomContentSection[];
  available: AvailableDoc[];
  warnings: RoomWarnings;
  coverage: { weightedPercent: number; readyCount: number; total: number };
  activeLinkCount: number;
  nextGap: string | null;
  sharing: ReactNode;
  activity: ReactNode;
  preview: ReactNode;
}

function CoverageArc({ percent }: { percent: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  return (
    <svg width={60} height={60} viewBox="0 0 60 60" className="shrink-0" aria-hidden>
      <circle cx={30} cy={30} r={r} fill="none" stroke="currentColor" strokeWidth={4} className="text-line" />
      <circle
        cx={30}
        cy={30}
        r={r}
        fill="none"
        stroke="#D4AF6A"
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
        className="transition-all duration-700"
      />
      <text x={30} y={35} textAnchor="middle" className="fill-fg-primary font-display text-[13px] font-semibold">
        {percent}%
      </text>
    </svg>
  );
}

export function RoomWorkspace({
  roomId,
  roomName,
  roomDescription,
  sections,
  available,
  warnings,
  coverage,
  activeLinkCount,
  nextGap,
  sharing,
  activity,
  preview,
}: Props) {
  const [tab, setTab] = useState<Tab>("contents");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState(false);

  const attentionIds = useMemo(
    () => new Set([...warnings.unfinished, ...warnings.empty]),
    [warnings.unfinished, warnings.empty],
  );

  const totalDocs = useMemo(
    () => sections.reduce((n, s) => n + s.docs.length, 0),
    [sections],
  );

  // Filters narrow the contents pane only. The rail keeps the room's true
  // counts, so a search never makes the room look smaller than it is.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections
      .filter((s) => !section || s.key === section)
      .map((s) => ({
        ...s,
        docs: s.docs.filter((d) => {
          if (q && !d.name.toLowerCase().includes(q) && !s.label.toLowerCase().includes(q)) return false;
          if (needsAttention && !attentionIds.has(d.id)) return false;
          return true;
        }),
      }))
      .filter((s) => s.docs.length > 0);
  }, [sections, section, query, needsAttention, attentionIds]);

  const filteredCount = filtered.reduce((n, s) => n + s.docs.length, 0);
  const filtering = Boolean(query.trim()) || section !== null || needsAttention;

  const tabBtn = (t: Tab, label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      aria-current={tab === t}
      className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
        tab === t ? "bg-gold-400 text-on-gold" : "border border-line text-fg-secondary hover:text-fg-primary"
      }`}
    >
      {label}
      {badge ? (
        <span className={tab === t ? "opacity-70" : "text-fg-muted"}>{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* ---------------------------------------------------------------- Rail */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-line bg-surface-1" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
          {/* Coverage */}
          <div className="flex items-center gap-3 border-b border-line px-4 py-4">
            <CoverageArc percent={coverage.weightedPercent} />
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">Coverage</p>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {coverage.readyCount} of {coverage.total} sections
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-fg-muted">
                {totalDocs} doc{totalDocs === 1 ? "" : "s"} · {activeLinkCount} live link
                {activeLinkCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="border-b border-line px-3 py-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this room…"
              aria-label="Search this room"
              className="w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
            {attentionIds.size > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setNeedsAttention((v) => !v);
                  setTab("contents");
                }}
                aria-pressed={needsAttention}
                className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-wider transition ${
                  needsAttention
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                    : "border-line text-fg-muted hover:border-amber-500/30 hover:text-amber-400"
                }`}
              >
                Needs attention · {attentionIds.size}
              </button>
            ) : null}
          </div>

          {/* Index */}
          <nav className="flex max-h-[24rem] flex-col gap-0.5 overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => {
                setSection(null);
                setTab("contents");
              }}
              aria-current={section === null}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                section === null
                  ? "bg-surface-0 font-medium text-fg-primary"
                  : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">All documents</span>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted">{totalDocs}</span>
            </button>

            {sections.map((s) => {
              const active = section === s.key;
              const flagged = s.docs.filter((d) => attentionIds.has(d.id)).length;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setSection(active ? null : s.key);
                    setTab("contents");
                  }}
                  aria-current={active}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-surface-0 font-medium text-fg-primary"
                      : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
                  }`}
                  style={active ? { borderLeft: "2px solid #D4AF6A", paddingLeft: "10px" } : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {flagged > 0 ? (
                    <span
                      title={`${flagged} document${flagged > 1 ? "s" : ""} needing attention`}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                    />
                  ) : null}
                  <span className="shrink-0 font-mono text-[11px] text-fg-muted">{s.docs.length}</span>
                </button>
              );
            })}

            {sections.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-muted">Nothing published yet.</p>
            ) : null}
          </nav>

          {/* Gap prompt — creation lives in Documents, so this leaves the room. */}
          {nextGap ? (
            <div className="border-t border-line px-3 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-gold-300">Gap</p>
              <p className="mt-1 text-xs leading-snug text-fg-secondary">{nextGap}</p>
              <Link
                href="/build/documents"
                className="mt-2 inline-block font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
              >
                Open Documents →
              </Link>
            </div>
          ) : null}
        </div>
      </aside>

      {/* ---------------------------------------------------------------- Pane */}
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabBtn("contents", "Contents", totalDocs)}
          {tabBtn("sharing", "Sharing", activeLinkCount)}
          {tabBtn("activity", "Activity")}
          {tabBtn("preview", "Preview as LP")}
        </div>

        {/* Contents */}
        <div hidden={tab !== "contents"}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
                {section ? (sections.find((s) => s.key === section)?.label ?? "Contents") : "Room contents"}
              </h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                {filtering
                  ? `${filteredCount} of ${totalDocs} shown`
                  : `Everything published in ${roomName}${roomDescription ? ` · ${roomDescription}` : ""}`}
              </p>
            </div>
            {filtering ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSection(null);
                  setNeedsAttention(false);
                }}
                className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-gold-300"
              >
                Clear filters
              </button>
            ) : null}
          </div>

          {filtering && filteredCount === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-0 px-4 py-8 text-center">
              <p className="text-sm text-fg-secondary">No documents match.</p>
              <p className="mt-1 text-xs text-fg-muted">Clear the filters to see the whole room.</p>
            </div>
          ) : (
            <RoomContents
              roomId={roomId}
              sections={filtered}
              available={available}
              hideAddFromLibrary={filtering}
            />
          )}
        </div>

        {/* Sharing */}
        <div hidden={tab !== "sharing"}>{sharing}</div>

        {/* Activity */}
        <div hidden={tab !== "activity"}>{activity}</div>

        {/* Preview — the real viewer, built by the same code the live room uses. */}
        <div hidden={tab !== "preview"}>
          <div className="mb-3">
            <h3 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
              Preview as LP
            </h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              Exactly what a recipient sees once they clear this room&apos;s access gates. Document
              links are inert here, and nothing you do in this pane is recorded as viewer activity.
            </p>
          </div>
          <div className="h-[42rem] overflow-hidden rounded-2xl border border-line" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
            {preview}
          </div>
        </div>
      </div>
    </div>
  );
}
