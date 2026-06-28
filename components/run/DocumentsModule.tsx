"use client";

// components/run/DocumentsModule.tsx
// Document generation + contract lifecycle management UI.
import { useState, useTransition } from "react";
import { DOCUMENT_TYPE_LABELS, CONTRACT_STATUS_META, type ContractStatus, type DocumentType } from "@/lib/contracts";
import { ALL_DOCUMENT_TYPES, LP_DOCUMENT_TYPES } from "@/lib/document-templates";
import { generateDocumentAction, advanceContractAction } from "@/app/(app)/[hub]/[module]/actions";

interface InvestorOption {
  id: string;
  name: string;
}

interface FundOption {
  id: string;
  name: string;
}

interface ContractRow {
  id: string;
  title: string;
  documentType: DocumentType;
  status: ContractStatus;
  investorName: string | null;
  createdAt: string;
  expiryDate: string | null;
}

const STATUS_COLORS: Record<ContractStatus, string> = {
  draft: "text-slate-400 border-slate-500/30",
  review: "text-blue-400 border-blue-500/30",
  sent: "text-amber-400 border-amber-500/40",
  signed: "text-emerald-400 border-emerald-500/40",
  active: "text-emerald-300 border-emerald-400/30",
  expired: "text-status-danger border-status-danger/30",
  terminated: "text-slate-500 border-slate-600/30",
};

function GenerateModal({
  investors,
  funds,
  onClose,
}: {
  investors: InvestorOption[];
  funds: FundOption[];
  onClose: () => void;
}) {
  const [docType, setDocType] = useState<DocumentType>("subscription_agreement");
  const [investorId, setInvestorId] = useState<string>(investors[0]?.id ?? "");
  const [fundId, setFundId] = useState<string>(funds[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const needsInvestor = LP_DOCUMENT_TYPES.includes(docType as DocumentType);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("doc_type", docType);
      fd.set("fund_id", fundId);
      if (needsInvestor && investorId) fd.set("investor_id", investorId);
      const result = await generateDocumentAction(fd);
      if ("error" in result) {
        setError(result.error ?? "Unknown error");
      } else {
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface-1 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold text-fg-primary">Generate Document</h2>
          <button
            onClick={onClose}
            className="rounded border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
          >
            Cancel
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Document Type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/40 focus:outline-none"
            >
              {ALL_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
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
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {needsInvestor && investors.length > 0 && (
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                LP / Investor
              </label>
              <select
                value={investorId}
                onChange={(e) => setInvestorId(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/40 focus:outline-none"
              >
                {investors.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {needsInvestor && investors.length === 0 && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[10px] text-amber-400">
              Add investors to the LP pipeline first.
            </p>
          )}

          {error && (
            <p className="font-mono text-[10px] text-status-danger">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={pending || (needsInvestor && !investorId)}
            className="w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
          >
            {pending ? "Generating…" : "Generate Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractCard({ contract }: { contract: ContractRow }) {
  const [pending, startTransition] = useTransition();
  const meta = CONTRACT_STATUS_META[contract.status];
  const statusColor = STATUS_COLORS[contract.status];

  function handleAdvance() {
    startTransition(async () => {
      await advanceContractAction(contract.id);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 transition hover:border-line/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">{contract.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
            {DOCUMENT_TYPE_LABELS[contract.documentType]}
            {contract.investorName && ` · ${contract.investorName}`}
          </p>
          <p className="mt-1 font-mono text-[9px] text-fg-muted">
            Created {new Date(contract.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusColor}`}>
          {meta.label}
        </span>
      </div>

      {meta.next && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleAdvance}
            disabled={pending}
            className="rounded border border-line px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-40"
          >
            {pending ? "Saving…" : meta.nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  contracts: ContractRow[];
  investors: InvestorOption[];
  funds: FundOption[];
}

export function DocumentsModule({ contracts, investors, funds }: Props) {
  const [showGenerate, setShowGenerate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = contracts.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (typeFilter !== "all" && c.documentType !== typeFilter) return false;
    return true;
  });

  const statuses = Array.from(new Set(contracts.map((c) => c.status)));
  const types = Array.from(new Set(contracts.map((c) => c.documentType)));

  return (
    <>
      {showGenerate && (
        <GenerateModal
          investors={investors}
          funds={funds}
          onClose={() => setShowGenerate(false)}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowGenerate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
          >
            + Generate Document
          </button>

          {statuses.length > 1 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>{CONTRACT_STATUS_META[s as ContractStatus].label}</option>
              ))}
            </select>
          )}

          {types.length > 1 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t as DocumentType]}</option>
              ))}
            </select>
          )}

          <span className="ml-auto font-mono text-[10px] text-fg-muted">
            {filtered.length} document{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Contract grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
            <span
              aria-hidden
              className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/5 font-mono text-sm text-gold-400"
            >
              ✶
            </span>
            <p className="max-w-sm text-sm text-fg-secondary">
              {contracts.length === 0
                ? "Generate your first document — subscription agreements, side letters, NDAs, and more."
                : "No documents match your filters."}
            </p>
            {contracts.length === 0 && (
              <button
                onClick={() => setShowGenerate(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
              >
                Generate first document →
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <ContractCard key={c.id} contract={c} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
