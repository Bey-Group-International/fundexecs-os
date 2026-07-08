"use client";

import { useRef, useState, useTransition } from "react";
import type { ReputationTier } from "@/lib/compounding";
import { tierLabel } from "@/components/TierBadge";
import { LISTING_CURRENCIES } from "@/lib/marketplace/format";
import { createListing } from "./actions";

const LISTING_TYPES = [
  { value: "deal", label: "Deal" },
  { value: "fund", label: "Fund" },
  { value: "co_invest", label: "Co-invest" },
  { value: "secondary", label: "Secondary" },
  { value: "service", label: "Service" },
];

export function NewListingForm({
  deals = [],
  requiredStake,
  tier,
}: {
  deals?: { id: string; name: string }[];
  requiredStake?: number;
  tier?: ReputationTier;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function handleSubmit(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setTitleError(false);
    startTransition(async () => {
      setError(null);
      setSuccess(false);
      const res = await createListing(formData);
      if (res?.error) {
        setError(res.error);
      } else {
        formRef.current?.reset();
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3500);
      }
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="fx-card animate-fade-up p-4"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
        New listing
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <input
            ref={titleRef}
            name="title"
            required
            placeholder="Title — e.g. Series B secondary, $4M allocation"
            onChange={() => titleError && setTitleError(false)}
            className={`rounded-md border bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none ${
              titleError
                ? "border-red-500/60 focus:border-red-500"
                : "border-line focus:border-gold-500/60"
            }`}
          />
          {titleError ? (
            <p className="text-[11px] text-red-400">Title is required.</p>
          ) : null}
        </div>

        <textarea
          name="summary"
          rows={2}
          placeholder="Short summary buyers will see (optional)"
          className="resize-none rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <span className="font-mono uppercase tracking-wider text-fg-muted">Type</span>
            <select
              name="listing_type"
              defaultValue="deal"
              className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
            >
              {LISTING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <span className="font-mono uppercase tracking-wider text-fg-muted">Amount</span>
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0"
              className="w-28 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <span className="font-mono uppercase tracking-wider text-fg-muted">Status</span>
            <select
              name="status"
              defaultValue="draft"
              className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
            >
              <option value="draft">Draft</option>
              <option value="listed">Listed</option>
            </select>
          </label>

          {deals.length ? (
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Deal</span>
              <select
                name="deal_id"
                defaultValue=""
                className="max-w-[160px] rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
              >
                <option value="">None</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:bg-gold-500/5 hover:text-fg-primary">
            <input type="checkbox" name="is_public" className="h-3.5 w-3.5 accent-gold-500" />
            <span>
              Public{" "}
              <span className="text-fg-muted">— visible on Browse</span>
            </span>
          </label>
        </div>

        {/* Booking / calendar link — buyers can book a meeting with the seller. */}
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Booking / calendar link
          </label>
          <input
            name="booking_url"
            type="url"
            inputMode="url"
            placeholder="https://calendly.com/you/15min"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <p className="text-[11px] leading-snug text-fg-muted">
            Any scheduling link (Calendly, Cal.com, Google…). Buyers see a{" "}
            <span className="text-fg-secondary">Book a meeting</span> button. Leave blank to use your
            firm&rsquo;s connected Calendly.
          </p>
        </div>

        {/* Deal card fields */}
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary transition select-none">
            <span className="group-open:hidden">▸ Add deal details (optional)</span>
            <span className="hidden group-open:inline">▾ Deal details</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Target IRR %</span>
              <input
                name="target_irr"
                inputMode="decimal"
                placeholder="22.5"
                className="w-20 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Hold (yrs)</span>
              <input
                name="hold_period_years"
                inputMode="decimal"
                placeholder="5"
                className="w-16 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Country</span>
              <input
                name="country"
                placeholder="United States"
                className="w-36 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Currency</span>
              <select
                name="currency"
                defaultValue="USD"
                className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
              >
                {LISTING_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">EBITDA</span>
              <input
                name="ebitda"
                inputMode="decimal"
                placeholder="3,200,000"
                className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Gross rev.</span>
              <input
                name="gross_revenue"
                inputMode="decimal"
                placeholder="8,100,000"
                className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Geography</span>
              <input
                name="geography"
                placeholder="Southeast US"
                className="w-36 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Asset class</span>
              <input
                name="asset_class"
                placeholder="Multifamily"
                className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <span className="font-mono uppercase tracking-wider text-fg-muted">Teaser URL</span>
              <input
                name="teaser_url"
                type="url"
                placeholder="https://…"
                className="w-48 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:bg-gold-500/5 hover:text-fg-primary">
              <input type="checkbox" name="featured" className="h-3.5 w-3.5 accent-gold-500" />
              <span>
                Featured <span className="text-fg-muted">— surfaces first</span>
              </span>
            </label>
          </div>
        </details>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold-500 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Create listing"}
          </button>
        </div>

        {success ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
            Listing created — it&rsquo;s in draft. Mark it <strong>Listed</strong> and <strong>Public</strong> when you&rsquo;re ready for buyers.
          </p>
        ) : null}

        {error ? <p className="text-xs text-red-400">{error}</p> : null}

        {requiredStake != null ? (
          <p className="rounded-lg border border-neural-400/20 bg-black/30 px-3 py-2 text-[11px] leading-snug text-fg-secondary">
            Listing locks a refundable{" "}
            <span className="font-mono text-neural-300">{requiredStake.toLocaleString()}</span>
            -credit stake, returned when the listing closes in good faith.{" "}
            {tier && tier !== "unranked"
              ? `Your ${tierLabel(tier)} standing reduces it.`
              : "Your tier reduces it."}
          </p>
        ) : null}

        <p className="text-[11px] leading-snug text-fg-muted">
          Listings start <span className="text-fg-secondary">private</span> and in{" "}
          <span className="text-fg-secondary">draft</span> by default. Mark a listing public and move
          it to <span className="text-fg-secondary">listed</span> when it&rsquo;s ready for buyers.
        </p>
      </div>
    </form>
  );
}
