"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { openSection, updateDocumentStatus } from "./materials-actions";
import { DeleteDocumentButton } from "./DeleteDocumentButton";
import { GenerateAiButton } from "./GenerateAiButton";
import type { DocumentStatus } from "@/lib/supabase/database.types";

export interface AccordionDoc {
  id: string;
  name: string;
  storage_key: string | null;
  status: DocumentStatus;
  qualityScore?: number | null;
  qualityLevel?: string | null;
  qualityGaps?: number | null;
}

export interface AccordionSection {
  key: string;
  label: string;
  ready: boolean;
  docCount: number;
  viaBuild: boolean;
  docs: AccordionDoc[];
  suggestion?: string | null;
  weight: number;
}

function StatusPill({ ready, viaBuild, docCount }: { ready: boolean; viaBuild: boolean; docCount: number }) {
  if (ready && docCount > 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {docCount} doc{docCount > 1 ? "s" : ""}
      </span>
    );
  if (ready && viaBuild)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-sky-400">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
        From Build
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-0 border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-fg-muted/40" />
      Not added
    </span>
  );
}

const STATUS_CYCLE: DocumentStatus[] = ["draft", "review", "ready"];
const STATUS_LABELS: Record<DocumentStatus, string> = { draft: "Draft", review: "Review", ready: "Ready" };
const STATUS_CLASSES: Record<DocumentStatus, string> = {
  draft: "bg-surface-0 border border-line text-fg-muted",
  review: "bg-amber-500/10 border border-amber-500/30 text-amber-400",
  ready: "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400",
};

function StatusCycler({ doc }: { doc: AccordionDoc }) {
  const [status, setStatus] = useState<DocumentStatus>(doc.status);
  const [pending, startTransition] = useTransition();

  function cycle() {
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length];
    setStatus(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", doc.id);
      fd.set("status", next);
      await updateDocumentStatus(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={pending}
      title={`Status: ${STATUS_LABELS[status]} — click to advance`}
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition hover:opacity-80 disabled:opacity-50 ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </button>
  );
}

function SectionRow({ section, defaultOpen }: { section: AccordionSection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [pending, startTransition] = useTransition();

  const hasContent = section.docs.length > 0;

  return (
    <div
      id={`section-${section.key}`}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface-0 transition-all duration-200"
      style={{ boxShadow: open ? "0 2px 8px rgba(0,0,0,0.18)" : undefined }}
    >
      {/* Row header */}
      <div className="flex w-full items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span
            className="shrink-0 font-mono text-xs transition-transform duration-200"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            <span className="text-fg-muted">›</span>
          </span>
          <span className={`truncate text-sm font-medium ${section.ready ? "text-fg-primary" : "text-fg-secondary"}`}>
            {section.label}
          </span>
          {section.weight >= 3 && !section.ready && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">
              Priority
            </span>
          )}
        </button>

        <StatusPill ready={section.ready} viaBuild={section.viaBuild} docCount={section.docCount} />

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!hasContent && (section.key === "overview" || section.key === "thesis" || section.key === "marketing" || section.key === "team" || section.key === "track_record") && (
            <GenerateAiButton sectionKey={section.key} />
          )}
          <form
            action={(fd) => startTransition(async () => { await openSection(fd); })}
            className="shrink-0"
          >
            <input type="hidden" name="section" value={section.key} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "…" : hasContent ? "Open →" : "+ Add"}
            </button>
          </form>
        </div>
      </div>

      {/* Expanded content */}
      {open && hasContent ? (
        <div className="border-t border-line/50 bg-surface-1 px-4 py-3">
          <div className="flex flex-col gap-1.5">
            {section.docs.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-0 px-3 py-2">
                <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                  {d.storage_key ? "↗" : "≡"}
                </span>
                <Link
                  href={`/document/${d.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-fg-secondary transition hover:text-gold-300"
                >
                  {d.name}
                </Link>
                {d.qualityLevel ? (
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider ${
                      d.qualityLevel === "Institutional"
                        ? "border-emerald-400/40 text-emerald-300"
                        : d.qualityLevel === "Solid"
                          ? "border-gold-500/40 text-gold-300"
                          : "border-line text-fg-muted"
                    }`}
                  >
                    {d.qualityLevel}
                  </span>
                ) : null}
                {d.qualityScore != null ? (
                  <span className="shrink-0 font-mono text-[9px] text-fg-muted">
                    {d.qualityScore}%
                  </span>
                ) : null}
                {d.qualityScore != null && d.qualityScore < 80 && d.qualityGaps != null && d.qualityGaps > 0 ? (
                  <span
                    title={`${d.qualityGaps} quality gap${d.qualityGaps > 1 ? "s" : ""} remaining`}
                    className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-amber-500/15 px-1 font-mono text-[8px] text-amber-400"
                  >
                    {d.qualityGaps}
                  </span>
                ) : null}
                <StatusCycler doc={d} />
                <DeleteDocumentButton id={d.id} name={d.name} />
              </div>
            ))}
          </div>
        </div>
      ) : open && !hasContent ? (
        <div className="border-t border-line/50 bg-surface-1 px-4 py-3">
          <p className="text-xs text-fg-muted">
            {section.viaBuild
              ? "This section is covered by your Build foundation data. You can also add a document."
              : section.suggestion ?? "No documents yet — click Add to create or link one."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CoverageAccordion({
  sections,
  nextSuggestion,
  institutionalCount,
}: {
  sections: AccordionSection[];
  nextSuggestion?: { key: string; label: string; suggestion: string } | null;
  institutionalCount?: number;
}) {
  const readyCount = sections.filter((s) => s.ready).length;
  const total = sections.length;

  return (
    <div>
      {/* Institutional banner */}
      {institutionalCount != null && institutionalCount > 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-emerald-400">
            {institutionalCount} document{institutionalCount > 1 ? "s" : ""} at institutional standard
          </span>
        </div>
      ) : null}

      {/* Section list */}
      <div className="flex flex-col gap-2">
        {sections.map((s) => (
          <SectionRow key={s.key} section={s} />
        ))}
      </div>

      {/* Next best action */}
      {nextSuggestion ? (
        <form
          action={openSection}
          className="mt-3 flex items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-2.5"
        >
          <input type="hidden" name="section" value={nextSuggestion.key} />
          <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Next to add</span>
          <span className="truncate text-sm text-fg-primary">{nextSuggestion.suggestion}</span>
          <button
            type="submit"
            className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline"
          >
            Build →
          </button>
        </form>
      ) : readyCount === total ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-emerald-400">All sections covered — institutional-grade coverage.</span>
        </div>
      ) : null}
    </div>
  );
}
