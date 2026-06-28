"use client";

// components/source/AllocatorDirectory.tsx
// Allocator Intelligence Directory — searchable, filterable LP list with
// relationship tracking (last contact, next action, pipeline stage).
import { useState, useMemo, useTransition } from "react";
import {
  ALLOCATOR_TYPE_LABELS,
  ACCREDITATION_LABELS,
  ACCREDITATION_COLORS,
  formatAUM,
  formatTicketRange,
  fitScoreColor,
} from "@/lib/allocator-directory";
import type { AllocatorType, AccreditationStatus } from "@/lib/allocator-directory";
import { logContactAction, createLpInviteAction } from "@/app/(app)/[hub]/[module]/actions";

interface FundOption {
  id: string;
  name: string;
}

interface AllocatorEntry {
  id: string;
  name: string;
  allocatorType: AllocatorType;
  aumMin?: number | null;
  aumMax?: number | null;
  ticketMin?: number | null;
  ticketMax?: number | null;
  primaryStrategies: string[];
  geographicFocus: string[];
  accreditationStatus: AccreditationStatus;
  kycStatus: "not_started" | "in_progress" | "verified" | "expired";
  hqCity?: string;
  hqCountry?: string;
  fitScore?: number;
  temperature?: "cold" | "warm" | "active" | "committed";
  pipelineStage?: string;
  lastContactDays?: number | null;
  commitmentAmount?: number | null;
  topActionTitle?: string | null;
  topActionType?: string | null;
}

const TEMP_COLORS: Record<string, string> = {
  cold: "text-slate-400 border-slate-500/30",
  warm: "text-blue-400 border-blue-500/30",
  active: "text-amber-400 border-amber-500/40",
  committed: "text-emerald-400 border-emerald-500/40",
};

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  engaged: "Engaged",
  diligence: "Diligence",
  soft_circle: "Soft Circle",
  committed: "Committed",
  closed: "Closed",
  passed: "Passed",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "text-slate-400 border-slate-500/30",
  contacted: "text-blue-400 border-blue-500/30",
  engaged: "text-blue-300 border-blue-400/30",
  diligence: "text-amber-400 border-amber-500/40",
  soft_circle: "text-yellow-400 border-yellow-500/40",
  committed: "text-emerald-400 border-emerald-500/40",
  closed: "text-emerald-300 border-emerald-400/40",
  passed: "text-slate-500 border-slate-600/30",
};

