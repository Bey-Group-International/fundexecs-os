"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ViewerGate } from "./ViewerGate";
import type { GateConfig } from "./ViewerGate";
import {
  recordRoomOpen,
  signRoomDocument,
  trackReading,
} from "./viewer-actions";
import { ReadingClock } from "@/lib/data-room-engagement";
import { FilePreview } from "@/components/documents/FilePreview";
import type { PreviewKind } from "@/lib/document-files";
import { forwardWheel } from "@/lib/wheel-forward";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { BUILD_PAGE_SECTION } from "@/lib/data-rooms";

/** Per-browser reader id, so a first-open alert fires once per reader. */
const VISITOR_KEY = "fx-dataroom-visitor";

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
  /**
   * Whether a file or link sits behind this document. Never where it lives: the
   * bucket path or external URL stays on the server, and the card opens
   * `/dataroom/<token>/d/<id>`, which re-checks access.
   */
  hasFile: boolean;
  doc_type: string | null;
  /** How the in-app viewer can show the file (set by the payload builder). */
  preview_kind?: PreviewKind;
  /** A file in our bucket, as opposed to an external link. */
  uploaded?: boolean;
  /** The reader must sign this file before it opens. */
  requiresSignature?: boolean;
  /** They have. When false and required, content and file are withheld. */
  signed?: boolean;
  /** When the document last changed (ISO). */
  updatedAt?: string | null;
  /** Changed since this reader's previous visit. Never set on a first visit. */
  isNew?: boolean;
}

/** Per-link controls set when the link was created. */
export interface ViewControls {
  allowDownload: boolean;
  watermark: boolean;
  /** The link opens one document, not a room. */
  singleDocument: boolean;
}

const DEFAULT_CONTROLS: ViewControls = {
  allowDownload: true,
  watermark: false,
  singleDocument: false,
};

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
  /** Email from the reader's gate pass: signatures are recorded under it. */
  signerEmail?: string | null;
  /** Open on this document's section (the `?doc=` a view-only open redirects to). */
  focusDocumentId?: string | null;
  /** Lay out as on a phone whatever the window width: the section selector, no rail. */
  compact?: boolean;
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

/** "Oct 12, 2026". UTC, so the server and the browser print the same day. */
function formatDocDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Nav key of the "All documents" view: every published file, grouped as the room's Contents lists it. */
const ALL_DOCS_KEY = "all";

/**
 * Nav key of a document section. The Build-backed pages (overview, track_record,
 * thesis, team) and the document sections share names: a room's "Investment
 * Strategy & Thesis" documents are filed under `thesis`, the same key as the
 * firm's thesis page. Un-namespaced, selecting that section rendered the thesis
 * page instead, and the files in it were unreachable for the reader.
 */
const docNavKey = (sectionKey: string) => `docs:${sectionKey}`;

const SECTION_ORDER = new Map(DATA_ROOM_SECTIONS.map((sec, i) => [sec.key, i]));
const SECTION_LABELS = new Map(
  DATA_ROOM_SECTIONS.map((sec) => [sec.key, sec.label]),
);

/**
 * The sections a reader can open: the room's document sections, plus
 * "Investment Strategy & Thesis" and "Track Record & Performance" whenever Build
 * has a thesis or track record, even if no document is filed there. Build's data
 * and the documents for a topic are one section, not two entries in the nav.
 */
function viewerSections(
  docSections: ViewerSection[],
  thesis: ViewerThesis | null,
  blended: ViewerTrackRecord,
): ViewerSection[] {
  const out = docSections.filter((sec) => sec.docs.length > 0);
  const ensure = (key: string, hasBuildData: boolean) => {
    if (hasBuildData && !out.some((sec) => sec.key === key)) {
      out.push({ key, label: SECTION_LABELS.get(key) ?? key, docs: [] });
    }
  };
  ensure(BUILD_PAGE_SECTION.thesis, thesis !== null);
  ensure(BUILD_PAGE_SECTION.trackRecord, blended.dealCount > 0);
  return out.sort(
    (a, b) =>
      (SECTION_ORDER.get(a.key) ?? 99) - (SECTION_ORDER.get(b.key) ?? 99),
  );
}

