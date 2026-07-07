"use client";

// components/source/DealPipeline.tsx
// Client component for the deal pipeline — filters, stage advancement, add-deal form,
// and a slide-over detail panel. Data is fetched server-side by DealPipelineLive.
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { advanceDealStageAction, createModuleRow } from "@/app/(app)/[hub]/[module]/actions";
import { DeleteDealBtn } from "@/components/source/SourceDeleteControls";
import { InlineContactEdit } from "@/components/source/InlineContactEdit";
import type { ContactFields } from "@/app/(app)/[hub]/[module]/actions";
import { VerificationPill } from "@/components/source/VerificationBadge";
import PipelineStageOverlay from "@/components/source/PipelineStageOverlay";
import type { FitAnalysis } from "@/lib/source-hub-types";
import type { PipelineStage } from "@/lib/pipeline-stages-types";
import type { DealStage } from "@/lib/supabase/database.types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DealEntry {
  id: string;
  name: string;
  stage: DealStage;
  assetClass: string | null;
  geography: string | null;
  targetAmount: number | null;
  thesisFit: number | null;
  expectedClose: string | null;
  website: string | null;
  notes?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  urlSource?: string | null;
  provenance?: string | null;
  // Apollo-enriched
  industry?: string;
  employeeRange?: string;
  revenueRange?: string;
  aiThesisFit?: FitAnalysis;
  verified: boolean;
  confidence: number;
  provider: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEAL_STAGES: { value: DealStage; label: string }[] = [
  { value: "sourced",      label: "Sourced" },
  { value: "screening",    label: "Screening" },
  { value: "diligence",    label: "Diligence" },
  { value: "underwriting", label: "Underwriting" },
  { value: "ic_review",    label: "IC Review" },
  { value: "closing",      label: "Closing" },
  { value: "owned",        label: "Owned" },
  { value: "exited",       label: "Exited" },
  { value: "passed",       label: "Passed" },
  { value: "dead",         label: "Dead" },
];

const STAGE_BADGE: Record<DealStage, string> = {
  sourced:      "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  screening:    "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  diligence:    "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  underwriting: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  ic_review:    "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  closing:      "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  owned:        "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  exited:       "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  passed:       "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
  dead:         "bg-red-50 text-red-400 ring-1 ring-red-200",
};

