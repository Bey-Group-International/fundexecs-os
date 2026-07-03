"use client";

import { useRef, useState } from "react";
import { modelTransfer, priceFromNav } from "@/lib/secondaries";
import { usd } from "@/lib/format";
import { recordSecondaryTransfer } from "@/components/execute/actions";

export interface SellerPosition {
  commitmentId: string;
  investorId: string;
  investorName: string;
  fundName: string;
  committed: number;
  called: number;
  distributed: number;
  navShare: number;
}
export interface BuyerOption {
  investorId: string;
  name: string;
}

// Execute › Cap Table: the LP secondary. The operator picks a seller's position
// and a buyer, the fraction transferred, and a price as a % of NAV; the transfer
// — amounts changing hands and the premium/discount to NAV — previews live;
// confirming splits the two commitment rows. A change of ownership is Tier 3 —
// this confirm IS the operator sign-off.
export default function SecondaryTransferForm({
  positions,
  buyers,
}: {
  positions: SellerPosition[];
  buyers: BuyerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [commitmentId, setCommitmentId] = useState(positions[0]?.commitmentId ?? "");
  const [buyerId, setBuyerId] = useState("");
  const [pct, setPct] = useState(100); // fraction of the position, percent
  const [pricePct, setPricePct] = useState(100); // price as % of transferred NAV
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (positions.length === 0 || buyers.length < 1) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
      >
        ⇄ Record secondary transfer
      </button>
    );
  }

  const pos = positions.find((p) => p.commitmentId === commitmentId) ?? positions[0];
  const eligibleBuyers = buyers.filter((b) => b.investorId !== pos.investorId);
  const fraction = Math.min(Math.max(pct, 0), 100) / 100;
  const navShareTransferred = Math.max(0, pos.navShare) * fraction;
  const price = priceFromNav(navShareTransferred, pricePct);
  const t = modelTransfer(
    { committed: pos.committed, called: pos.called, distributed: pos.distributed },
    pos.navShare,
    fraction,
    price,
  );
  const buyerValid = !!buyerId && eligibleBuyers.some((b) => b.investorId === buyerId);

  return (
    <form
      ref={formRef}
      action={async (fd: FormData) => {
        setPending(true);
        setError(null);
        const result = await recordSecondaryTransfer(fd);
        setPending(false);
        if (!result.ok) {
          setError(result.error ?? "Could not book the transfer.");
          return;
        }
        formRef.current?.reset();
        setOpen(false);
        setPct(100);
        setPricePct(100);
        setBuyerId("");
      }}
      className="mb-4 flex flex-col gap-4 rounded-xl border border-gold-500/30 bg-surface-1 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Secondary transfer</span>
        <span className="rounded-full border border-status-danger/40 bg-status-danger/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger">
          Tier 3 · operator sign-off
        </span>
      </div>

      <input type="hidden" name="seller_commitment_id" value={commitmentId} />
      <input type="hidden" name="buyer_investor_id" value={buyerId} />
      <input type="hidden" name="fraction" value={fraction || ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Seller position</span>
          <select
            value={commitmentId}
            onChange={(e) => setCommitmentId(e.target.value)}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            {positions.map((p) => (
              <option key={p.commitmentId} value={p.commitmentId}>
                {p.investorName} · {p.fundName} ({usd(p.committed)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Buyer</span>
          <select
            value={buyerId}
            onChange={(e) => setBuyerId(e.target.value)}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            <option value="">Select a buyer…</option>
            {eligibleBuyers.map((b) => (
              <option key={b.investorId} value={b.investorId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Fraction transferred (%)</span>
          <input
            type="number"
            min={1}
            max={100}
            step="any"
            value={pct || ""}
            onChange={(e) => setPct(Number(e.target.value))}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Price (% of NAV share)</span>
          <input
            type="number"
            step="any"
            value={pricePct || ""}
            onChange={(e) => setPricePct(Number(e.target.value))}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
      </div>

      {/* Live transfer preview */}
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between bg-surface-2/80 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          <span>Transfer preview</span>
          <span>
            {t.premiumDiscountPct == null
              ? "—"
              : `${t.premiumDiscountPct >= 0 ? "+" : "−"}${Math.abs(t.premiumDiscountPct)}% vs NAV`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 bg-surface-1 px-4 py-3 text-sm sm:grid-cols-3">
          <PreviewRow label="Committed" value={usd(t.committed)} />
          <PreviewRow label="Called" value={usd(t.called)} />
          <PreviewRow label="Distributed" value={usd(t.distributed)} />
          <PreviewRow label="Unfunded" value={usd(t.unfunded)} />
          <PreviewRow label="NAV share" value={usd(t.navShareTransferred)} />
          <PreviewRow label="Price" value={usd(t.price)} />
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/5 px-4 py-2.5 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !(buyerValid && fraction > 0 && t.committed > 0)}
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Booking…" : "Confirm & book transfer"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</span>
      <span className="font-mono text-fg-primary">{value}</span>
    </div>
  );
}
