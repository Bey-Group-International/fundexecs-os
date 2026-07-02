"use client";

// components/source/ServiceProviderDirectory.tsx
// Rich service provider directory with core bench coverage, filtering,
// add/edit/delete, provider detail panel, and optional Apollo enrichment.
import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createProviderAction, updateProviderAction, deleteProviderAction } from "@/app/(app)/[hub]/[module]/actions";
import { VerificationPill } from "@/components/source/VerificationBadge";

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  legal: "Legal",
  audit: "Audit",
  tax: "Tax",
  fund_admin: "Fund Admin",
  placement: "Placement",
  bank: "Bank",
  other: "Other",
};

const PROVIDER_TYPE_COLORS: Record<string, string> = {
  legal: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  audit: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  tax: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  fund_admin: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  placement: "text-blue-300 border-blue-500/30 bg-blue-500/5",
  bank: "text-blue-300 border-blue-500/30 bg-blue-500/5",
  other: "text-fg-muted border-line bg-surface-2",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/40",
  prospective: "text-amber-400 border-amber-500/40",
  former: "text-slate-500 border-slate-600/30",
};

const CORE_BENCH: Array<{ key: string; label: string }> = [
  { key: "legal", label: "Legal" },
  { key: "audit", label: "Audit" },
  { key: "tax", label: "Tax" },
  { key: "fund_admin", label: "Fund Admin" },
];

export interface ProviderEntry {
  id: string;
  name: string;
  providerType: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone?: string | null;
  role?: string | null;
  urlSource?: string | null;
  provenance?: string | null;
  status: string;
  notes: string | null;
  // Apollo-enriched
  website?: string;
  description?: string;
  employeeRange?: string;
  verified?: boolean;
  confidence?: number;
  provider?: string;
}

// ── Core Bench Bar ──────────────────────────────────────────────────────────

