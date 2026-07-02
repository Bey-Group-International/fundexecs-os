"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ViewerGate } from "./ViewerGate";
import type { GateConfig } from "./ViewerGate";
import { trackDwell } from "@/components/build/materials-actions";

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
  gateConfig: GateConfig;
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

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch { /* not absolute */ }
  return null;
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
}: Props) {
  const accent =
    org.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color)
      ? org.brand_color
      : "#D4AF6A";

  // Gate state — false until ViewerGate calls onPass.
  const [gatePassed, setGatePassed] = useState(false);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

  // Stable session ID for this page load.
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // If no gates are required, pass immediately.
  const noGates =
    !gateConfig.requireEmail && !gateConfig.requireNda && !gateConfig.passwordProtected;

  useEffect(() => {
    if (noGates && !gatePassed) {
      setGatePassed(true);
    }
  }, [noGates, gatePassed]);

  // Build nav
  const nav: NavItem[] = useMemo(() => {
    const items: NavItem[] = [];
    items.push({ key: "overview", label: "Overview" });
    if (blended.dealCount > 0) items.push({ key: "track_record", label: "Track Record" });
    if (thesis) items.push({ key: "thesis", label: "Investment Thesis" });
    if (team.length > 0) items.push({ key: "team", label: "Team" });
    if (entities.length > 0) items.push({ key: "structure", label: "Structure" });
    for (const s of docSections) {
      if (s.docs.length > 0) items.push({ key: s.key, label: s.label, docs: s.docs } as NavItem);
    }
    return items;
  }, [blended.dealCount, thesis, team.length, entities.length, docSections]);

  const [selected, setSelected] = useState<string>(nav[0]?.key ?? "overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Dwell tracking
  // ---------------------------------------------------------------------------

  const dwellStart = useRef<number>(Date.now());
  const dwellSection = useRef<string>(selected);
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
    [shareId, sessionId, viewerEmail, sectionDocId],
  );

  // Fire dwell on section change.
  const handleSelect = useCallback(
    (key: string) => {
      if (key === selected) return;
      fireDwell(dwellSection.current, dwellStart.current);
      dwellSection.current = key;
      dwellStart.current = Date.now();
      setSelected(key);
      setSidebarOpen(false);
    },
    [selected, fireDwell],
  );

  // Fire dwell on page unload.
  useEffect(() => {
    if (!gatePassed) return;
    const handleUnload = () => fireDwell(dwellSection.current, dwellStart.current);
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, [gatePassed, fireDwell]);

  // Reset dwell timer when gate is passed.
  useEffect(() => {
    if (gatePassed) {
      dwellStart.current = Date.now();
    }
  }, [gatePassed]);

  // ---------------------------------------------------------------------------
  // Gate overlay — shown until all gates pass.
  // ---------------------------------------------------------------------------

  if (!gatePassed) {
    return (
      <>
        {/* Blurred background preview */}
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
            setGatePassed(true);
          }}
        />
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Main viewer
  // ---------------------------------------------------------------------------

  const current = nav.find((n) => n.key === selected) ?? nav[0];

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-fg-primary">
      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-3"
        style={{ borderBottomColor: `${accent}33` }}
      >
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="rounded-lg border border-line p-2 text-fg-muted lg:hidden"
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

        <span className="shrink-0 rounded-full border border-line bg-surface-1 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          Read-only
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`
            fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-surface-1 pt-16 transition-transform duration-200 lg:relative lg:inset-auto lg:z-auto lg:flex lg:w-56 lg:shrink-0 lg:pt-0 lg:translate-x-0
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}
        >
          {/* Mobile close overlay */}
          {sidebarOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-20 bg-black/40 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            />
          ) : null}

          <div className="relative z-10 flex flex-1 flex-col overflow-y-auto py-4">
            <p className="px-4 pb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-fg-muted">Contents</p>
            <nav className="flex flex-col gap-0.5 px-2">
              {nav.map((item) => {
                const active = item.key === selected;
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
                      <span className="ml-2 font-mono text-[9px] text-fg-muted">{item.docs.length}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="shrink-0 border-t border-line px-4 py-3">
            {viewerEmail ? (
              <p className="truncate font-mono text-[9px] text-fg-muted">{viewerEmail}</p>
            ) : null}
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              FundExecs OS
            </p>
          </div>
        </aside>

        {/* Content panel */}
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          <ContentPanel
            selected={selected}
            org={org}
            blended={blended}
            thesis={thesis}
            team={team}
            entities={entities}
            docSections={docSections}
            token={token}
            accent={accent}
            current={current}
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
  current: NavItem;
}) {
  if (selected === "overview") {
    return (
      <div className="max-w-2xl">
        <SectionHeader title="Overview" accent={accent} />
        <div className="mt-4 space-y-3 text-sm text-fg-secondary">
          {org.tagline ? <p className="text-base font-medium text-fg-primary">{org.tagline}</p> : null}
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
              <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">{m.l}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
    <div className="max-w-2xl">
      <SectionHeader title={sec.label} accent={accent} />
      <div className="mt-4 space-y-6">
        {sec.docs.map((doc) => (
          <DocCard key={doc.id} doc={doc} token={token} accent={accent} />
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

function DocCard({ doc, token, accent }: { doc: ViewerDoc; token: string; accent: string }) {
  const [expanded, setExpanded] = useState(true);
  const href = safeHref(doc.storage_key);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.1)" }}>
      {/* Doc header */}
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="font-mono text-[11px] text-fg-muted">{href ? "↗" : "≡"}</span>
        <p className="flex-1 text-sm font-medium text-fg-primary">{doc.name}</p>
        {doc.content ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[9px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
        {href ? (
          <a
            href={`/dataroom/${token}/d/${doc.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition hover:bg-surface-0"
            style={{ borderColor: `${accent}55`, color: accent }}
          >
            Open →
          </a>
        ) : null}
      </div>

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
