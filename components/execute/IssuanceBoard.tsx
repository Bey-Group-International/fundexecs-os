"use client";

// components/execute/IssuanceBoard.tsx
// Native Issuance board (Execute › Issuance). Presentational + form shell over
// the existing issuance API routes — it reimplements none of the issuance logic,
// it only collects input and posts to:
//   POST /api/issuance/draft   { dealId, securityName, offeringAmountUsd, investorIds?, requestedBy? }
//   POST /api/issuance/issue   { securityId, requestedBy? }
//   GET  /api/issuance/status?securityId=…
// All three return a ProviderResult ({ provider, ok, live, detail, reference?,
// data?: { securityId, status, issuedAt? }, error? }). Same-origin fetch carries
// the auth cookies the routes require. The ledger seeded by the server is merged
// with provider responses so drafts/issues reflect immediately, and router
// refresh reconciles with the persisted envelopes.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  formatUsd,
  mapRecordStatus,
  LEDGER_STATUS_LABEL,
  type IssuanceLedgerRow,
  type IssuanceLedgerStatus,
} from "@/lib/issuance-view";

// --- Prop shapes -------------------------------------------------------------

export interface IssuanceDeal {
  id: string;
  name: string;
}

interface Props {
  ledger: IssuanceLedgerRow[];
  deals: IssuanceDeal[];
}

// Shape returned by the /api/issuance/* routes (ProviderResult spread over
// { provider }). HTTP-level failures instead return { error }.
interface IssuanceApiResult {
  provider?: string;
  ok?: boolean;
  live?: boolean;
  detail?: string;
  reference?: string;
  data?: { securityId?: string; status?: "draft" | "issued" | "cancelled"; issuedAt?: string };
  error?: string;
}

// --- Formatting helpers ------------------------------------------------------

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// --- Badges ------------------------------------------------------------------

const STATUS_META: Record<IssuanceLedgerStatus, string> = {
  draft: "border-line bg-surface-2 text-fg-muted",
  pending:
    "border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]",
  issued:
    "border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]",
  cancelled:
    "border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 text-[color:var(--status-danger)]",
};

