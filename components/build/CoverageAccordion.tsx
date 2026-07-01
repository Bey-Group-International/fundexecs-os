"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { openSection } from "./materials-actions";
import { DeleteDocumentButton } from "./DeleteDocumentButton";

export interface AccordionDoc {
  id: string;
  name: string;
  storage_key: string | null;
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
          {section.weight >= 12 && !section.ready && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">
              Priority
            </span>
          )}
        </button>

        <StatusPill ready={section.ready} viaBuild={section.viaBuild} docCount={section.docCount} />

        {/* Action button */}
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
}: {
  sections: AccordionSection[];
  nextSuggestion?: { key: string; label: string; suggestion: string } | null;
}) {
  const readyCount = sections.filter((s) => s.ready).length;
  const total = sections.length;

  return (
    <div>
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