const DOC_LABEL: Record<string, string> = {
  screening_memo: "Screening Memo",
  ic_memo: "IC Memo",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function stageLabel(stage: string): string {
  return DEAL_STAGES.find((s) => s.value === stage)?.label ?? stage.replace(/_/g, " ");
}

// ── Stage dropdown ─────────────────────────────────────────────────────────

// A configured pipeline stage is "worth confirming" only when it carries
// metadata the mover should see first — required artifacts, auto-actions, or
// entry conditions. Otherwise we advance instantly (no added friction).
function stageHasMetadata(s: PipelineStage): boolean {
  return (
    s.required_artifacts.length > 0 ||
    s.auto_actions.length > 0 ||
    Object.keys(s.entry_conditions).length > 0
  );
}

function StageDropdown({
  deal,
  onAdvanced,
  pipelineStages = [],
}: {
  deal: DealEntry;
  onAdvanced: (dealId: string, newStage: DealStage, suggestDocType?: string) => void;
  pipelineStages?: PipelineStage[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  // When set, a configured-stage move is awaiting confirmation in the overlay.
  const [confirmMove, setConfirmMove] = useState<{ target: DealStage; stage: PipelineStage } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Link a target DealStage to a configured pipeline stage by name. There is no
  // explicit mapping column, so we match the stage label (or enum value)
  // case-insensitively against pipeline_stages.name.
  function matchConfiguredStage(target: DealStage): PipelineStage | null {
    const label = stageLabel(target).toLowerCase();
    return (
      pipelineStages.find((s) => {
        const name = s.name.trim().toLowerCase();
        return name === label || name === target;
      }) ?? null
    );
  }

  function runAdvance(newStage: DealStage, pipelineStageId?: string) {
    setAdvanceError(null);
    startTransition(async () => {
      try {
        const result = await advanceDealStageAction(deal.id, newStage, pipelineStageId);
        if (result.error) {
          setAdvanceError(result.error);
        } else if (result.ok) {
          onAdvanced(deal.id, newStage, result.suggestDocType);
        }
      } catch {
        setAdvanceError("Failed to update stage. Please try again.");
      }
    });
  }

  function advance(newStage: DealStage) {
    setOpen(false);
    const configured = matchConfiguredStage(newStage);
    if (configured && stageHasMetadata(configured)) {
      // Preview the stage's requirements/automations before committing.
      setConfirmMove({ target: newStage, stage: configured });
      return;
    }
    runAdvance(newStage);
  }

  const badgeClass = STAGE_BADGE[deal.stage] ?? "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200";

  return (
    <div className="relative" ref={ref}>
      {advanceError && (
        <p className="mb-1 text-[10px] text-red-400">{advanceError}</p>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={pending}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize transition ${badgeClass} ${pending ? "opacity-60" : "cursor-pointer hover:opacity-80"}`}
      >
        {stageLabel(deal.stage)}
        <svg className="h-2.5 w-2.5 opacity-60" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[140px] rounded-xl border border-line bg-surface-1 py-1 shadow-xl">
          {DEAL_STAGES.filter((s) => s.value !== deal.stage).map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => advance(s.value)}
              className="block w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {confirmMove && (
        <PipelineStageOverlay
          stage={confirmMove.stage}
          open
          onCancel={() => setConfirmMove(null)}
          onConfirm={() => {
            const { target, stage } = confirmMove;
            setConfirmMove(null);
            runAdvance(target, stage.id);
          }}
        />
      )}
    </div>
  );
}

// ── Deal slide-over detail panel ───────────────────────────────────────────

function DealSlideOver({
  deal,
  onClose,
  onStageAdvanced,
  pipelineStages,
}: {
  deal: DealEntry | null;
  onClose: () => void;
  onStageAdvanced: (dealId: string, newStage: DealStage, suggestDocType?: string) => void;
  pipelineStages?: PipelineStage[];
}) {
  const [suggestDoc, setSuggestDoc] = useState<string | undefined>();
  const [editingContact, setEditingContact] = useState(false);
  const [contactFields, setContactFields] = useState<ContactFields>({
    contact_name: deal?.contactName ?? null,
    contact_email: deal?.contactEmail ?? null,
    contact_phone: deal?.contactPhone ?? null,
    role: null,
    url_source: deal?.urlSource ?? null,
  });

  useEffect(() => {
    if (!deal) setSuggestDoc(undefined);
  }, [deal]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!deal) return null;

  const fit = deal.aiThesisFit;
  const fitColor = fit
    ? fit.fitScore >= 70
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : fit.fitScore >= 40
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : "bg-red-50 text-red-700 ring-1 ring-red-200"
    : "";

  function handleStageAdvanced(dealId: string, newStage: DealStage, docType?: string) {
    onStageAdvanced(dealId, newStage, docType);
    setSuggestDoc(docType);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div role="dialog" aria-modal="true" aria-labelledby="deal-slide-title" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="deal-slide-title" className="truncate text-base font-semibold text-fg-primary">{deal.name}</h2>
            {deal.industry && (
              <p className="mt-0.5 text-xs text-fg-muted">{deal.industry}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close deal details"
            onClick={onClose}
            className="mt-0.5 shrink-0 text-fg-muted hover:text-fg-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Stage */}
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Stage</p>
            <StageDropdown deal={deal} onAdvanced={handleStageAdvanced} pipelineStages={pipelineStages} />
          </div>

          {suggestDoc && (
            <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3">
              <p className="text-xs text-gold-300">
                Now in {stageLabel(deal.stage)} — consider creating a {DOC_LABEL[suggestDoc] ?? suggestDoc}.
              </p>
              <a
                href="/build/documents"
                className="mt-1.5 inline-block font-mono text-[10px] uppercase tracking-widest text-gold-300 hover:underline"
              >
                Go to Documents →
              </a>
            </div>
          )}

          {/* AI Fit */}
          {fit && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">AI Thesis Fit</p>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 font-mono text-sm font-semibold ${fitColor}`}>
                  {fit.fitScore}
                </span>
                <span className="text-xs text-fg-muted">/ 100</span>
              </div>
              {fit.rationale && (
                <p className="mt-2 text-xs leading-relaxed text-fg-secondary">{fit.rationale}</p>
              )}
              {fit.signals?.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {fit.signals.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-fg-muted">
                      <span className="mt-0.5 shrink-0 text-emerald-400">·</span>{s}
                    </li>
                  ))}
                </ul>
              )}
              {fit.firstMove && (
                <p className="mt-2 text-[11px] italic text-fg-muted">First move: {fit.firstMove}</p>
              )}
            </div>
          )}

          {/* Manual thesis fit fallback */}
          {!fit && deal.thesisFit != null && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Thesis Fit</p>
              <span className="font-mono text-sm font-semibold text-accent">
                {Number(deal.thesisFit).toFixed(2)}
              </span>
            </div>
          )}

          {/* Key details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {deal.assetClass && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Asset Class</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{deal.assetClass}</p>
              </div>
            )}
            {deal.geography && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Geography</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{deal.geography}</p>
              </div>
            )}
            {(deal.revenueRange ?? deal.targetAmount != null) && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Target / Revenue</p>
                <p className="mt-0.5 font-mono text-xs text-fg-secondary">
                  {deal.revenueRange ?? formatCurrency(deal.targetAmount)}
                </p>
              </div>
            )}
            {deal.expectedClose && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Expected Close</p>
                <p className="mt-0.5 font-mono text-xs text-fg-secondary">{deal.expectedClose}</p>
              </div>
            )}
            {deal.employeeRange && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Employees</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{deal.employeeRange}</p>
              </div>
            )}
          </div>

          {/* Website */}
          {deal.website && (
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-fg-muted">Website</p>
              <a
                href={deal.website.startsWith("http") ? deal.website : `https://${deal.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-fg-muted hover:text-gold-300 hover:underline"
              >
                {deal.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}

          {/* Point of Contact */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">Point of Contact</p>
              <button
                type="button"
                onClick={() => setEditingContact((v) => !v)}
                className="font-mono text-[9px] text-fg-muted hover:text-gold-300"
              >
                {editingContact ? "Cancel" : "Edit"}
              </button>
            </div>
            {editingContact ? (
              <InlineContactEdit
                table="deals"
                id={deal.id}
                initial={contactFields}
                onClose={() => setEditingContact(false)}
                onSaved={(f) => { setContactFields(f); setEditingContact(false); }}
              />
            ) : (contactFields.contact_name || contactFields.contact_email || contactFields.contact_phone || deal.contactName || deal.contactEmail || deal.contactPhone) ? (
              <div className="space-y-0.5">
                {(contactFields.contact_name ?? deal.contactName) && <p className="text-xs text-fg-secondary">{contactFields.contact_name ?? deal.contactName}</p>}
                {(contactFields.contact_email ?? deal.contactEmail) && (
                  <a href={`mailto:${contactFields.contact_email ?? deal.contactEmail}`} className="font-mono text-[11px] text-fg-muted hover:text-gold-300 hover:underline block">
                    {contactFields.contact_email ?? deal.contactEmail}
                  </a>
                )}
                {(contactFields.contact_phone ?? deal.contactPhone) && <p className="font-mono text-[11px] text-fg-muted">{contactFields.contact_phone ?? deal.contactPhone}</p>}
                {(contactFields.url_source ?? deal.urlSource) && (
                  <a
                    href={(contactFields.url_source ?? deal.urlSource ?? "").startsWith("http") ? (contactFields.url_source ?? deal.urlSource)! : `https://${contactFields.url_source ?? deal.urlSource}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-fg-muted hover:text-gold-300 hover:underline block"
                  >
                    {(contactFields.url_source ?? deal.urlSource ?? "").replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setEditingContact(true)} className="font-mono text-[10px] text-fg-muted/50 hover:text-gold-300">
                + Add contact
              </button>
            )}
          </div>

          {/* Notes */}
          {deal.notes && (
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-fg-muted">Notes</p>
              <p className="text-xs leading-relaxed text-fg-secondary">{deal.notes}</p>
            </div>
          )}

          {/* Verification */}
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Data Source</p>
            <VerificationPill
              verified={deal.verified}
              confidence={deal.confidence}
              provider={deal.provider}
            />
          </div>

          {/* Quick actions */}
          <div className="border-t border-line pt-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Quick Actions</p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/build/documents"
                className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-secondary hover:border-gold-500/40 hover:text-fg-primary"
              >
                Generate Document
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Add deal modal ─────────────────────────────────────────────────────────

function AddDealModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("name") ?? "").trim()) {
      setError("Deal name is required.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createModuleRow("source", "deal_pipeline", fd);
        if (!result.ok) {
          setError(result.error ?? "Failed to save deal. Please try again.");
          return;
        }
        onClose();
        router.refresh();
      } catch {
        setError("Failed to save deal. Please try again.");
      }
    });
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none";
  const labelClass = "block font-mono text-[10px] uppercase tracking-widest text-fg-muted mb-1";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-deal-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface-1 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="add-deal-title" className="text-base font-semibold text-fg-primary">Add Deal</h2>
          <button type="button" aria-label="Close add deal" onClick={onClose} className="text-fg-muted hover:text-fg-primary">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Deal Name *</label>
              <input name="name" type="text" required placeholder="Acme Portfolio Co." className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Website</label>
              <input name="website" type="text" placeholder="acme.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Stage</label>
              <select name="stage" className={inputClass}>
                {DEAL_STAGES.slice(0, 8).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Asset Class</label>
              <input name="asset_class" type="text" placeholder="Real Estate" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Geography</label>
              <input name="geography" type="text" placeholder="US – Southeast" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Target Amount ($)</label>
              <input name="target_amount" type="number" placeholder="50000000" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Expected Close</label>
              <input name="expected_close" type="date" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea name="notes" rows={2} placeholder="Key context…" className={`${inputClass} resize-none`} />
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-4 py-2 text-sm text-fg-muted hover:text-fg-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black hover:bg-gold-400 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Add Deal"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  deals: DealEntry[];
  enrichCap: number;
  pipelineStages?: PipelineStage[];
}