function CoreBenchBar({ providers }: { providers: ProviderEntry[] }) {
  const activeTypes = new Set(
    providers.filter((p) => p.status === "active").map((p) => p.providerType),
  );
  const covered = CORE_BENCH.filter((b) => activeTypes.has(b.key));
  const all = covered.length === CORE_BENCH.length;

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${all ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <span className={`font-mono text-sm font-semibold ${all ? "text-emerald-400" : "text-amber-400"}`}>
        {covered.length}/{CORE_BENCH.length}
      </span>
      <div className="flex flex-1 flex-wrap gap-2">
        {CORE_BENCH.map((b) => {
          const ok = activeTypes.has(b.key);
          return (
            <span
              key={b.key}
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-slate-600/30 text-slate-500"
              }`}
            >
              {ok ? "✓ " : "○ "}{b.label}
            </span>
          );
        })}
      </div>
      <span className={`hidden font-mono text-[10px] sm:block ${all ? "text-emerald-400/60" : "text-amber-400/60"}`}>
        {all ? "Institutional bench complete" : "Core bench incomplete"}
      </span>
    </div>
  );
}

// ── Provider Form (shared by Add and Edit) ──────────────────────────────────

function ProviderForm({
  initial,
  onClose,
  onDelete,
}: {
  initial?: ProviderEntry;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isEdit = !!initial;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); prev?.focus(); };
  }, [onClose]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (!String(fd.get("name") ?? "").trim()) {
      setError("Provider name is required.");
      return;
    }
    startTransition(async () => {
      if (isEdit && initial) {
        const result = await updateProviderAction(initial.id, fd);
        if (result.error) { setError(result.error); return; }
      } else {
        const result = await createProviderAction(fd);
        if (result.error) { setError(result.error); return; }
      }
      onClose();
      router.refresh();
    });
  }

  function handleDelete() {
    if (!initial) return;
    startDelete(async () => {
      const result = await deleteProviderAction(initial.id);
      if (result.error) { setError(result.error); return; }
      onDelete?.();
      onClose();
    });
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none";
  const labelClass = "block font-mono text-[10px] uppercase tracking-widest text-fg-muted mb-1";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-form-title"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface-1 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="provider-form-title" className="text-base font-semibold text-fg-primary">
            {isEdit ? "Edit Provider" : "Add Provider"}
          </h2>
          <button type="button" aria-label="Close provider form" onClick={onClose} className="text-fg-muted hover:text-fg-primary">
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Firm Name *</label>
              <input name="name" type="text" required defaultValue={initial?.name} placeholder="Kirkland & Ellis" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Type</label>
              <select name="provider_type" defaultValue={initial?.providerType ?? "legal"} className={inputClass}>
                {Object.entries(PROVIDER_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select name="status" defaultValue={initial?.status ?? "active"} className={inputClass}>
                <option value="active">Active</option>
                <option value="prospective">Prospective</option>
                <option value="former">Former</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Contact Name</label>
              <input name="contact_name" type="text" defaultValue={initial?.contactName ?? ""} placeholder="Jane Smith" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Contact Email</label>
              <input name="contact_email" type="email" defaultValue={initial?.contactEmail ?? ""} placeholder="jane@firm.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Contact Phone</label>
              <input name="contact_phone" type="text" defaultValue={initial?.contactPhone ?? ""} placeholder="+1 212 555 0100" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Contact Role</label>
              <input name="role" type="text" defaultValue={initial?.role ?? ""} placeholder="Partner, Associate…" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Website</label>
              <input name="website" type="text" defaultValue={initial?.website ?? ""} placeholder="kirkland.com" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Source URL</label>
              <input name="url_source" type="text" defaultValue={initial?.urlSource ?? ""} placeholder="https://…" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} placeholder="Relationship context, specialties…" className={`${inputClass} resize-none`} />
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            {isEdit && (
              <div>
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">Delete?</span>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-60"
                    >
                      {deleting ? "Deleting…" : "Confirm"}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-fg-muted hover:text-fg-primary">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-fg-muted hover:text-red-400"
                  >
                    Delete provider
                  </button>
                )}
              </div>
            )}
            <div className={`flex gap-2 ${!isEdit ? "ml-auto" : ""}`}>
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
                {pending ? "Saving…" : isEdit ? "Save" : "Add Provider"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

// ── Provider Card ────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  onClick,
}: {
  provider: ProviderEntry;
  onClick: () => void;
}) {
  const typeColor = PROVIDER_TYPE_COLORS[provider.providerType] ?? PROVIDER_TYPE_COLORS.other;
  const statusColor = STATUS_COLORS[provider.status] ?? STATUS_COLORS.former;
  const typeLabel = PROVIDER_TYPE_LABELS[provider.providerType] ?? provider.providerType;
  const statusLabel = provider.status.charAt(0).toUpperCase() + provider.status.slice(1);

  return (
    <div
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 transition hover:border-line/80 hover:shadow-sm"
      role="button"
      tabIndex={0}
      aria-label={`View ${provider.name} details`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.currentTarget !== e.target) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-fg-primary">{provider.name}</p>
            {provider.provenance === "ai" ? (
              <span className="shrink-0 rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-gold-300">AI Sourced</span>
            ) : (
              <span className="shrink-0 rounded-full border border-line px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-fg-muted">Manual</span>
            )}
          </div>
          {provider.description && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-fg-muted">{provider.description}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${typeColor}`}>
          {typeLabel}
        </span>
      </div>

      {(provider.contactName || provider.contactEmail || provider.contactPhone) && (
        <div className="flex flex-col gap-0.5">
          {provider.contactName && (
            <p className="font-mono text-[10px] text-fg-secondary">
              {provider.contactName}
              {provider.role && <span className="ml-1 text-fg-muted">· {provider.role}</span>}
            </p>
          )}
          {provider.contactEmail && (
            <a
              href={`mailto:${provider.contactEmail}`}
              className="font-mono text-[10px] text-fg-muted transition hover:text-gold-300"
              onClick={(e) => e.stopPropagation()}
            >
              {provider.contactEmail}
            </a>
          )}
          {provider.contactPhone && (
            <p className="font-mono text-[10px] text-fg-muted">{provider.contactPhone}</p>
          )}
        </div>
      )}

      {provider.notes && (
        <p className="line-clamp-2 text-[11px] text-fg-muted">{provider.notes}</p>
      )}

      <div className="flex items-center justify-between">
        {provider.employeeRange && (
          <span className="font-mono text-[9px] text-fg-muted">{provider.employeeRange} employees</span>
        )}
        <span className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {provider.verified != null && (
        <div className="border-t border-line pt-2">
          <VerificationPill
            verified={provider.verified}
            confidence={provider.confidence ?? 0.5}
            provider={provider.provider ?? "manual"}
          />
        </div>
      )}
    </div>
  );
}

// ── Provider Slide-Over ───────────────────────────────────────────────────────

function ProviderSlideOver({
  provider,
  onClose,
  onEdit,
}: {
  provider: ProviderEntry | null;
  onClose: () => void;
  onEdit: (p: ProviderEntry) => void;
}) {
  const slideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!provider) return;
    const el = slideRef.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); prev?.focus(); };
  }, [provider, onClose]);

  if (!provider) return null;

  const typeColor = PROVIDER_TYPE_COLORS[provider.providerType] ?? PROVIDER_TYPE_COLORS.other;
  const typeLabel = PROVIDER_TYPE_LABELS[provider.providerType] ?? provider.providerType;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={slideRef} role="dialog" aria-modal="true" aria-labelledby="provider-slide-title" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="provider-slide-title" className="truncate text-base font-semibold text-fg-primary">{provider.name}</h2>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${typeColor}`}>
                {typeLabel}
              </span>
            </div>
            {provider.description && (
              <p className="mt-0.5 text-xs text-fg-muted">{provider.description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close provider details"
            onClick={onClose}
            className="mt-0.5 shrink-0 text-fg-muted hover:text-fg-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contact */}
          {(provider.contactName || provider.contactEmail) && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Contact</p>
              {provider.contactName && (
                <p className="text-sm font-medium text-fg-primary">{provider.contactName}</p>
              )}
              {provider.contactEmail && (
                <a
                  href={`mailto:${provider.contactEmail}`}
                  className="font-mono text-xs text-fg-muted hover:text-gold-300 hover:underline"
                >
                  {provider.contactEmail}
                </a>
              )}
            </div>
          )}

          {/* Status */}
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Status</p>
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_COLORS[provider.status] ?? ""}`}>
              {provider.status}
            </span>
          </div>

          {/* Enriched details */}
          {provider.employeeRange && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Employees</p>
              <p className="text-xs text-fg-secondary">{provider.employeeRange}</p>
            </div>
          )}

          {provider.website && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Website</p>
              <a
                href={provider.website.startsWith("http") ? provider.website : `https://${provider.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-fg-muted hover:text-gold-300 hover:underline"
              >
                {provider.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}

          {/* Notes */}
          {provider.notes && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Notes</p>
              <p className="text-xs leading-relaxed text-fg-secondary">{provider.notes}</p>
            </div>
          )}

          {/* Data source */}
          {provider.verified != null && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">Data Source</p>
              <VerificationPill
                verified={provider.verified}
                confidence={provider.confidence ?? 0.5}
                provider={provider.provider ?? "manual"}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={() => { onClose(); onEdit(provider); }}
            className="w-full rounded-lg border border-line bg-surface-2 py-2 text-sm text-fg-secondary hover:border-gold-500/40 hover:text-fg-primary"
          >
            Edit Provider
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  providers: ProviderEntry[];
}

export function ServiceProviderDirectory({ providers: initialProviders }: Props) {
  const [providers, setProviders] = useState(initialProviders);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedProvider, setSelectedProvider] = useState<ProviderEntry | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProviderEntry | undefined>();
  const [showAddForm, setShowAddForm] = useState(false);

  const router = useRouter();

  useEffect(() => {
    setProviders(initialProviders);
    setSelectedProvider((prev) =>
      prev ? (initialProviders.find((p) => p.id === prev.id) ?? null) : null,
    );
    setEditingProvider((prev) =>
      prev ? initialProviders.find((p) => p.id === prev.id) : undefined,
    );
  }, [initialProviders]);

  function handleDelete(deletedId: string) {
    setProviders((prev) => prev.filter((p) => p.id !== deletedId));
    router.refresh();
  }

  const filtered = useMemo(() => {
    let list = [...providers];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.contactName?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") list = list.filter((p) => p.providerType === typeFilter);
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    return list.sort((a, b) => {
      const coreA = CORE_BENCH.findIndex((c) => c.key === a.providerType);
      const coreB = CORE_BENCH.findIndex((c) => c.key === b.providerType);
      if (coreA !== coreB) {
        if (coreA === -1) return 1;
        if (coreB === -1) return -1;
        return coreA - coreB;
      }
      return a.name.localeCompare(b.name);
    });
  }, [providers, search, typeFilter, statusFilter]);

  const types = Array.from(new Set(providers.map((p) => p.providerType)));

  return (
    <div className="flex flex-col gap-4">
      {/* Core bench */}
      {providers.length > 0 && <CoreBenchBar providers={providers} />}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search providers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[180px] flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{PROVIDER_TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="prospective">Prospective</option>
          <option value="former">Former</option>
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[10px] text-fg-muted">
            {filtered.length} of {providers.length} providers
          </span>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="rounded-lg bg-gold-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-black hover:bg-gold-400"
          >
            + Add Provider
          </button>
        </div>
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {providers.length === 0
              ? "No service providers yet. Add legal, audit, tax, and fund admin here."
              : "No providers match your filters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onClick={() => setSelectedProvider(p)}
            />
          ))}
        </div>
      )}

      {/* Slide-over detail */}
      <ProviderSlideOver
        provider={selectedProvider}
        onClose={() => setSelectedProvider(null)}
        onEdit={(p) => setEditingProvider(p)}
      />

      {/* Edit form */}
      {editingProvider && (
        <ProviderForm
          initial={editingProvider}
          onClose={() => setEditingProvider(undefined)}
          onDelete={() => handleDelete(editingProvider.id)}
        />
      )}

      {/* Add form */}
      {showAddForm && (
        <ProviderForm onClose={() => setShowAddForm(false)} />
      )}
    </div>
  );
}