function InviteLPModal({
  entry,
  funds,
  onClose,
}: {
  entry: AllocatorEntry;
  funds: FundOption[];
  onClose: () => void;
}) {
  const [fundId, setFundId] = useState<string>(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("lp_name", entry.name);
      fd.set("lp_email", "");
      fd.set("investor_id", entry.id);
      if (fundId) fd.set("fund_id", fundId);
      if (amount) fd.set("commitment_amount", amount);
      const result = await createLpInviteAction(fd);
      if ("error" in result) {
        setError(result.error ?? "Failed to create invite");
      } else if ("portalUrl" in result) {
        setPortalUrl(result.portalUrl as string);
      }
    });
  }

  function handleCopy() {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface-1 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold text-fg-primary">Invite LP to Onboard</h2>
          <button
            onClick={onClose}
            className="rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Close
          </button>
        </div>

        {portalUrl ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-secondary">
              Invite created for <strong className="text-fg-primary">{entry.name}</strong>. Share this link:
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="flex-1 truncate font-mono text-[11px] text-fg-secondary">{portalUrl}</span>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="font-mono text-[10px] text-emerald-400">Invite email sent if email was provided.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">LP</p>
              <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary">{entry.name}</p>
            </div>

            {funds.length > 0 && (
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Fund
                </label>
                <select
                  value={fundId}
                  onChange={(e) => setFundId(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/40 focus:outline-none"
                >
                  <option value="">No specific fund</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Commitment Amount (optional)
              </label>
              <input
                type="number"
                placeholder="e.g. 500000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
              />
            </div>

            {error && <p className="font-mono text-[10px] text-status-danger">{error}</p>}

            <button
              onClick={handleSend}
              disabled={pending}
              className="w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
            >
              {pending ? "Creating invite…" : "Create onboarding link →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LogContactButton({ investorId }: { investorId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await logContactAction(investorId);
      if (!("error" in result)) {
        setDone(true);
        setTimeout(() => setDone(false), 3000);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-40"
    >
      {pending ? "Saving…" : done ? "Logged ✓" : "Log contact"}
    </button>
  );
}

function AllocatorRow({ entry, funds }: { entry: AllocatorEntry; funds: FundOption[] }) {
  const fitColor = entry.fitScore !== undefined ? fitScoreColor(entry.fitScore) : "";
  const tempColor = entry.temperature ? TEMP_COLORS[entry.temperature] : "";
  const stageLabel = entry.pipelineStage ? (STAGE_LABELS[entry.pipelineStage] ?? entry.pipelineStage) : null;
  const stageColor = entry.pipelineStage ? (STAGE_COLORS[entry.pipelineStage] ?? "text-slate-400 border-slate-500/30") : "";
  const [showInvite, setShowInvite] = useState(false);

  return (
    <>
      {showInvite && (
        <InviteLPModal entry={entry} funds={funds} onClose={() => setShowInvite(false)} />
      )}
    <div className="group flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 transition hover:bg-surface-2/40">
      {/* Name + type + next action */}
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-fg-primary">{entry.name}</p>
        <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
          {ALLOCATOR_TYPE_LABELS[entry.allocatorType]}
          {entry.hqCity && ` · ${entry.hqCity}`}
        </p>
        {entry.topActionTitle && (
          <p className="mt-1 font-mono text-[9px] text-amber-400/80 truncate max-w-[220px]">
            ↗ {entry.topActionTitle}
          </p>
        )}
      </div>

      {/* AUM */}
      <div className="hidden w-28 sm:block">
        <p className="font-mono text-xs text-fg-secondary">
          {formatAUM(entry.aumMax ?? entry.aumMin)}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">AUM</p>
      </div>

      {/* Ticket */}
      <div className="hidden w-36 lg:block">
        <p className="font-mono text-xs text-fg-secondary">
          {formatTicketRange(entry.ticketMin ?? null, entry.ticketMax ?? null)}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">Ticket</p>
      </div>

      {/* Strategies */}
      <div className="hidden w-40 xl:flex flex-wrap gap-1">
        {entry.primaryStrategies.slice(0, 2).map((s) => (
          <span key={s} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[9px] text-fg-muted">
            {s.replace(/_/g, " ")}
          </span>
        ))}
        {entry.primaryStrategies.length > 2 && (
          <span className="font-mono text-[9px] text-fg-muted">+{entry.primaryStrategies.length - 2}</span>
        )}
      </div>

      {/* Accreditation */}
      <div className="hidden w-32 lg:block">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${ACCREDITATION_COLORS[entry.accreditationStatus]}`}>
          {ACCREDITATION_LABELS[entry.accreditationStatus]}
        </span>
      </div>

      {/* Fit score */}
      {entry.fitScore !== undefined && (
        <div className="hidden w-16 text-right sm:block">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${fitColor}`}>
            {entry.fitScore}%
          </span>
        </div>
      )}

      {/* Pipeline stage */}
      {stageLabel && (
        <div className="hidden w-24 sm:block">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${stageColor}`}>
            {stageLabel}
          </span>
        </div>
      )}

      {/* Temperature (shown when no stage) */}
      {!stageLabel && entry.temperature && (
        <div className="hidden w-24 sm:block">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${tempColor}`}>
            {entry.temperature}
          </span>
        </div>
      )}

      {/* Last contact + actions */}
      <div className="hidden w-36 text-right lg:flex flex-col items-end gap-1">
        <p className={`font-mono text-[10px] ${entry.lastContactDays != null && entry.lastContactDays > 60 ? "text-amber-400" : "text-fg-muted"}`}>
          {entry.lastContactDays != null ? `${entry.lastContactDays}d ago` : "—"}
        </p>
        <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <LogContactButton investorId={entry.id} />
          <button
            onClick={(e) => { e.stopPropagation(); setShowInvite(true); }}
            className="rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Invite
          </button>
        </span>
      </div>
    </div>
    </>
  );
}

interface Props {
  entries: AllocatorEntry[];
  funds: FundOption[];
}

export function AllocatorDirectory({ entries, funds }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"fit" | "aum" | "last_contact" | "stage">("last_contact");

  const filtered = useMemo(() => {
    let list = entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.hqCity?.toLowerCase().includes(q) ||
          e.primaryStrategies.some((s) => s.includes(q)),
      );
    }
    if (typeFilter !== "all") {
      list = list.filter((e) => e.allocatorType === typeFilter);
    }
    if (stageFilter !== "all") {
      list = list.filter((e) => (e.pipelineStage ?? "prospect") === stageFilter);
    }
    return [...list].sort((a, b) => {
      if (sortBy === "fit") return (b.fitScore ?? 0) - (a.fitScore ?? 0);
      if (sortBy === "aum") return (b.aumMax ?? 0) - (a.aumMax ?? 0);
      if (sortBy === "last_contact")
        return (b.lastContactDays ?? -1) - (a.lastContactDays ?? -1);
      if (sortBy === "stage") {
        const order = ["committed", "closed", "soft_circle", "diligence", "engaged", "contacted", "prospect", "passed"];
        return order.indexOf(a.pipelineStage ?? "prospect") - order.indexOf(b.pipelineStage ?? "prospect");
      }
      return 0;
    });
  }, [entries, search, typeFilter, stageFilter, sortBy]);

  const types = Array.from(new Set(entries.map((e) => e.allocatorType)));
  const stages = Array.from(new Set(entries.map((e) => e.pipelineStage ?? "prospect")));

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search allocators…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-yellow-500/40 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-yellow-500/40 focus:outline-none"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{ALLOCATOR_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-yellow-500/40 focus:outline-none"
        >
          <option value="all">All stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-yellow-500/40 focus:outline-none"
        >
          <option value="last_contact">Sort: Last contact</option>
          <option value="stage">Sort: Stage</option>
          <option value="fit">Sort: Fit score</option>
          <option value="aum">Sort: AUM</option>
        </select>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {filtered.length} of {entries.length} allocators
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-line bg-surface-1">
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-line bg-surface-2/30 px-4 py-2.5">
          <span className="min-w-[200px] flex-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Allocator</span>
          <span className="hidden w-28 font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">AUM</span>
          <span className="hidden w-36 font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Ticket</span>
          <span className="hidden w-40 font-mono text-[10px] uppercase tracking-wider text-fg-muted xl:block">Strategies</span>
          <span className="hidden w-32 font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Accreditation</span>
          <span className="hidden w-16 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">Fit</span>
          <span className="hidden w-24 font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">Stage</span>
          <span className="hidden w-36 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Contact</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">No allocators match your filters</p>
          </div>
        ) : (
          filtered.map((entry) => <AllocatorRow key={entry.id} entry={entry} funds={funds} />)
        )}
      </div>
    </div>
  );
}
