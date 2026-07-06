"use client";

// components/execute/InvoicesBoard.tsx
// Native Invoices board (Execute › Invoices). Presentational + form shell over
// the existing finance server actions — it reimplements none of the domain
// logic, it only collects input and posts to:
//   issueInvoice / recordPayment / createParty  (finance/arap/actions)
//   createEntity                                (finance/actions)
// AR-aging is computed client-side from the invoices already on screen via the
// pure lib/invoice-aging helper, so the summary stays in lockstep with the list.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  issueInvoice,
  recordPayment,
  createParty,
} from "@/app/(app)/finance/arap/actions";
import { createEntity } from "@/app/(app)/finance/actions";
import { summarizeAging, type AgingInput } from "@/lib/invoice-aging";
import type {
  FinInvoiceKind,
  FinInvoiceStatus,
  FinPartyKind,
  FinPaymentDirection,
} from "@/lib/supabase/database.types";

// --- Prop shapes (mapped from DB rows by InvoicesModule) --------------------

export interface InvoiceEntity {
  id: string;
  name: string;
  baseCurrency: string;
}

export interface InvoiceParty {
  id: string;
  name: string;
  kind: FinPartyKind;
  entityId: string;
  isActive: boolean;
}

export interface InvoiceRow {
  id: string;
  entityId: string;
  partyId: string;
  partyName: string;
  kind: FinInvoiceKind;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  total: number;
  amountPaid: number;
  status: FinInvoiceStatus;
}

interface Props {
  entities: InvoiceEntity[];
  parties: InvoiceParty[];
  invoices: InvoiceRow[];
  asOf: string;
}

// --- Formatting helpers ------------------------------------------------------

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function daysOverdue(dueDate: string, asOf: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(at)) return 0;
  return Math.round((at - due) / 86_400_000);
}

// --- Badges ------------------------------------------------------------------

const STATUS_META: Record<FinInvoiceStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-line bg-surface-2 text-fg-muted" },
  open: {
    label: "Open",
    cls: "border-[color:var(--status-info)]/30 bg-[color:var(--status-info)]/10 text-[color:var(--status-info)]",
  },
  partial: {
    label: "Partial",
    cls: "border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 text-[color:var(--status-warning)]",
  },
  paid: {
    label: "Paid",
    cls: "border-[color:var(--status-success)]/30 bg-[color:var(--status-success)]/10 text-[color:var(--status-success)]",
  },
  void: {
    label: "Void",
    cls: "border-[color:var(--status-danger)]/30 bg-[color:var(--status-danger)]/10 text-[color:var(--status-danger)]",
  },
};

