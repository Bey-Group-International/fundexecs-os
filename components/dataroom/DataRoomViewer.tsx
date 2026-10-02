"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ViewerGate } from "./ViewerGate";
import type { GateConfig } from "./ViewerGate";
import { trackDwell } from "@/components/build/materials-actions";
import { FilePreview } from "@/components/documents/FilePreview";
import type { PreviewKind } from "@/lib/document-files";
import { forwardWheel } from "@/lib/wheel-forward";

export type { GateConfig };

export interface ViewerOrg {
  name: string;
  tagline: string | null;
  legal_name: string | null;
  entity_type: string | null;
  jurisdiction: string | null;
  website: string | null;
  brand_color: string | null;
  logo_url: string | null;
}

export interface ViewerTrackRecord {
  dealCount: number;
  realizedCount: number;
  weightedGrossIrr: number | null;
  pooledMoic: number | null;
  dpi: number | null;
  totalInvested: number | null;
  vintageRange: { from: number; to: number } | null;
}

export interface ViewerThesis {
  title: string;
  summary: string | null;
  asset_classes: string[] | null;
  geographies: string[] | null;
  target_irr: number | null;
  target_moic: number | null;
  check_size_min: number | null;
  check_size_max: number | null;
}

export interface ViewerTeamMember {
  name: string;
  title: string | null;
  email: string | null;
}

export interface ViewerEntity {
  name: string;
  entity_type: string | null;
}

export interface ViewerDoc {
  id: string;
  name: string;
  content: string | null;
  storage_key: string | null;
  doc_type: string | null;
  /** How the in-app viewer can show the file (set by the payload builder). */
  preview_kind?: PreviewKind;
  /** A file in our bucket, as opposed to an external link. */
  uploaded?: boolean;
}

/** Per-link controls set when the link was created. */
export interface ViewControls {
  allowDownload: boolean;
  watermark: boolean;
  /** The link opens one document, not a room. */
  singleDocument: boolean;
}

const DEFAULT_CONTROLS: ViewControls = { allowDownload: true, watermark: false, singleDocument: false };

export interface ViewerSection {
  key: string;
  label: string;
  docs: ViewerDoc[];
}

interface Props {
  token: string;
  shareId: string;
  org: ViewerOrg;
  blended: ViewerTrackRecord;
  thesis: ViewerThesis | null;
  team: ViewerTeamMember[];
  entities: ViewerEntity[];
  docSections: ViewerSection[];
  gateConfig: GateConfig;
  /** True only when the server has already verified every configured gate
   * for this visitor and therefore included real content in the props above.
   * When false, every content prop is an empty/minimal placeholder — the
   * server never sent the real data at all, so there is nothing to leak from
   * this component regardless of client-side state. */
  contentReady: boolean;
  /** Renders the viewer inside the GP workspace as a read-only preview: no
   * dwell tracking, no working document links, and sized to its container
   * rather than the whole screen. The payload is built by the same function the
   * public room uses, so what shows here is what a recipient gets. */
  preview?: boolean;
  viewControls?: ViewControls;
  /** Who is reading, for the preview watermark overlay. */
  viewerLabel?: string | null;
  /** Open on this document's section (the `?doc=` a view-only open redirects to). */
  focusDocumentId?: string | null;
}