export function DealPipeline({ deals, enrichCap, pipelineStages }: Props) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [fitFilter, setFitFilter] = useState("all");
  const [selectedDeal, setSelectedDeal] = useState<DealEntry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [localDeals, setLocalDeals] = useState<DealEntry[]>(deals);
  const [tableSuggestDoc, setTableSuggestDoc] = useState<{ docType: string; dealName: string } | undefined>();

  // Sync when server re-renders with fresh data
  useEffect(() => {
    setLocalDeals(deals);
    setSelectedDeal((prev) => prev ? (deals.find((d) => d.id === prev.id) ?? prev) : null);
  }, [deals]);

  function handleStageAdvanced(dealId: string, newStage: DealStage, docType?: string) {
    setLocalDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d)),
    );
    setSelectedDeal((prev) => (prev?.id === dealId ? { ...prev, stage: newStage } : prev));
    if (docType) {
      const dealName = localDeals.find((d) => d.id === dealId)?.name ?? "this deal";
      setTableSuggestDoc({ docType, dealName });
    }
  }

  const assetClasses = useMemo(
    () => Array.from(new Set(localDeals.map((d) => d.assetClass).filter(Boolean) as string[])).sort(),
    [localDeals],
  );

  const filtered = useMemo(() => {
    let list = localDeals;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.assetClass?.toLowerCase().includes(q) ||
          d.geography?.toLowerCase().includes(q) ||
          d.industry?.toLowerCase().includes(q),
      );
    }
    if (stageFilter !== "all") list = list.filter((d) => d.stage === stageFilter);
    if (assetFilter !== "all") list = list.filter((d) => d.assetClass === assetFilter);
    if (fitFilter === "high") list = list.filter((d) => (d.aiThesisFit?.fitScore ?? -1) >= 70);
    if (fitFilter === "medium") list = list.filter((d) => { const s = d.aiThesisFit?.fitScore ?? -1; return s >= 40 && s < 70; });
    if (fitFilter === "low") list = list.filter((d) => (d.aiThesisFit?.fitScore ?? 100) < 40);
    if (fitFilter === "scored") list = list.filter((d) => d.aiThesisFit != null);
    return list;
  }, [localDeals, search, stageFilter, assetFilter, fitFilter]);

  const verifiedCount = localDeals.filter((d) => d.verified).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search deals…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All stages</option>
          {DEAL_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {assetClasses.length > 0 && (
          <select
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
          >
            <option value="all">All assets</option>
            {assetClasses.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <select
          value={fitFilter}
          onChange={(e) => setFitFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All fit scores</option>
          <option value="scored">AI-scored only</option>
          <option value="high">High fit (≥70)</option>
          <option value="medium">Medium (40–69)</option>
          <option value="low">Low (&lt;40)</option>
        </select>
        <div className="ml-auto flex items-center gap-3">
          {verifiedCount > 0 && (
            <span className="hidden font-mono text-[10px] text-fg-muted sm:block">
              {verifiedCount}/{Math.min(localDeals.length, enrichCap)} enriched
            </span>
          )}
          <span className="font-mono text-[10px] text-fg-muted">
            {filtered.length}/{localDeals.length} deals
          </span>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-gold-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-gold-400"
          >
            + Add Deal
          </button>
        </div>
      </div>

      {/* Doc suggestion banner (triggered by table-row stage advancement) */}
      {tableSuggestDoc && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3">
          <p className="text-xs text-gold-300">
            <span className="font-semibold">Suggested next step:</span>{" "}
            Create a{" "}
            <span className="font-semibold">
              {tableSuggestDoc.docType === "screening_memo" ? "Screening Memo" : "IC Memo"}
            </span>{" "}
            for {tableSuggestDoc.dealName}.
          </p>
          <button
            type="button"
            onClick={() => setTableSuggestDoc(undefined)}
            className="shrink-0 text-fg-muted hover:text-fg-primary"
            aria-label="Dismiss"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">
            {localDeals.length === 0 ? "No deals yet." : "No deals match your filters."}
          </p>
          {localDeals.length === 0 && (
            <p className="mt-1 text-xs text-fg-muted/60">
              Add a deal above or source targets from Earn.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                {["Deal", "Stage", "Asset Class", "Target", "Fit", "Source", "Close", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr
                  key={d.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${d.name} details`}
                  className={`cursor-pointer hover:bg-surface-2/40 ${i < filtered.length - 1 ? "border-b border-line" : ""}`}
                  onClick={() => setSelectedDeal(d)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDeal(d); }
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-fg">{d.name}</p>
                      {d.provenance === "ai" ? (
                        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-gold-300">AI Sourced</span>
                      ) : (
                        <span className="rounded-full border border-line px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-fg-muted">Manual</span>
                      )}
                    </div>
                    {d.industry ? (
                      <p className="mt-0.5 text-xs text-fg-muted">{d.industry}</p>
                    ) : d.geography ? (
                      <p className="mt-0.5 text-xs text-fg-muted">{d.geography}</p>
                    ) : null}
                    {d.employeeRange && (
                      <p className="mt-0.5 text-xs text-fg-muted/60">{d.employeeRange} employees</p>
                    )}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <StageDropdown deal={d} onAdvanced={handleStageAdvanced} pipelineStages={pipelineStages} />
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {d.assetClass ?? d.industry ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    {d.revenueRange ?? formatCurrency(d.targetAmount)}
                  </td>
                  <td className="px-4 py-3">
                    {d.aiThesisFit != null ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          d.aiThesisFit.fitScore >= 70
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : d.aiThesisFit.fitScore >= 40
                            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            : "bg-red-50 text-red-700 ring-1 ring-red-200"
                        }`}
                        title={d.aiThesisFit.rationale}
                      >
                        {d.aiThesisFit.fitScore}
                      </span>
                    ) : d.thesisFit != null ? (
                      <span className="font-mono text-xs font-semibold text-accent">
                        {Number(d.thesisFit).toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <VerificationPill verified={d.verified} confidence={d.confidence} provider={d.provider} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                    {d.expectedClose ?? "—"}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <DeleteDealBtn id={d.id} onDeleted={(id) => setLocalDeals((prev) => prev.filter((x) => x.id !== id))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-over */}
      <DealSlideOver
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onStageAdvanced={handleStageAdvanced}
        pipelineStages={pipelineStages}
      />

      {/* Add deal modal */}
      {showAddModal && <AddDealModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
