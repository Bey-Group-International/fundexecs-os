"use client";

// components/execute/ContractStatusBoard.tsx
// Contract lifecycle status board — Contract Monkey clone.
// Shows all contracts grouped by status with renewal alerts.
import { useState } from "react";
import {
  daysUntilExpiry,
  renewalUrgency,
  CONTRACT_STATUS_META,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/contracts";
import type { ContractStatus, DocumentType } from "@/lib/contracts";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

interface Contract {
  id: string;
  title: string;
  documentType: DocumentType;
  status: ContractStatus;
  investorName?: string;
  fundName?: string;
  expiryDate?: string | null;
  signedAt?: string | null;
  effectiveDate?: string | null;
}

const STATUS_ORDER: ContractStatus[] = [
  "draft",
  "review",
  "sent",
  "signed",
  "active",
  "expired",
  "terminated",
];

const COLOR_CLASSES: Record<string, string> = {
  gold: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  blue: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  red: "border-red-500/40 bg-red-500/10 text-red-300",
  slate: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

function RenewalBadge({ expiryDate }: { expiryDate: string | null | undefined }) {
  if (!expiryDate) return null;
  const days = daysUntilExpiry(expiryDate);
  const urgency = renewalUrgency(days);
  if (!urgency || urgency === "ok") return null;

  const label =
    urgency === "expired" ? "Expired" : `${days}d left`;
  const cls =
    urgency === "expired"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : urgency === "critical"
        ? "border-red-500/30 bg-red-500/8 text-red-400"
        : "border-amber-500/30 bg-amber-500/8 text-amber-400";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-xs text-fg-secondary">{value}</dd>
    </div>
  );
}

function ContractDetail({ contract }: { contract: Contract }) {
  const days = daysUntilExpiry(contract.expiryDate ?? null);
  const expiryValue =
    contract.expiryDate == null
      ? "—"
      : days == null
        ? formatDate(contract.expiryDate)
        : `${formatDate(contract.expiryDate)} · ${
            days < 0 ? `${Math.abs(days)}d ago` : `${days}d left`
          }`;

  return (
    <div className="border-t border-line bg-surface-2/20 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <DetailField label="Document Type" value={DOCUMENT_TYPE_LABELS[contract.documentType]} />
        <DetailField label="Status" value={CONTRACT_STATUS_META[contract.status].label} />
        <DetailField label="Investor" value={contract.investorName ?? "—"} />
        <DetailField label="Fund" value={contract.fundName ?? "—"} />
        <DetailField label="Effective" value={formatDate(contract.effectiveDate)} />
        <DetailField label="Signed" value={formatDate(contract.signedAt)} />
        <DetailField label="Expiry" value={expiryValue} />
      </dl>
    </div>
  );
}

function ContractRow({ contract }: { contract: Contract }) {
  const [open, setOpen] = useState(false);
  const meta = CONTRACT_STATUS_META[contract.status];
  const colorClass = COLOR_CLASSES[meta.color];

  return (
    <div className="border-b border-line last:border-0">
      <div className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">{contract.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
            {DOCUMENT_TYPE_LABELS[contract.documentType]}
            {contract.investorName && ` · ${contract.investorName}`}
            {contract.fundName && ` · ${contract.fundName}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RenewalBadge expiryDate={contract.expiryDate} />
          <span
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${colorClass}`}
          >
            {meta.label}
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide contract details" : "View contract"}
            className="font-mono text-[10px] text-fg-muted transition hover:text-gold-400"
          >
            <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
              →
            </span>
          </button>
        </div>
      </div>
      {open && <ContractDetail contract={contract} />}
    </div>
  );
}

export function ContractStatusBoard({ contracts }: { contracts: Contract[] }) {
  const grouped = STATUS_ORDER.reduce<Record<ContractStatus, Contract[]>>(
    (acc, status) => {
      acc[status] = contracts.filter((c) => c.status === status);
      return acc;
    },
    {} as Record<ContractStatus, Contract[]>,
  );

  const renewalAlerts = contracts.filter((c) => {
    const days = daysUntilExpiry(c.expiryDate ?? null);
    const u = renewalUrgency(days);
    return u === "critical" || u === "soon" || u === "expired";
  });

  if (contracts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No contracts yet
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Generate a contract from a template or upload an existing one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {renewalAlerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/6 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
            ⚠ Renewal Alerts — {renewalAlerts.length} contract
            {renewalAlerts.length !== 1 ? "s" : ""} expiring
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {renewalAlerts.map((c) => (
              <p key={c.id} className="text-xs text-fg-secondary">
                {c.title} — {daysUntilExpiry(c.expiryDate ?? null) ?? 0} days remaining
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface-1">
        {STATUS_ORDER.filter((s) => grouped[s].length > 0).map((status) => (
          <div key={status}>
            <div className="border-b border-line bg-surface-2/30 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {CONTRACT_STATUS_META[status].label} · {grouped[status].length}
              </span>
            </div>
            {grouped[status].map((c) => (
              <ContractRow key={c.id} contract={c} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
