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

/** What the room says about itself, above its documents. */
export interface ViewerRoom {
  name: string;
  /** The firm's note to the reader; null when none was written. */
  welcomeNote: string | null;
}

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
  /** The room's name and welcome note. Absent on a single-document link. */
  room?: ViewerRoom | null;
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

/**
 * Anchor of a document section on the page. Namespaced because the Build-backed
 * pages (team, thesis, track record) and the document sections share names: a
 * room's "Investment Strategy & Thesis" documents are filed under `thesis`, the
 * same key as the firm's thesis page. They are one band, never two.
 */
const sectionBand = (sectionKey: string) => `sec-${sectionKey}`;
const TEAM_BAND = "team";
const STRUCTURE_BAND = "structure";

interface MenuItem {
  key: string;
  label: string;
}

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
  room = null,
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

  // The room is one page: a hero, then each section as a band down a single
  // scroll. The menu under the header jumps to a band and follows the scroll.
  const total = docSections.reduce((n, s) => n + s.docs.length, 0);
  const menu: MenuItem[] = useMemo(() => {
    // A single-document link has no firm page to show: just the document.
    if (viewControls.singleDocument) return [];
    const items: MenuItem[] = sections.map((s) => ({
      key: sectionBand(s.key),
      label: s.label,
    }));
    if (team.length > 0) items.push({ key: TEAM_BAND, label: "Team" });
    if (entities.length > 0)
      items.push({ key: STRUCTURE_BAND, label: "Structure" });
    return items;
  }, [team.length, entities.length, sections, viewControls.singleDocument]);

  const [active, setActive] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // The full-screen viewer is an app shell: only the reading pane scrolls, so a
  // wheel over the header used to do nothing. Send it to the pane. Not in the GP
  // preview — there the page around it scrolls.
  useEffect(() => {
    const shell = shellRef.current;
    const pane = mainRef.current;
    if (!contentReady || preview || !shell || !pane) return;
    return forwardWheel(shell, pane);
  }, [contentReady, preview]);

  // Which band is being read, for the menu. A browser without the observer just
  // has no highlight; the menu still works.
  useEffect(() => {
    const pane = mainRef.current;
    if (!contentReady || !pane || menu.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.band;
          if (key) visible.set(key, e.isIntersecting);
        }
        setActive(menu.find((m) => visible.get(m.key))?.key ?? null);
      },
      { root: pane, rootMargin: "-15% 0px -65% 0px" },
    );
    pane
      .querySelectorAll<HTMLElement>("[data-band]")
      .forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [contentReady, menu]);

  // Open on the document a link points at (or a row clicked in Room contents).
  useEffect(() => {
    const pane = mainRef.current;
    if (!contentReady || !focusDocumentId || !pane) return;
    const el = Array.from(
      pane.querySelectorAll<HTMLElement>("[data-doc-id]"),
    ).find((d) => d.dataset.docId === focusDocumentId);
    el?.scrollIntoView?.({ block: "start" });
  }, [contentReady, focusDocumentId]);
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

  const scrollToBand = useCallback((key: string) => {
    const el = mainRef.current?.querySelector<HTMLElement>(
      `[data-band="${key}"]`,
    );
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    setActive(key);
  }, []);


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

  const latest = sections
    .flatMap((sec) => sec.docs.map((d) => d.updatedAt ?? ""))
    .filter(Boolean)
    .sort()
    .pop();
  const contactEmail = team.find((m) => m.email)?.email ?? null;
  const gutter = compact ? "px-4" : "px-4 sm:px-6 lg:px-10";

  return (
    <div
      ref={shellRef}
      className={`flex flex-col bg-surface-0 text-fg-primary ${
        // Exactly the viewport, so the header and menu stay put and only the
        // page scrolls.
        preview ? "h-full min-h-0" : "h-dvh print:h-auto"
      }`}
    >
      {/* Top bar */}
      <header
        className={`flex shrink-0 items-center gap-3 border-b border-line py-3 sm:gap-4 print:border-b-2 ${gutter}`}
        style={{ borderBottomColor: `${accent}33` }}
      >
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
          <p className="truncate font-display text-sm font-semibold text-fg-primary">
            {org.name}
          </p>
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

      {/* The menu: a row that scrolls sideways on a phone and jumps to a band. */}
      {menu.length > 0 ? (
        <nav
          aria-label="Sections"
          className={`flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface-1 py-1.5 print:hidden ${gutter}`}
        >
          {menu.map((item) => {
            const on = item.key === active;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => scrollToBand(item.key)}
                aria-current={on ? "true" : undefined}
                className={`min-h-11 shrink-0 whitespace-nowrap rounded-md px-3 text-sm transition sm:min-h-9 ${
                  on
                    ? "bg-surface-0 font-medium text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-0/60 hover:text-fg-primary"
                }`}
                style={on ? { boxShadow: `inset 0 -2px 0 ${accent}` } : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      ) : null}

      <main
        ref={mainRef}
        className="min-w-0 flex-1 overflow-y-auto print:overflow-visible"
      >
        {viewControls.singleDocument ? null : (
          <Hero
            org={org}
            room={room}
            blended={blended}
            total={total}
            latest={latest}
            accent={accent}
            gutter={gutter}
            compact={compact}
            contactEmail={contactEmail}
            hasSections={menu.length > 0}
            onBrowse={() => menu[0] && scrollToBand(menu[0].key)}
          />
        )}

        <div className={`mx-auto w-full max-w-5xl py-2 ${gutter}`}>
          {sections.map((sec) => (
            <Band key={sec.key} id={sectionBand(sec.key)} title={sec.label} accent={accent}>
              {sec.key === BUILD_PAGE_SECTION.thesis && thesis ? (
                <ThesisSummary thesis={thesis} />
              ) : null}
              {sec.key === BUILD_PAGE_SECTION.trackRecord &&
              blended.dealCount > 0 ? (
                <TrackRecordSummary blended={blended} compact={compact} />
              ) : null}
              <div className="mt-4 space-y-3">
                {sec.docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    token={token}
                    accent={accent}
                    preview={preview}
                    controls={viewControls}
                    viewerLabel={viewerLabel}
                    signerEmail={signerEmail}
                    // One document by its own link, or the one a link points at: open it.
                    // A page of open previews is not a page: the reader opens what they want.
                    startOpen={
                      viewControls.singleDocument || doc.id === focusDocumentId
                    }
                  />
                ))}
              </div>
            </Band>
          ))}

          {team.length > 0 ? (
            <Band id={TEAM_BAND} title="Team" accent={accent}>
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
            </Band>
          ) : null}

          {entities.length > 0 ? (
            <Band id={STRUCTURE_BAND} title="Structure" accent={accent}>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
            </Band>
          ) : null}

          {sections.length === 0 && team.length === 0 && entities.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-muted">
              Nothing has been published to this room yet.
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-line py-6 print:hidden">
            <p className="truncate font-mono text-[11px] text-fg-muted">
              {viewerEmail ?? ""}
            </p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              FundExecs OS
            </p>
          </div>
          {/* On paper: who it was prepared for. The menu and buttons are gone. */}
          {!preview ? (
            <p className="mt-2 hidden border-t border-line pt-2 text-xs text-fg-muted print:block">
              Confidential{viewerLabel ? ` · Prepared for ${viewerLabel}` : ""} ·{" "}
              {org.name}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** The room's front page: whose it is, a note from them, the numbers, and where to go next. */
function Hero({
  org,
  room,
  blended,
  total,
  latest,
  accent,
  gutter,
  compact,
  contactEmail,
  hasSections,
  onBrowse,
}: {
  org: ViewerOrg;
  room: ViewerRoom | null;
  blended: ViewerTrackRecord;
  total: number;
  latest: string | undefined;
  accent: string;
  gutter: string;
  compact: boolean;
  contactEmail: string | null;
  hasSections: boolean;
  onBrowse: () => void;
}) {
  const facts = [org.entity_type, org.jurisdiction, org.website]
    .filter(Boolean)
    .join("  ·  ");
  const stats: { v: string; l: string }[] = [];
  if (blended.dealCount > 0) {
    if (blended.weightedGrossIrr != null)
      stats.push({ v: `${blended.weightedGrossIrr.toFixed(0)}%`, l: "Gross IRR" });
    if (blended.pooledMoic != null)
      stats.push({ v: `${blended.pooledMoic.toFixed(1)}x`, l: "MOIC" });
    if (blended.dpi != null)
      stats.push({ v: `${blended.dpi.toFixed(2)}x`, l: "DPI" });
    const invested = compactUsd(blended.totalInvested);
    if (invested) stats.push({ v: invested, l: "Invested" });
  }
  if (total > 0)
    stats.push({ v: String(total), l: total === 1 ? "Document" : "Documents" });
  if (latest && formatDocDate(latest))
    stats.push({ v: formatDocDate(latest), l: "Last updated" });

  const btn =
    "inline-flex min-h-11 items-center justify-center rounded-md px-5 py-2 text-sm font-medium transition";
  return (
    <section
      data-band="top"
      aria-label="Overview"
      className="border-b border-line"
      style={{
        backgroundImage: `radial-gradient(60rem 22rem at 15% -10%, ${accent}1f, transparent 70%)`,
      }}
    >
      <div
        className={`mx-auto w-full max-w-5xl ${gutter} ${compact ? "py-10" : "py-12 sm:py-16"}`}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted">
          Confidential · Data room{room?.name ? ` · ${room.name}` : ""}
        </p>
        <h1
          className={`mt-3 font-display font-semibold tracking-tight text-fg-primary ${
            compact ? "text-3xl" : "text-3xl sm:text-5xl"
          }`}
        >
          {org.name}
        </h1>
        {org.tagline ? (
          <p
            className={`mt-3 max-w-2xl text-fg-secondary ${compact ? "text-base" : "text-base sm:text-xl"}`}
          >
            {org.tagline}
          </p>
        ) : null}
        {facts ? (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {facts}
          </p>
        ) : null}
        {org.legal_name ? (
          <p className="mt-1 text-xs text-fg-muted">{org.legal_name}</p>
        ) : null}

        {room?.welcomeNote ? (
          <div
            className="mt-8 max-w-2xl rounded-xl border border-line bg-surface-1/80 p-5"
            style={{ borderLeft: `3px solid ${accent}` }}
          >
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg-secondary">
              {room.welcomeNote}
            </p>
          </div>
        ) : null}

        {stats.length > 0 ? (
          <dl
            className={`mt-8 grid gap-3 ${
              compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
            }`}
          >
            {stats.map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-line bg-surface-1 px-4 py-3"
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}
              >
                <dd className="whitespace-nowrap font-display text-lg font-semibold text-fg-primary">
                  {s.v}
                </dd>
                <dt className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                  {s.l}
                </dt>
              </div>
            ))}
          </dl>
        ) : null}

        {hasSections || contactEmail ? (
          <div className="mt-8 flex flex-wrap gap-3 print:hidden">
            {hasSections ? (
              <button
                type="button"
                onClick={onBrowse}
                className={`${btn} text-surface-0`}
                style={{ backgroundColor: accent }}
              >
                View documents
              </button>
            ) : null}
            {contactEmail ? (
              <a
                href={`mailto:${contactEmail}`}
                className={`${btn} border border-line text-fg-primary hover:bg-surface-1`}
              >
                Contact the team
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** One section of the page: a heading, then whatever it holds. */
function Band({
  id,
  title,
  accent,
  children,
}: {
  id: string;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-band={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-4 border-b border-line/60 py-10 last:border-b-0"
    >
      <SectionHeader title={title} accent={accent} id={`${id}-title`} />
      {children}
    </section>
  );
}


function TrackRecordSummary({
  blended,
  compact = false,
}: {
  blended: ViewerTrackRecord;
  compact?: boolean;
}) {
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
      <div
        className={`grid grid-cols-2 gap-3 ${compact ? "" : "sm:grid-cols-4"}`}
      >
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

function SectionHeader({
  title,
  accent,
  id,
}: {
  title: string;
  accent: string;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line pb-4">
      <span
        className="h-5 w-0.5 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <h2
        id={id}
        className="font-display text-xl font-semibold tracking-tight text-fg-primary"
      >
        {title}
      </h2>
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