function StatusBadge({ status }: { status: IssuanceLedgerStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_META[status]}`}
    >
      {LEDGER_STATUS_LABEL[status]}
    </span>
  );
}

// --- Shared field styles -----------------------------------------------------

const FIELD =
  "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-1 focus:ring-gold-500/40";
const LABEL = "mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted";
const BTN =
  "inline-flex items-center justify-center rounded-lg bg-gold-500 px-4 py-2 text-xs font-medium text-surface-0 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center justify-center rounded-lg border border-line bg-surface-0 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-1 rounded-md border border-red-500/30 bg-red-500/8 px-2.5 py-1.5 text-xs text-red-300">
      {message}
    </p>
  );
}

function FormOk({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-1 rounded-md border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1.5 text-xs text-emerald-300">
      {message}
    </p>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-secondary">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// --- Fetch helper ------------------------------------------------------------

// Normalize a route response into a success flag + message + result. Handles
// both provider-level failure (body.ok === false) and HTTP failure ({ error }).
async function parseResult(
  res: Response,
): Promise<{ ok: boolean; message: string; body: IssuanceApiResult }> {
  let body: IssuanceApiResult = {};
  try {
    body = (await res.json()) as IssuanceApiResult;
  } catch {
    // non-JSON body
  }
  const ok = res.ok && body.ok !== false;
  const message =
    (ok ? body.detail : body.error || body.detail) ??
    (ok ? "Done." : `Request failed (${res.status}).`);
  return { ok, message, body };
}

// --- Ledger list -------------------------------------------------------------

function LedgerList({
  rows,
  busyId,
  rowError,
  onIssue,
  onRefresh,
}: {
  rows: IssuanceLedgerRow[];
  busyId: string | null;
  rowError: { id: string; message: string } | null;
  onIssue: (row: IssuanceLedgerRow) => void;
  onRefresh: (row: IssuanceLedgerRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No securities yet
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Draft an equity or unit issuance below to open the subscription and add it to the ledger.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="hidden grid-cols-[1fr_90px_140px_190px] items-center gap-4 border-b border-line bg-surface-2/30 px-4 py-2 sm:grid">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Security
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Status</span>
        <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Offering
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Actions
        </span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const busy = busyId === row.securityId;
          const canIssue = row.status === "draft" || row.status === "pending";
          return (
            <li
              key={row.securityId}
              className="flex flex-col gap-2 px-4 py-3 transition hover:bg-surface-2/40 sm:grid sm:grid-cols-[1fr_90px_140px_190px] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <span className="truncate text-sm font-medium text-fg-primary">
                  {row.securityName || "Untitled security"}
                </span>
                <p className="mt-0.5 truncate font-mono text-[10px] text-fg-muted">
                  {shortId(row.securityId)}
                  {row.dealId ? ` · deal ${shortId(row.dealId)}` : ""} ·{" "}
                  {row.status === "issued" && row.issuedAt
                    ? `issued ${fmtDate(row.issuedAt)}`
                    : `drafted ${fmtDate(row.createdAt)}`}
                </p>
                {rowError && rowError.id === row.securityId && (
                  <p className="mt-1 font-mono text-[10px] text-red-300">{rowError.message}</p>
                )}
              </div>
              <div>
                <StatusBadge status={row.status} />
              </div>
              <div className="text-left font-mono text-sm tabular-nums text-fg-primary sm:text-right">
                {formatUsd(row.offeringAmountUsd)}
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                {canIssue && (
                  <button
                    type="button"
                    className={BTN_GHOST}
                    disabled={busy}
                    onClick={() => onIssue(row)}
                  >
                    {busy ? "Working…" : "Issue"}
                  </button>
                )}
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={busy}
                  onClick={() => onRefresh(row)}
                >
                  Refresh
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Draft form --------------------------------------------------------------

function DraftSecurityForm({
  deals,
  onDrafted,
}: {
  deals: IssuanceDeal[];
  onDrafted: (row: IssuanceLedgerRow) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [securityName, setSecurityName] = useState("");
  const [offeringAmount, setOfferingAmount] = useState("");
  const [investorIds, setInvestorIds] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    const amount = Number(offeringAmount);
    if (!dealId.trim()) {
      setError("A deal is required.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Offering amount must be a positive number.");
      return;
    }

    const parsedInvestors = investorIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    start(async () => {
      let res: Response;
      try {
        res = await fetch("/api/issuance/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: dealId.trim(),
            securityName: securityName.trim(),
            offeringAmountUsd: amount,
            investorIds: parsedInvestors,
            requestedBy: "issuance-ui",
          }),
        });
      } catch {
        setError("Network error — could not reach the issuance service.");
        return;
      }

      const { ok: success, message, body } = await parseResult(res);
      if (!success) {
        setError(message);
        return;
      }

      const securityId = body.data?.securityId;
      if (securityId) {
        onDrafted({
          securityId,
          securityName: securityName.trim() || "Untitled security",
          status: mapRecordStatus(body.data?.status),
          dealId: dealId.trim(),
          offeringAmountUsd: amount,
          createdAt: new Date().toISOString(),
          issuedAt: body.data?.issuedAt ?? null,
        });
      }

      setSecurityName("");
      setOfferingAmount("");
      setInvestorIds("");
      setOk(message || "Draft security created.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className={LABEL} htmlFor="iss-deal">
          Deal
        </label>
        {deals.length > 0 ? (
          <select
            id="iss-deal"
            className={FIELD}
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            required
          >
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="iss-deal"
            className={FIELD}
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            placeholder="Deal ID"
            required
          />
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="iss-name">
          Security name
        </label>
        <input
          id="iss-name"
          className={FIELD}
          value={securityName}
          onChange={(e) => setSecurityName(e.target.value)}
          placeholder="Series A Preferred Units"
          required
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="iss-amount">
          Offering amount (USD)
        </label>
        <input
          id="iss-amount"
          type="number"
          step="any"
          min="0"
          className={FIELD}
          value={offeringAmount}
          onChange={(e) => setOfferingAmount(e.target.value)}
          placeholder="5000000"
          required
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="iss-investors">
          Investor IDs (optional, comma-separated)
        </label>
        <input
          id="iss-investors"
          className={FIELD}
          value={investorIds}
          onChange={(e) => setInvestorIds(e.target.value)}
          placeholder="inv-1, inv-2"
        />
      </div>

      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Drafting…" : "Draft security"}
        </button>
      </div>
      <FormError message={error} />
      <FormOk message={ok} />
    </form>
  );
}

// --- Status lookup -----------------------------------------------------------

function StatusLookupForm({ onResult }: { onResult: (row: IssuanceLedgerRow) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [securityId, setSecurityId] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const id = securityId.trim();
    if (!id) {
      setError("Enter a security ID.");
      return;
    }

    start(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/issuance/status?securityId=${encodeURIComponent(id)}`);
      } catch {
        setError("Network error — could not reach the issuance service.");
        return;
      }

      const { ok: success, message, body } = await parseResult(res);
      if (!success) {
        setError(message);
        return;
      }

      onResult({
        securityId: body.data?.securityId ?? id,
        securityName: "",
        status: mapRecordStatus(body.data?.status),
        dealId: null,
        offeringAmountUsd: null,
        createdAt: null,
        issuedAt: body.data?.issuedAt ?? null,
      });
      setOk(message || "Status retrieved.");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className={LABEL} htmlFor="iss-status-id">
          Security ID
        </label>
        <input
          id="iss-status-id"
          className={FIELD}
          value={securityId}
          onChange={(e) => setSecurityId(e.target.value)}
          placeholder="Envelope / security id"
        />
      </div>
      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Checking…" : "Check status"}
        </button>
      </div>
      <FormError message={error} />
      <FormOk message={ok} />
    </form>
  );
}

