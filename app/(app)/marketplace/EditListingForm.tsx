"use client";

import { useState, useTransition } from "react";
import type { MarketplaceListing } from "@/lib/supabase/database.types";
import { LISTING_CURRENCIES } from "@/lib/marketplace/format";
import { updateListing } from "./actions";

const LISTING_TYPES = [
  { value: "deal", label: "Deal" },
  { value: "fund", label: "Fund" },
  { value: "co_invest", label: "Co-invest" },
  { value: "secondary", label: "Secondary" },
  { value: "service", label: "Service" },
];

export function EditListingForm({ listing }: { listing: MarketplaceListing }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const res = await updateListing(formData);
      if (res?.error) {
        setError(res.error);
      } else {
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          setOpen(false);
        }, 1800);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setError(null); setSaved(false); }}
        className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
      >
        Edit
      </button>

      {open ? (
        <form
          action={handleSubmit}
          className="mt-3 rounded-lg border border-gold-500/20 bg-surface-1 p-3"
        >
          <input type="hidden" name="id" value={listing.id} />

          <div className="flex flex-col gap-2.5">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Title
              </label>
              <input
                name="title"
                required
                defaultValue={listing.title}
                className="w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Summary
              </label>
              <textarea
                name="summary"
                rows={2}
                defaultValue={listing.summary ?? ""}
                className="w-full resize-none rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <span className="font-mono uppercase tracking-wider text-fg-muted">Type</span>
                <select
                  name="listing_type"
                  defaultValue={listing.listing_type}
                  className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
                >
                  {LISTING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <span className="font-mono uppercase tracking-wider text-fg-muted">Amount</span>
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={listing.amount ?? ""}
                  placeholder="0"
                  className="w-28 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Booking / calendar link
              </label>
              <input
                name="booking_url"
                type="url"
                inputMode="url"
                defaultValue={listing.booking_url ?? ""}
                placeholder="https://calendly.com/you/15min"
                className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
              <p className="text-[11px] leading-snug text-fg-muted">
                Buyers see a <span className="text-fg-secondary">Book a meeting</span> button. Leave
                blank to use your firm&rsquo;s connected Calendly.
              </p>
            </div>

            <details className="group">
              <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary transition select-none">
                <span className="group-open:hidden">▸ Deal details</span>
                <span className="hidden group-open:inline">▾ Deal details</span>
              </summary>
              <div className="mt-2.5 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Target IRR %</span>
                  <input
                    name="target_irr"
                    inputMode="decimal"
                    defaultValue={listing.target_irr ?? ""}
                    placeholder="22.5"
                    className="w-20 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Hold (yrs)</span>
                  <input
                    name="hold_period_years"
                    inputMode="decimal"
                    defaultValue={listing.hold_period_years ?? ""}
                    placeholder="5"
                    className="w-16 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Country</span>
                  <input
                    name="country"
                    defaultValue={listing.country ?? ""}
                    placeholder="United States"
                    className="w-36 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Currency</span>
                  <select
                    name="currency"
                    defaultValue={listing.currency ?? "USD"}
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
                    defaultValue={listing.ebitda ?? ""}
                    placeholder="3,200,000"
                    className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Gross rev.</span>
                  <input
                    name="gross_revenue"
                    inputMode="decimal"
                    defaultValue={listing.gross_revenue ?? ""}
                    placeholder="8,100,000"
                    className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Geography</span>
                  <input
                    name="geography"
                    defaultValue={listing.geography ?? ""}
                    placeholder="Southeast US"
                    className="w-36 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Asset class</span>
                  <input
                    name="asset_class"
                    defaultValue={listing.asset_class ?? ""}
                    placeholder="Multifamily"
                    className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-mono uppercase tracking-wider text-fg-muted">Teaser URL</span>
                  <input
                    name="teaser_url"
                    type="url"
                    defaultValue={listing.teaser_url ?? ""}
                    placeholder="https://…"
                    className="w-48 rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:bg-gold-500/5 hover:text-fg-primary">
                  <input
                    type="checkbox"
                    name="featured"
                    defaultChecked={listing.featured}
                    className="h-3.5 w-3.5 accent-gold-500"
                  />
                  <span>
                    Featured <span className="text-fg-muted">— surfaces first</span>
                  </span>
                </label>
              </div>
            </details>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-line px-3 py-1 text-xs text-fg-muted transition hover:text-fg-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-gold-500 px-3 py-1 text-xs font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
              >
                {pending ? "Saving…" : saved ? "Saved!" : "Save changes"}
              </button>
            </div>

            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