function compactUsd(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * Whether this document has a file behind it — an external link, or a file
 * uploaded into the private bucket.
 *
 * The card never links to `storage_key` itself. It links to
 * `/dataroom/<token>/d/<id>`, which re-checks the gate, the room manifest and
 * the link's section allowlist before deciding what to serve, and for an
 * uploaded file mints a signed URL there. So this only decides whether to show
 * an Open button, not where it points.
 */
function hasFile(storageKey: string | null): boolean {
  return Boolean(storageKey);
}

type NavItem =
  | { key: "overview"; label: string }
  | { key: "track_record"; label: string }
  | { key: "thesis"; label: string }
  | { key: "team"; label: string }
  | { key: "structure"; label: string }
  | { key: string; label: string; docs: ViewerDoc[] };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DataRoomViewer({
  token,
  shareId,
  org,
  blended,
  thesis,
  team,
  entities,
  docSections,
  gateConfig,
  contentReady,
  preview = false,
  viewControls = DEFAULT_CONTROLS,
  viewerLabel = null,
  focusDocumentId = null,
}: Props) {
  const accent =
    org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color)
      ? org.brand_color
      : "#D4AF6A";

  const router = useRouter();
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

  // Stable session ID for this page load.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // Build nav
  const nav: NavItem[] = useMemo(() => {
    const items: NavItem[] = [];
    // A single-document link has no firm overview to show — just the document.
    if (!viewControls.singleDocument) items.push({ key: "overview", label: "Overview" });
    if (blended.dealCount > 0) items.push({ key: "track_record", label: "Track Record" });
    if (thesis) items.push({ key: "thesis", label: "Investment Thesis" });
    if (team.length > 0) items.push({ key: "team", label: "Team" });
    if (entities.length > 0) items.push({ key: "structure", label: "Structure" });
    for (const s of docSections) {
      if (s.docs.length > 0) items.push({ key: s.key, label: s.label, docs: s.docs } as NavItem);
    }
    return items;
  }, [blended.dealCount, thesis, team.length, entities.length, docSections, viewControls.singleDocument]);

  const focusSection = focusDocumentId
    ? docSections.find((s) => s.docs.some((d) => d.id === focusDocumentId))?.key
    : undefined;
  const [selected, setSelected] = useState<string>(focusSection ?? nav[0]?.key ?? "overview");
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The full-screen viewer is an app shell: only the reading pane scrolls, so a
  // wheel over the header or a short contents rail used to do nothing. Send it
  // to the pane. Not in the GP preview — there the page around it scrolls — and
  // not while the mobile drawer covers the pane.
  useEffect(() => {
    const shell = shellRef.current;
    const pane = mainRef.current;
    if (!contentReady || preview || sidebarOpen || !shell || !pane) return;
    return forwardWheel(shell, pane);
  }, [contentReady, preview, sidebarOpen]);

  // The nav can change under a live selection — most visibly in the GP preview,
  // where scoping to a link removes the section being read. Resolve the
  // selection during render rather than repairing it in an effect: an effect
  // runs after the render that already dropped the section, so the viewer would
  // paint one frame with an empty pane and no nav item highlighted.
  const effectiveSelected =
    nav.length === 0 || nav.some((n) => n.key === selected) ? selected : nav[0].key;

  // ---------------------------------------------------------------------------
  // Dwell tracking
  // ---------------------------------------------------------------------------

  const dwellStart = useRef<number>(Date.now());
  const dwellSection = useRef<string>(effectiveSelected);
  // Map section key → first document id in that section (for analytics).
  const sectionDocId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of docSections) {
      m.set(s.key, s.docs[0]?.id ?? null);
    }
    return m;
  }, [docSections]);

  const fireDwell = useCallback(
    (sectionKey: string, startMs: number) => {
      // A preview is the GP looking at their own room. Recording it would
      // corrupt the engagement analytics they use to read LP interest.
      if (preview) return;
      const duration = Math.round((Date.now() - startMs) / 1000);
      if (duration < 3) return; // Skip accidental hovers

      const docId = sectionDocId.get(sectionKey) ?? null;
      const fd = new FormData();
      fd.set("share_id", shareId);
      if (docId) fd.set("document_id", docId);
      fd.set("duration_seconds", String(duration));
      fd.set("session_id", sessionId);
      if (viewerEmail) fd.set("viewer_email", viewerEmail);

      void trackDwell(fd);
    },
    [shareId, sessionId, viewerEmail, sectionDocId, preview],
  );

  // Fire dwell on section change.
  const handleSelect = useCallback(
    (key: string) => {
      if (key === effectiveSelected) return;
      fireDwell(dwellSection.current, dwellStart.current);
      dwellSection.current = key;
      dwellStart.current = Date.now();
      setSelected(key);
      setSidebarOpen(false);
      // A new section starts at its top, not wherever the last one was scrolled.
      if (mainRef.current) mainRef.current.scrollTop = 0;
      if (!preview && document.scrollingElement) document.scrollingElement.scrollTop = 0;
    },
    [effectiveSelected, fireDwell, preview],
  );

  // Fire dwell on page unload.
  useEffect(() => {
    if (!contentReady) return;
    const handleUnload = () => fireDwell(dwellSection.current, dwellStart.current);
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, [contentReady, fireDwell]);

  // Reset dwell timer once real content is showing.
  useEffect(() => {
    if (contentReady) {
      dwellStart.current = Date.now();
    }
  }, [contentReady]);

  // ---------------------------------------------------------------------------
  // Gate overlay — shown until the server has verified every configured gate
  // and re-rendered with real content. Note there is no client-side content to
  // protect here at all: when `contentReady` is false, every prop above is an
  // empty placeholder the server sent on purpose, not real data being hidden
  // by CSS.
  // ---------------------------------------------------------------------------

  if (!contentReady) {
    return (
      <>
        {/* Blurred background preview — org name/initial only, never confidential */}
        <div className="flex min-h-screen flex-col bg-surface-0 text-fg-primary select-none pointer-events-none blur-sm opacity-40" aria-hidden>
          <header className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold text-surface-0"
                style={{ backgroundColor: accent }}
              >
                {org.name.charAt(0).toUpperCase()}
              </span>
              <p className="truncate font-display text-sm font-semibold text-fg-primary">{org.name}</p>
            </div>
          </header>
        </div>
        {/* Gate modal */}
        <ViewerGate
          token={token}
          shareId={shareId}
          config={gateConfig}
          onPass={(email) => {
            setViewerEmail(email);
            // Every configured gate is now granted server-side. Re-fetch the
            // Server Component so it reads the fresh pass cookie and returns
            // real content this time — content was never in this render.
            router.refresh();
          }}
        />
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Main viewer
  // ---------------------------------------------------------------------------

  const current = nav.find((n) => n.key === effectiveSelected) ?? nav[0];

  return (
    <div
      ref={shellRef}
      className={`flex flex-col bg-surface-0 text-fg-primary ${
        // Exactly the viewport, so the contents rail stays put and only the
        // reading pane scrolls. With min-h-screen the row grew with its
        // content and the whole window scrolled the rail away.
        preview ? "h-full min-h-0" : "h-dvh"
      }`}
    >
      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-3"
        style={{ borderBottomColor: `${accent}33` }}
      >
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className={`rounded-lg border border-line p-2 text-fg-muted lg:hidden ${preview ? "hidden" : ""}`}
          aria-label="Toggle navigation"
        >
          <span className="block h-0.5 w-4 bg-current mb-1" />
          <span className="block h-0.5 w-4 bg-current mb-1" />
          <span className="block h-0.5 w-4 bg-current" />
        </button>

        {/* Logo / firm name */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold text-surface-0"
              style={{ backgroundColor: accent }}
            >
              {org.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-fg-primary">{org.name}</p>
            {org.tagline ? (
              <p className="truncate text-xs text-fg-muted">{org.tagline}</p>
            ) : null}
          </div>
        </div>

        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
            preview
              ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
              : "border-line bg-surface-1 text-fg-muted"
          }`}
        >
          {preview ? "Preview" : viewControls.allowDownload ? "Read-only" : "View-only"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={
            preview
              ? "relative flex w-48 shrink-0 flex-col border-r border-line bg-surface-1"
              : `
            fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-surface-1 pt-16 transition-transform duration-200 lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-56 lg:shrink-0 lg:pt-0 lg:translate-x-0
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `
          }
        >
          {/* Mobile close overlay */}
          {sidebarOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            />
          ) : null}

          <div className="relative z-10 flex flex-1 flex-col overflow-y-auto py-4">
            <p className="px-4 pb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Contents</p>
            <nav className="flex flex-col gap-0.5 px-2">
              {nav.map((item) => {
                const active = item.key === effectiveSelected;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelect(item.key)}
                    className={`
                      w-full rounded-lg px-3 py-2 text-left text-sm transition
                      ${active
                        ? "bg-surface-0 font-medium text-fg-primary"
                        : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"}
                    `}
                    style={active ? { borderLeft: `2px solid ${accent}`, paddingLeft: "10px" } : undefined}
                  >
                    {item.label}
                    {"docs" in item && item.docs.length > 1 ? (
                      <span className="ml-2 font-mono text-[11px] text-fg-muted">{item.docs.length}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="shrink-0 border-t border-line px-4 py-3">
            {viewerEmail ? (
              <p className="truncate font-mono text-[11px] text-fg-muted">{viewerEmail}</p>
            ) : null}
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              FundExecs OS
            </p>
          </div>
        </aside>

        {/* Content panel */}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          <ContentPanel
            selected={effectiveSelected}
            org={org}
            blended={blended}
            thesis={thesis}
            team={team}
            entities={entities}
            docSections={docSections}
            token={token}
            accent={accent}
            current={current}
            preview={preview}
            controls={viewControls}
            viewerLabel={viewerLabel}
            focusDocumentId={focusDocumentId}
          />
        </main>
      </div>
    </div>
  );
}

function ContentPanel({
  selected,
  org,
  blended,
  thesis,
  team,
  entities,
  docSections,
  token,
  accent,
  preview,
  controls,
  viewerLabel,
  focusDocumentId,
}: {
  selected: string;
  org: ViewerOrg;
  blended: ViewerTrackRecord;
  thesis: ViewerThesis | null;
  team: ViewerTeamMember[];
  entities: ViewerEntity[];
  docSections: ViewerSection[];
  token: string;
  accent: string;
  preview?: boolean;
  current: NavItem;
  controls: ViewControls;
  viewerLabel: string | null;
  focusDocumentId: string | null;
}) {
  if (selected === "overview") {
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Overview" accent={accent} />
        <div className="mt-4 space-y-3 text-sm text-fg-secondary">
          {org.tagline ? <p className="text-base font-medium text-fg-primary">{org.tagline}</p> : null}
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {[org.entity_type, org.jurisdiction, org.website].filter(Boolean).join("  ·  ") || "—"}
          </p>
          {org.legal_name ? (
            <p className="text-xs text-fg-muted">{org.legal_name}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (selected === "track_record") {
    const rows = [
      { v: blended.weightedGrossIrr != null ? `${blended.weightedGrossIrr.toFixed(0)}%` : "—", l: "Gross IRR" },
      { v: blended.pooledMoic != null ? `${blended.pooledMoic.toFixed(1)}x` : "—", l: "MOIC" },
      { v: blended.dpi != null ? `${blended.dpi.toFixed(2)}x` : "—", l: "DPI" },
      { v: compactUsd(blended.totalInvested) ?? "—", l: "Invested" },
    ];
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Track Record" accent={accent} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {rows.map((m) => (
            <div key={m.l} className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-center" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
              <p className="font-display text-2xl font-semibold text-fg-primary">{m.v}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">{m.l}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          {blended.dealCount} deals · {blended.realizedCount} realized
          {blended.vintageRange ? ` · vintages ${blended.vintageRange.from}–${blended.vintageRange.to}` : ""}
        </p>
      </div>
    );
  }

  if (selected === "thesis" && thesis) {
    const checkSize = [
      compactUsd(thesis.check_size_min),
      compactUsd(thesis.check_size_max),
    ].filter(Boolean);
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Investment Thesis" accent={accent} />
        <div className="mt-4 space-y-3">
          <p className="text-base font-semibold text-fg-primary">{thesis.title}</p>
          {thesis.summary ? (
            <p className="text-sm leading-relaxed text-fg-secondary">{thesis.summary}</p>
          ) : null}
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {[
              thesis.asset_classes?.join(", "),
              thesis.geographies?.join(", "),
              checkSize.length ? checkSize.join("–") : null,
              thesis.target_irr != null ? `${thesis.target_irr}% target IRR` : null,
              thesis.target_moic != null ? `${thesis.target_moic}x target MOIC` : null,
            ].filter(Boolean).join("  ·  ") || "—"}
          </p>
        </div>
      </div>
    );
  }

  if (selected === "team") {
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Team" accent={accent} />
        <div className="mt-4 flex flex-wrap gap-2">
          {team.map((m, i) => (
            <span key={i} className="rounded-full border border-line bg-surface-1 px-3 py-1.5 text-sm">
              <span className="font-medium text-fg-primary">{m.name}</span>
              {m.title ? <span className="text-fg-muted"> · {m.title}</span> : null}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (selected === "structure") {
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Structure" accent={accent} />
        <div className="mt-4 space-y-2">
          {entities.map((e, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface-1 px-4 py-2.5">
              <p className="text-sm font-medium text-fg-primary">{e.name}</p>
              {e.entity_type ? <p className="text-xs text-fg-muted">{e.entity_type}</p> : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Document section
  const sec = docSections.find((s) => s.key === selected);
  if (!sec) return null;

  return (
    <div className="max-w-4xl">
      <SectionHeader title={sec.label} accent={accent} />
      <div className="mt-4 space-y-6">
        {sec.docs.map((doc) => (
          <DocCard
            key={doc.id}
            doc={doc}
            token={token}
            accent={accent}
            preview={preview}
            controls={controls}
            viewerLabel={viewerLabel}
            // One document on the page, or the one a link pointed at: open it.
            startOpen={controls.singleDocument || doc.id === focusDocumentId || sec.docs.length === 1}
          />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ title, accent }: { title: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line pb-4">
      <span className="h-5 w-0.5 rounded-full" style={{ backgroundColor: accent }} />
      <h1 className="font-display text-lg font-semibold tracking-tight text-fg-primary">{title}</h1>
    </div>
  );
}

function DocCard({
  doc,
  token,
  accent,
  preview,
  controls,
  viewerLabel,
  startOpen,
}: {
  doc: ViewerDoc;
  token: string;
  accent: string;
  preview?: boolean;
  controls: ViewControls;
  viewerLabel: string | null;
  startOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const href = hasFile(doc.storage_key);
  const kind = doc.preview_kind ?? "none";
  // Uploaded files read in the page. External links still open where they live.
  const previewable = Boolean(doc.uploaded) && kind !== "none";
  const [showFile, setShowFile] = useState(startOpen && previewable);
  const fileUrl = `/dataroom/${token}/d/${doc.id}`;
  const btn = "rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition hover:bg-surface-0";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
      {/* Doc header */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span className="font-mono text-[11px] text-fg-muted">{href ? (doc.uploaded ? "▤" : "↗") : "≡"}</span>
        <p className="min-w-0 flex-1 text-sm font-medium text-fg-primary">{doc.name}</p>
        {doc.content ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
        {previewable && !preview ? (
          <button
            type="button"
            onClick={() => setShowFile((v) => !v)}
            aria-expanded={showFile}
            className={btn}
            style={{ borderColor: `${accent}55`, color: accent }}
          >
            {showFile ? "Hide" : "View"}
          </button>
        ) : null}
        {href && !preview && (controls.allowDownload || !doc.uploaded) ? (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
            style={{ borderColor: `${accent}55`, color: accent }}
          >
            Open →
          </a>
        ) : null}
        {doc.uploaded && !preview && controls.allowDownload ? (
          <a href={`${fileUrl}?download=1`} className={`${btn} border-line text-fg-muted`}>
            Download
          </a>
        ) : null}
        {href && preview ? (
          // No live token in a preview: the real link is minted per recipient.
          <span
            title="Opens the file for the recipient. Inert in preview."
            className="rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted"
          >
            Open →
          </span>
        ) : null}
      </div>

      {showFile && previewable && !preview ? (
        <div className="border-t border-line/50 bg-surface-0 p-3">
          <FilePreview
            kind={kind}
            src={`${fileUrl}?embed=1`}
            previewUrl={`${fileUrl}/preview`}
            name={doc.name}
            viewOnly={!controls.allowDownload}
            overlayLabel={controls.watermark ? viewerLabel || "Confidential" : null}
          />
          {!controls.allowDownload ? (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              View-only — downloads are turned off for this link
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Native content */}
      {doc.content && expanded ? (
        <div className="border-t border-line/50 bg-surface-0 px-5 py-5">
          <MarkdownRenderer content={doc.content} />
        </div>
      ) : null}

      {/* No content, no link */}
      {!doc.content && !href ? (
        <div className="border-t border-line/50 px-5 py-3">
          <p className="text-xs text-fg-muted">Document content not yet available.</p>
        </div>
      ) : null}
    </div>
  );
}