type NavItem =
  | { key: "overview"; label: string }
  | { key: "all"; label: string; count: number }
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
  signerEmail = null,
  focusDocumentId = null,
  compact = false,
}: Props) {
  const accent =
    org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color)
      ? org.brand_color
      : "#D4AF6A";

  const router = useRouter();
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

  // Stable session ID for this page load.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // What a reader can open: documents by section, with Build's thesis and track
  // record folded into their own sections.
  const sections = useMemo(
    () => viewerSections(docSections, thesis, blended),
    [docSections, thesis, blended],
  );

  // Build nav
  const nav: NavItem[] = useMemo(() => {
    const items: NavItem[] = [];
    // A single-document link has no firm overview to show — just the document.
    if (!viewControls.singleDocument)
      items.push({ key: "overview", label: "Overview" });
    // Everything published, in the order and grouping the GP's Room contents
    // shows, so a reader can see the whole room without opening each section.
    const total = docSections.reduce((n, s) => n + s.docs.length, 0);
    if (!viewControls.singleDocument && total > 0)
      items.push({ key: ALL_DOCS_KEY, label: "All documents", count: total });
    if (team.length > 0) items.push({ key: "team", label: "Team" });
    if (entities.length > 0)
      items.push({ key: "structure", label: "Structure" });
    for (const s of sections) {
      items.push({
        key: docNavKey(s.key),
        label: s.label,
        docs: s.docs,
      } as NavItem);
    }
    return items;
  }, [
    team.length,
    entities.length,
    docSections,
    sections,
    viewControls.singleDocument,
  ]);

  const focusDocSection = focusDocumentId
    ? docSections.find((s) => s.docs.some((d) => d.id === focusDocumentId))
    : undefined;
  const focusSection = focusDocSection
    ? docNavKey(focusDocSection.key)
    : undefined;
  // A reader opens on the room's contents (what the GP published), or on the
  // document a link points at. Overview is one click away. Only what the reader
  // picks is stored: the default is derived from the content on every render, so
  // a gated link, which first renders empty and then refreshes with the room,
  // lands on the contents instead of keeping the empty render's Overview.
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked ??
    focusSection ??
    nav.find((n) => n.key === ALL_DOCS_KEY)?.key ??
    nav[0]?.key ??
    "overview";
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // The full-screen viewer is an app shell: only the reading pane scrolls, so a
  // wheel over the header or a short contents rail used to do nothing. Send it
  // to the pane. Not in the GP preview — there the page around it scrolls — and
  // not while the mobile drawer covers the pane.
  useEffect(() => {
    const shell = shellRef.current;
    const pane = mainRef.current;
    if (!contentReady || preview || !shell || !pane) return;
    return forwardWheel(shell, pane);
  }, [contentReady, preview]);

  // The nav can change under a live selection — most visibly in the GP preview,
  // where scoping to a link removes the section being read. Resolve the
  // selection during render rather than repairing it in an effect: an effect
  // runs after the render that already dropped the section, so the viewer would
  // paint one frame with an empty pane and no nav item highlighted.
  const effectiveSelected =
    nav.length === 0 || nav.some((n) => n.key === selected)
      ? selected
      : nav[0].key;

  // ---------------------------------------------------------------------------
  // Reading time, per document
  // ---------------------------------------------------------------------------

  // The reader's per-browser id, so an ungated link counts one reader across
  // visits. Storage can be blocked; then this page view's id stands in.
  const visitorId = useMemo(() => {
    if (typeof window === "undefined") return sessionId;
    try {
      const stored = window.localStorage.getItem(VISITOR_KEY);
      if (stored) return stored;
      window.localStorage.setItem(VISITOR_KEY, sessionId);
    } catch {
      // Private mode or blocked storage.
    }
    return sessionId;
  }, [sessionId]);

  // Time is credited to the document taking up most of the reading pane, only
  // while the tab is visible and the reader has touched the page in the last
  // two minutes (or has focus inside an embedded PDF). Sent every 30 seconds,
  // on section change and on leaving. A preview is the GP looking at their own
  // room and is never recorded.
  const flushReading = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!contentReady || preview) return;
    const clock = new ReadingClock(Date.now());
    const pane = mainRef.current;

    const inView = (): string | null => {
      if (!pane) return null;
      const box = pane.getBoundingClientRect();
      let best: string | null = null;
      let bestPx = 0;
      pane.querySelectorAll<HTMLElement>("[data-doc-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const px =
          Math.min(r.bottom, box.bottom, window.innerHeight) -
          Math.max(r.top, box.top, 0);
        if (px > bestPx) {
          bestPx = px;
          best = el.dataset.docId ?? null;
        }
      });
      return best;
    };
    const tick = () => {
      const now = Date.now();
      // Scrolling a PDF happens inside its frame, where this page hears nothing.
      if (
        document.activeElement instanceof HTMLIFrameElement &&
        pane?.contains(document.activeElement)
      )
        clock.input(now);
      clock.tick(now, inView(), document.visibilityState === "visible");
    };
    const flush = () => {
      tick();
      const entries = clock.drain();
      if (entries.length)
        void trackReading(token, visitorId, entries).catch(() => undefined);
    };
    flushReading.current = flush;

    const onInput = () => clock.input(Date.now());
    const onVisibility = () =>
      document.visibilityState === "hidden" ? flush() : tick();
    const events = [
      "scroll",
      "wheel",
      "keydown",
      "pointerdown",
      "pointermove",
      "touchstart",
    ] as const;
    events.forEach((e) =>
      window.addEventListener(e, onInput, { passive: true, capture: true }),
    );
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    tick();
    let n = 0;
    const timer = window.setInterval(() => {
      tick();
      if (++n % 6 === 0) flush();
    }, 5_000);

    return () => {
      window.clearInterval(timer);
      events.forEach((e) =>
        window.removeEventListener(e, onInput, { capture: true }),
      );
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
      flushReading.current = () => undefined;
    };
  }, [contentReady, preview, token, visitorId]);

  const handleSelect = useCallback(
    (key: string) => {
      if (key === effectiveSelected) return;
      // Credit the section being left before its documents leave the page.
      flushReading.current();
      setPicked(key);
      // A new section starts at its top, not wherever the last one was scrolled.
      if (mainRef.current) mainRef.current.scrollTop = 0;
      if (!preview && document.scrollingElement)
        document.scrollingElement.scrollTop = 0;
    },
    [effectiveSelected, preview],
  );

  // Tell the server this reader is looking at the room, once per page view.
  // It alerts the link's creator on this reader's first open only.
  const openRecorded = useRef(false);
  useEffect(() => {
    if (!contentReady || preview || openRecorded.current) return;
    openRecorded.current = true;
    void recordRoomOpen(token, visitorId).catch(() => undefined);
  }, [contentReady, preview, token, visitorId]);

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
        <div
          className="flex min-h-screen flex-col bg-surface-0 text-fg-primary select-none pointer-events-none blur-sm opacity-40"
          aria-hidden
        >
          <header className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold text-surface-0"
                style={{ backgroundColor: accent }}
              >
                {org.name.charAt(0).toUpperCase()}
              </span>
              <p className="truncate font-display text-sm font-semibold text-fg-primary">
                {org.name}
              </p>
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
        preview ? "h-full min-h-0" : "h-dvh print:h-auto"
      }`}
    >
      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:gap-4 print:border-b-2"
        style={{ borderBottomColor: `${accent}33` }}
      >
        {/* Logo / firm name */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt=""
              className="h-8 w-8 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-semibold text-surface-0"
              style={{ backgroundColor: accent }}
            >
              {org.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-fg-primary">
              {org.name}
            </p>
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
          {preview
            ? "Preview"
            : viewControls.allowDownload
              ? "Read-only"
              : "View-only"}
        </span>
      </header>

      {/* On a phone the section tree is a selector under the header; the rail is
          for wider screens. 16px text keeps iOS from zooming on focus. */}
      {preview && !compact ? null : (
        <div
          className={`shrink-0 border-b border-line bg-surface-1 px-4 py-2 print:hidden ${compact ? "" : "lg:hidden"}`}
        >
          <label htmlFor="viewer-section" className="sr-only">
            Section
          </label>
          <select
            id="viewer-section"
            value={effectiveSelected}
            onChange={(e) => handleSelect(e.target.value)}
            className="min-h-11 w-full rounded-md border border-line bg-surface-0 px-3 text-base text-fg-primary focus:outline-none"
          >
            {nav.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
                {"count" in item ? ` (${item.count})` : ""}
                {"docs" in item && item.docs.length > 1
                  ? ` (${item.docs.length})`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden print:block print:overflow-visible">
        {/* Sidebar */}
        <aside
          className={
            preview
              ? compact
                ? "hidden"
                : "relative flex w-48 shrink-0 flex-col border-r border-line bg-surface-1 print:hidden"
              : "hidden w-56 shrink-0 flex-col border-r border-line bg-surface-1 lg:flex print:hidden"
          }
        >
          <div className="relative z-10 flex flex-1 flex-col overflow-y-auto py-4">
            <p className="px-4 pb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
              Contents
            </p>
            <nav className="flex flex-col gap-0.5 px-2">
              {nav.map((item) => {
                const active = item.key === effectiveSelected;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelect(item.key)}
                    className={`
                      w-full rounded-lg px-3 py-3 text-left text-sm transition lg:py-2
                      ${
                        active
                          ? "bg-surface-0 font-medium text-fg-primary"
                          : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
                      }
                    `}
                    style={
                      active
                        ? {
                            borderLeft: `2px solid ${accent}`,
                            paddingLeft: "10px",
                          }
                        : undefined
                    }
                  >
                    {item.label}
                    {"docs" in item && item.docs.length > 1 ? (
                      <span className="ml-2 font-mono text-[11px] text-fg-muted">
                        {item.docs.length}
                      </span>
                    ) : null}
                    {"count" in item ? (
                      <span className="ml-2 font-mono text-[11px] text-fg-muted">
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="shrink-0 border-t border-line px-4 py-3">
            {viewerEmail ? (
              <p className="truncate font-mono text-[11px] text-fg-muted">
                {viewerEmail}
              </p>
            ) : null}
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              FundExecs OS
            </p>
          </div>
        </aside>

        {/* Content panel */}
        <main
          ref={mainRef}
          className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-10 print:overflow-visible print:p-0"
        >
          <ContentPanel
            selected={effectiveSelected}
            org={org}
            blended={blended}
            thesis={thesis}
            team={team}
            entities={entities}
            docSections={sections}
            token={token}
            accent={accent}
            current={current}
            preview={preview}
            controls={viewControls}
            viewerLabel={viewerLabel}
            signerEmail={signerEmail}
            focusDocumentId={focusDocumentId}
          />
          {/* On paper: who it was prepared for. The sidebar and buttons are gone. */}
          {!preview ? (
            <p className="mt-8 hidden border-t border-line pt-2 text-xs text-fg-muted print:block">
              Confidential{viewerLabel ? ` · Prepared for ${viewerLabel}` : ""}{" "}
              · {org.name}
            </p>
          ) : null}
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
  signerEmail,
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
  signerEmail: string | null;
  focusDocumentId: string | null;
}) {
  if (selected === "overview") {
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Overview" accent={accent} />
        <div className="mt-4 space-y-3 text-sm text-fg-secondary">
          {org.tagline ? (
            <p className="text-base font-medium text-fg-primary">
              {org.tagline}
            </p>
          ) : null}
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {[org.entity_type, org.jurisdiction, org.website]
              .filter(Boolean)
              .join("  ·  ") || "—"}
          </p>
          {org.legal_name ? (
            <p className="text-xs text-fg-muted">{org.legal_name}</p>
          ) : null}
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
            <span
              key={i}
              className="rounded-full border border-line bg-surface-1 px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-fg-primary">{m.name}</span>
              {m.title ? (
                <span className="text-fg-muted"> · {m.title}</span>
              ) : null}
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
            <div
              key={i}
              className="rounded-lg border border-line bg-surface-1 px-4 py-2.5"
            >
              <p className="text-sm font-medium text-fg-primary">{e.name}</p>
              {e.entity_type ? (
                <p className="text-xs text-fg-muted">{e.entity_type}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selected === ALL_DOCS_KEY) {
    const listed = docSections.filter((sec) => sec.docs.length > 0);
    const total = listed.reduce((n, sec) => n + sec.docs.length, 0);
    const latest = listed
      .flatMap((sec) => sec.docs.map((d) => d.updatedAt ?? ""))
      .filter(Boolean)
      .sort()
      .pop();
    const facts = [
      [org.entity_type, org.jurisdiction].filter(Boolean).join(" · "),
      `${total} ${total === 1 ? "document" : "documents"}`,
      latest ? `Updated ${formatDocDate(latest)}` : "",
    ].filter(Boolean);
    return (
      <div className="max-w-4xl">
        {/* The cover: whose room this is, in a line, before the index. */}
        <div className="mb-8 border-b border-line pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted">
            Confidential · Data room
          </p>
          <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
            {org.name}
          </p>
          {org.tagline ? (
            <p className="mt-1 text-base text-fg-secondary">{org.tagline}</p>
          ) : null}
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {facts.join("  ·  ")}
          </p>
        </div>
        <SectionHeader title="All documents" accent={accent} />
        <div className="mt-4 space-y-6">
          {listed.map((sec) => (
            <div key={sec.key}>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                {sec.label}
                <span className="ml-2 text-fg-muted/70">{sec.docs.length}</span>
              </p>
              <div className="space-y-2">
                {sec.docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    token={token}
                    accent={accent}
                    preview={preview}
                    controls={controls}
                    viewerLabel={viewerLabel}
                    signerEmail={signerEmail}
                    // A long list of open file previews is not a list: the reader opens the ones they want.
                    startOpen={false}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Document section
  const sec = docSections.find((s) => docNavKey(s.key) === selected);
  if (!sec) return null;

  return (
    <div className="max-w-4xl">
      <SectionHeader title={sec.label} accent={accent} />
      {sec.key === BUILD_PAGE_SECTION.thesis && thesis ? (
        <ThesisSummary thesis={thesis} />
      ) : null}
      {sec.key === BUILD_PAGE_SECTION.trackRecord && blended.dealCount > 0 ? (
        <TrackRecordSummary blended={blended} />
      ) : null}
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
            signerEmail={signerEmail}
            // One document on the page, or the one a link pointed at: open it.
            startOpen={
              controls.singleDocument ||
              doc.id === focusDocumentId ||
              sec.docs.length === 1
            }
          />
        ))}
      </div>
    </div>
  );
}

function TrackRecordSummary({ blended }: { blended: ViewerTrackRecord }) {
  const rows = [
    {
      v:
        blended.weightedGrossIrr != null
          ? `${blended.weightedGrossIrr.toFixed(0)}%`
          : "—",
      l: "Gross IRR",
    },
    {
      v: blended.pooledMoic != null ? `${blended.pooledMoic.toFixed(1)}x` : "—",
      l: "MOIC",
    },
    { v: blended.dpi != null ? `${blended.dpi.toFixed(2)}x` : "—", l: "DPI" },
    { v: compactUsd(blended.totalInvested) ?? "—", l: "Invested" },
  ];
  return (
    <div className="mt-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((m) => (
          <div
            key={m.l}
            className="rounded-xl border border-line bg-surface-1 px-4 py-3 text-center"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
          >
            <p className="font-display text-2xl font-semibold text-fg-primary">
              {m.v}
            </p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              {m.l}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
        {blended.dealCount} deals · {blended.realizedCount} realized
        {blended.vintageRange
          ? ` · vintages ${blended.vintageRange.from}–${blended.vintageRange.to}`
          : ""}
      </p>
    </div>
  );
}

function ThesisSummary({ thesis }: { thesis: ViewerThesis }) {
  const checkSize = [
    compactUsd(thesis.check_size_min),
    compactUsd(thesis.check_size_max),
  ].filter(Boolean);
  return (
    <div className="mt-4 max-w-2xl space-y-3">
      <p className="text-base font-semibold text-fg-primary">{thesis.title}</p>
      {thesis.summary ? (
        <p className="text-sm leading-relaxed text-fg-secondary">
          {thesis.summary}
        </p>
      ) : null}
      <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
        {[
          thesis.asset_classes?.join(", "),
          thesis.geographies?.join(", "),
          checkSize.length ? checkSize.join("–") : null,
          thesis.target_irr != null ? `${thesis.target_irr}% target IRR` : null,
          thesis.target_moic != null
            ? `${thesis.target_moic}x target MOIC`
            : null,
        ]
          .filter(Boolean)
          .join("  ·  ") || "—"}
      </p>
    </div>
  );
}

function SectionHeader({ title, accent }: { title: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line pb-4">
      <span
        className="h-5 w-0.5 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <h1 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
        {title}
      </h1>
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
  signerEmail,
  startOpen,
}: {
  doc: ViewerDoc;
  token: string;
  accent: string;
  preview?: boolean;
  controls: ViewControls;
  viewerLabel: string | null;
  signerEmail: string | null;
  startOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const locked = Boolean(doc.requiresSignature) && !doc.signed;
  const href = doc.hasFile;
  const kind = doc.preview_kind ?? "none";
  // Uploaded files read in the page. External links still open where they live.
  const previewable = Boolean(doc.uploaded) && kind !== "none";
  const [showFile, setShowFile] = useState(startOpen && previewable);
  const fileUrl = `/dataroom/${token}/d/${doc.id}`;
  const btn =
    "inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition hover:bg-surface-0 sm:min-h-0 print:hidden";

  return (
    <div
      data-doc-id={doc.id}
      className="overflow-hidden rounded-md border border-line bg-surface-1 print:break-inside-avoid"
    >
      {/* Doc header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11px] text-fg-muted">
          {locked ? "🔒" : href ? (doc.uploaded ? "▤" : "↗") : "≡"}
        </span>
        <p className="min-w-[9rem] flex-1 break-words text-sm font-medium text-fg-primary">
          {doc.name}
        </p>
        {doc.isNew ? (
          <span
            className="shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-surface-0"
            style={{ backgroundColor: accent }}
          >
            New
          </span>
        ) : null}
        {doc.requiresSignature ? (
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ borderColor: `${accent}55`, color: accent }}
          >
            {doc.signed ? "Signed" : "Signature required"}
          </span>
        ) : null}
        {doc.updatedAt && formatDocDate(doc.updatedAt) ? (
          <time
            dateTime={doc.updatedAt}
            title="Last updated"
            className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted"
          >
            {formatDocDate(doc.updatedAt)}
          </time>
        ) : null}
        {doc.content ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex min-h-11 items-center px-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary sm:min-h-0"
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
          <a
            href={`${fileUrl}?download=1`}
            className={`${btn} border-line text-fg-muted`}
          >
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

      {locked ? (
        <SignatureLock
          token={token}
          doc={doc}
          accent={accent}
          preview={preview}
          viewerEmail={signerEmail}
        />
      ) : null}

      {showFile && previewable && !preview ? (
        <div className="border-t border-line/50 bg-surface-0 p-3">
          <FilePreview
            kind={kind}
            src={`${fileUrl}?embed=1`}
            previewUrl={`${fileUrl}/preview`}
            name={doc.name}
            viewOnly={!controls.allowDownload}
            overlayLabel={
              controls.watermark ? viewerLabel || "Confidential" : null
            }
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
        <div className="border-t border-line/50 bg-surface-0 px-4 py-5 sm:px-5">
          <MarkdownRenderer content={doc.content} />
        </div>
      ) : null}

      {/* No content, no link */}
      {!locked && !doc.content && !href ? (
        <div className="border-t border-line/50 px-5 py-3">
          <p className="text-xs text-fg-muted">
            Document content not yet available.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The lock on a file that needs the reader's signature. Nothing of the file is
 * in the page until they sign; signing records their name, the time and the
 * file's fingerprint on the server, then reloads the room with the file open.
 */
function SignatureLock({
  token,
  doc,
  accent,
  preview,
  viewerEmail,
}: {
  token: string;
  doc: ViewerDoc;
  accent: string;
  preview?: boolean;
  viewerEmail: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // The server takes the email from the reader's gate pass; ask only when the
  // link has no email gate to take it from.
  const needsEmail = !viewerEmail || !viewerEmail.includes("@");
  const trimmed = name.trim();
  const canSubmit =
    trimmed.length > 0 &&
    agreed &&
    (!needsEmail || email.trim().length > 0) &&
    !pending;

  if (preview) {
    return (
      <div className="border-t border-line/50 bg-surface-0 px-5 py-4">
        <p className="text-xs text-fg-muted">
          Readers must sign this file before it opens. They will see a signature
          form here.
        </p>
      </div>
    );
  }

  function submit() {
    if (!canSubmit) return;
    setError("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("signer_name", trimmed);
      fd.set("agree", agreed ? "1" : "0");
      fd.set("signature", png ?? "");
      if (needsEmail) fd.set("email", email.trim());
      const result = await signRoomDocument(token, doc.id, fd);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="border-t border-line/50 bg-surface-0 px-4 py-5 sm:px-5">
      <p className="text-sm font-medium text-fg-primary">
        Sign to open this document
      </p>
      <p className="mt-1 text-xs text-fg-secondary">
        The sender needs your signature on{" "}
        <span className="text-fg-primary">{doc.name}</span> before you can read
        it. Your name, the time and a fingerprint of the file are recorded.
      </p>
      <div className="mt-4 max-w-md space-y-3">
        {needsEmail ? (
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-base text-fg-primary sm:text-sm placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
          />
        ) : null}
        <input
          type="text"
          autoComplete="name"
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-base text-fg-primary sm:text-sm placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
        />
        <label className="flex items-start gap-3 py-1 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>
            I have read and agree to this document, and I intend my typed name
            to be my signature.
          </span>
        </label>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="min-h-11 w-full rounded-lg py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: accent }}
        >
          {pending ? "Signing…" : "Sign and open"}
        </button>
      </div>
    </div>
  );
}