function StatusBadge({ status }: { status: FinInvoiceStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

function KindBadge({ kind }: { kind: FinInvoiceKind }) {
  const receivable = kind === "receivable";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
        receivable
          ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
          : "border-line bg-surface-2 text-fg-secondary"
      }`}
    >
      {receivable ? "AR" : "AP"}
    </span>
  );
}

function AgingBadge({ dueDate, asOf }: { dueDate: string; asOf: string }) {
  const od = daysOverdue(dueDate, asOf);
  if (od <= 0) {
    return (
      <span className="font-mono text-[10px] text-fg-muted">
        due {fmtDate(dueDate)}
      </span>
    );
  }
  const cls =
    od > 90
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : od > 60
        ? "border-red-500/30 bg-red-500/8 text-red-400"
        : od > 30
          ? "border-amber-500/30 bg-amber-500/8 text-amber-400"
          : "border-amber-500/25 bg-amber-500/6 text-amber-400";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {od}d overdue
    </span>
  );
}

// --- Shared field styles -----------------------------------------------------

const FIELD =
  "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus:ring-1 focus:ring-gold-500/40";
const LABEL = "mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted";
const BTN =
  "inline-flex items-center justify-center rounded-lg bg-gold-500 px-4 py-2 text-xs font-medium text-surface-0 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50";

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
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-secondary">
        {title}
      </p>
      {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

// --- Onboarding: create the first finance entity ----------------------------

function CreateEntityForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createEntity({ name, baseCurrency: currency });
      if (!res.ok) {
        setError(res.error ?? "Could not create entity.");
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className={LABEL} htmlFor="ent-name">
          Entity name
        </label>
        <input
          id="ent-name"
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Fund GP LLC"
          required
        />
      </div>
      <div className="w-28">
        <label className={LABEL} htmlFor="ent-ccy">
          Base currency
        </label>
        <input
          id="ent-ccy"
          className={FIELD}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
          placeholder="USD"
          maxLength={3}
          required
        />
      </div>
      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Creating…" : "Create entity"}
        </button>
      </div>
      <FormError message={error} />
    </form>
  );
}

// --- Create a billing party --------------------------------------------------

function CreatePartyForm({ entityId }: { entityId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<FinPartyKind>("customer");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    start(async () => {
      const res = await createParty({
        entityId,
        kind,
        name,
        email: email || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not create party.");
        return;
      }
      setName("");
      setEmail("");
      setOk("Party created.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className={LABEL} htmlFor="party-name">
          Name
        </label>
        <input
          id="party-name"
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer or vendor name"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="party-kind">
            Kind
          </label>
          <select
            id="party-kind"
            className={FIELD}
            value={kind}
            onChange={(e) => setKind(e.target.value as FinPartyKind)}
          >
            <option value="customer">Customer</option>
            <option value="vendor">Vendor</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="party-email">
            Email
          </label>
          <input
            id="party-email"
            type="email"
            className={FIELD}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ap@vendor.com"
          />
        </div>
      </div>
      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Saving…" : "Add party"}
        </button>
      </div>
      <FormError message={error} />
      <FormOk message={ok} />
    </form>
  );
}

// --- Issue an invoice (single-line) -----------------------------------------

function IssueInvoiceForm({
  entityId,
  parties,
  defaultCurrency,
  asOf,
}: {
  entityId: string;
  parties: InvoiceParty[];
  defaultCurrency: string;
  asOf: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [kind, setKind] = useState<FinInvoiceKind>("receivable");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [issueDate, setIssueDate] = useState(asOf);
  const [dueDate, setDueDate] = useState(asOf);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [memo, setMemo] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    start(async () => {
      const res = await issueInvoice({
        entityId,
        partyId,
        kind,
        invoiceNo,
        issueDate,
        dueDate,
        currency,
        memo: memo || undefined,
        lines: [
          {
            description,
            quantity: Number(quantity),
            unitPrice: Number(unitPrice),
            taxRate: Number(taxRate) / 100,
          },
        ],
      });
      if (!res.ok) {
        setError(res.error ?? "Could not issue invoice.");
        return;
      }
      setInvoiceNo("");
      setDescription("");
      setUnitPrice("");
      setMemo("");
      setOk("Invoice issued.");
      router.refresh();
    });
  }

  if (parties.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        Add a billing party first — an invoice must be addressed to a customer or
        vendor.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="inv-party">
            Party
          </label>
          <select
            id="inv-party"
            className={FIELD}
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            required
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-kind">
            Kind
          </label>
          <select
            id="inv-kind"
            className={FIELD}
            value={kind}
            onChange={(e) => setKind(e.target.value as FinInvoiceKind)}
          >
            <option value="receivable">Receivable (AR)</option>
            <option value="payable">Payable (AP)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="inv-no">
            Invoice #
          </label>
          <input
            id="inv-no"
            className={FIELD}
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="INV-0001"
            required
          />
        </div>
        <div className="w-full">
          <label className={LABEL} htmlFor="inv-ccy">
            Currency
          </label>
          <input
            id="inv-ccy"
            className={FIELD}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="inv-issue">
            Issue date
          </label>
          <input
            id="inv-issue"
            type="date"
            className={FIELD}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-due">
            Due date
          </label>
          <input
            id="inv-due"
            type="date"
            className={FIELD}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="inv-desc">
          Line description
        </label>
        <input
          id="inv-desc"
          className={FIELD}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Management fee — Q1"
          required
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={LABEL} htmlFor="inv-qty">
            Qty
          </label>
          <input
            id="inv-qty"
            type="number"
            step="any"
            min="0"
            className={FIELD}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-price">
            Unit price
          </label>
          <input
            id="inv-price"
            type="number"
            step="any"
            min="0"
            className={FIELD}
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-tax">
            Tax %
          </label>
          <input
            id="inv-tax"
            type="number"
            step="any"
            min="0"
            className={FIELD}
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="inv-memo">
          Memo (optional)
        </label>
        <input
          id="inv-memo"
          className={FIELD}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Internal note"
        />
      </div>

      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Issuing…" : "Issue invoice"}
        </button>
      </div>
      <FormError message={error} />
      <FormOk message={ok} />
    </form>
  );
}

// --- Record a payment --------------------------------------------------------

function RecordPaymentForm({
  entityId,
  parties,
  defaultCurrency,
  asOf,
}: {
  entityId: string;
  parties: InvoiceParty[];
  defaultCurrency: string;
  asOf: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [direction, setDirection] = useState<FinPaymentDirection>("inbound");
  const [paymentDate, setPaymentDate] = useState(asOf);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    start(async () => {
      const res = await recordPayment({
        entityId,
        partyId,
        direction,
        paymentDate,
        currency,
        amount: Number(amount),
        memo: memo || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not record payment.");
        return;
      }
      setAmount("");
      setMemo("");
      setOk("Payment recorded and allocated (oldest-due first).");
      router.refresh();
    });
  }

  if (parties.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        Add a billing party first — a payment must be tied to a customer or
        vendor.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="pay-party">
            Party
          </label>
          <select
            id="pay-party"
            className={FIELD}
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            required
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="pay-dir">
            Direction
          </label>
          <select
            id="pay-dir"
            className={FIELD}
            value={direction}
            onChange={(e) => setDirection(e.target.value as FinPaymentDirection)}
          >
            <option value="inbound">Inbound (from customer)</option>
            <option value="outbound">Outbound (to vendor)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={LABEL} htmlFor="pay-date">
            Date
          </label>
          <input
            id="pay-date"
            type="date"
            className={FIELD}
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="pay-amt">
            Amount
          </label>
          <input
            id="pay-amt"
            type="number"
            step="any"
            min="0"
            className={FIELD}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="pay-ccy">
            Currency
          </label>
          <input
            id="pay-ccy"
            className={FIELD}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            required
          />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="pay-memo">
          Memo (optional)
        </label>
        <input
          id="pay-memo"
          className={FIELD}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Wire ref, check #, …"
        />
      </div>

      <div>
        <button type="submit" className={BTN} disabled={pending}>
          {pending ? "Recording…" : "Record payment"}
        </button>
      </div>
      <FormError message={error} />
      <FormOk message={ok} />
    </form>
  );
}

// --- Aging summary -----------------------------------------------------------

const AGING_COLUMNS: { key: keyof ReturnType<typeof summarizeAging>; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
];

function AgingSummary({
  invoices,
  asOf,
  currency,
}: {
  invoices: InvoiceRow[];
  asOf: string;
  currency: string;
}) {
  const summary = useMemo(() => {
    const rows: AgingInput[] = invoices
      .filter(
        (i) =>
          i.kind === "receivable" &&
          (i.status === "open" || i.status === "partial"),
      )
      .map((i) => ({ dueDate: i.dueDate, outstanding: i.total - i.amountPaid }));
    return summarizeAging(rows, asOf);
  }, [invoices, asOf]);

  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        AR Aging · as of {fmtDate(asOf)}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {AGING_COLUMNS.map((c) => (
          <div key={c.key} className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {c.label}
            </p>
            <p className="mt-1 font-mono text-sm tabular-nums text-fg-primary">
              {fmtMoney(summary[c.key], currency)}
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-gold-500/30 bg-gold-500/8 px-3 py-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
            Total AR
          </p>
          <p className="mt-1 font-mono text-sm tabular-nums text-gold-200">
            {fmtMoney(summary.total, currency)}
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Invoice list ------------------------------------------------------------

function InvoiceList({
  invoices,
  asOf,
}: {
  invoices: InvoiceRow[];
  asOf: string;
}) {
  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No invoices yet
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Issue an invoice or bill to a billing party to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="hidden grid-cols-[1fr_90px_150px_130px_130px] items-center gap-4 border-b border-line bg-surface-2/30 px-4 py-2 sm:grid">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Invoice
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Status
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Total
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Outstanding
        </span>
        <span className="text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          Due / Aging
        </span>
      </div>
      <ul className="divide-y divide-line">
        {invoices.map((inv) => {
          const outstanding = inv.total - inv.amountPaid;
          return (
            <li
              key={inv.id}
              className="flex flex-col gap-2 px-4 py-3 transition hover:bg-surface-2/40 sm:grid sm:grid-cols-[1fr_90px_150px_130px_130px] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <KindBadge kind={inv.kind} />
                  <span className="truncate text-sm font-medium text-fg-primary">
                    {inv.invoiceNo}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-fg-muted">
                  {inv.partyName} · issued {fmtDate(inv.issueDate)}
                </p>
              </div>
              <div>
                <StatusBadge status={inv.status} />
              </div>
              <div className="text-left font-mono text-sm tabular-nums text-fg-secondary sm:text-right">
                {fmtMoney(inv.total, inv.currency)}
              </div>
              <div className="text-left font-mono text-sm tabular-nums text-fg-primary sm:text-right">
                {fmtMoney(outstanding, inv.currency)}
              </div>
              <div className="text-left sm:text-right">
                {inv.status === "paid" || inv.status === "void" ? (
                  <span className="font-mono text-[10px] text-fg-muted">
                    {fmtDate(inv.dueDate)}
                  </span>
                ) : (
                  <AgingBadge dueDate={inv.dueDate} asOf={asOf} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Board -------------------------------------------------------------------

export function InvoicesBoard({ entities, parties, invoices, asOf }: Props) {
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");

  const selectedEntity = entities.find((e) => e.id === entityId) ?? entities[0];
  const entityCurrency = selectedEntity?.baseCurrency ?? "USD";

  const entityParties = useMemo(
    () => parties.filter((p) => p.entityId === entityId && p.isActive),
    [parties, entityId],
  );
  const entityInvoices = useMemo(
    () => invoices.filter((i) => i.entityId === entityId),
    [invoices, entityId],
  );

  // No finance entity yet — the whole AR/AP model hangs off an entity, so guide
  // the operator to create one before any invoice/party/payment is possible.
  if (entities.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-secondary">
          Track receivables and payables natively — issue invoices, register
          customers and vendors, and record payments against a general ledger.
        </p>
        <Panel
          title="Get started"
          subtitle="Create a finance entity (the legal entity you invoice under) to begin."
        >
          <CreateEntityForm />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-xl text-sm text-fg-secondary">
          Track receivables and payables natively — issue invoices, register
          billing parties, and record payments allocated across open invoices.
        </p>
        {entities.length > 1 && (
          <div className="sm:w-56">
            <label className={LABEL} htmlFor="entity-select">
              Entity
            </label>
            <select
              id="entity-select"
              className={FIELD}
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {entities.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.name} ({en.baseCurrency})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <AgingSummary
        invoices={entityInvoices}
        asOf={asOf}
        currency={entityCurrency}
      />

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Invoices &amp; Bills
        </p>
        <InvoiceList invoices={entityInvoices} asOf={asOf} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Issue invoice" subtitle="Bill a customer (AR) or record a bill (AP).">
          <IssueInvoiceForm
            entityId={entityId}
            parties={entityParties}
            defaultCurrency={entityCurrency}
            asOf={asOf}
          />
        </Panel>
        <Panel title="Record payment" subtitle="Applied oldest-due first automatically.">
          <RecordPaymentForm
            entityId={entityId}
            parties={entityParties}
            defaultCurrency={entityCurrency}
            asOf={asOf}
          />
        </Panel>
        <Panel title="Add billing party" subtitle="Register a customer or vendor.">
          <CreatePartyForm entityId={entityId} />
        </Panel>
      </div>
    </div>
  );
}