// --- Board -------------------------------------------------------------------

export function IssuanceBoard({ ledger, deals }: Props) {
  const router = useRouter();
  const [, startAction] = useTransition();
  const [rows, setRows] = useState<IssuanceLedgerRow[]>(ledger);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  // Merge a row into the ledger by securityId (prepend when new). Preserves
  // known fields (name, deal, amount) when a status-only response comes back.
  function upsertRow(next: IssuanceLedgerRow) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.securityId === next.securityId);
      if (idx === -1) return [next, ...prev];
      const merged = { ...prev[idx], ...next };
      if (!next.securityName) merged.securityName = prev[idx].securityName;
      if (next.dealId == null) merged.dealId = prev[idx].dealId;
      if (next.offeringAmountUsd == null) merged.offeringAmountUsd = prev[idx].offeringAmountUsd;
      if (!next.createdAt) merged.createdAt = prev[idx].createdAt;
      const copy = prev.slice();
      copy[idx] = merged;
      return copy;
    });
  }

  function issueRow(row: IssuanceLedgerRow) {
    setRowError(null);
    setBusyId(row.securityId);
    startAction(async () => {
      let res: Response;
      try {
        res = await fetch("/api/issuance/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ securityId: row.securityId, requestedBy: "issuance-ui" }),
        });
      } catch {
        setRowError({ id: row.securityId, message: "Network error." });
        setBusyId(null);
        return;
      }
      const { ok: success, message, body } = await parseResult(res);
      if (!success) {
        setRowError({ id: row.securityId, message });
        setBusyId(null);
        return;
      }
      upsertRow({
        ...row,
        status: mapRecordStatus(body.data?.status),
        issuedAt: body.data?.issuedAt ?? row.issuedAt,
      });
      setBusyId(null);
      router.refresh();
    });
  }

  function refreshRow(row: IssuanceLedgerRow) {
    setRowError(null);
    setBusyId(row.securityId);
    startAction(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/issuance/status?securityId=${encodeURIComponent(row.securityId)}`);
      } catch {
        setRowError({ id: row.securityId, message: "Network error." });
        setBusyId(null);
        return;
      }
      const { ok: success, message, body } = await parseResult(res);
      if (!success) {
        setRowError({ id: row.securityId, message });
        setBusyId(null);
        return;
      }
      upsertRow({
        ...row,
        status: mapRecordStatus(body.data?.status),
        issuedAt: body.data?.issuedAt ?? row.issuedAt,
      });
      setBusyId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-fg-secondary">
        Issue digital securities natively — draft an equity or unit offering to open its subscription
        agreement, then issue it for signature and track each security through to completion. Drafting
        and issuance run through the platform&apos;s signing rails; the provider stays swappable.
      </p>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Issuance Ledger
        </p>
        <LedgerList
          rows={rows}
          busyId={busyId}
          rowError={rowError}
          onIssue={issueRow}
          onRefresh={refreshRow}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Draft security"
          subtitle="Open a subscription for an equity or unit issuance."
        >
          <DraftSecurityForm deals={deals} onDrafted={upsertRow} />
        </Panel>
        <Panel title="Look up status" subtitle="Query any security by its ID.">
          <StatusLookupForm onResult={upsertRow} />
        </Panel>
      </div>
    </div>
  );
}
