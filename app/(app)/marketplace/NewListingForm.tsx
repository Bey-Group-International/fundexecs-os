"use client";

import { useRef, useState, useTransition } from "react";
import type { ReputationTier } from "@/lib/compounding";
import { tierLabel } from "@/components/TierBadge";
import { createListing } from "./actions";

const LISTING_TYPES = [
  { value: "deal", label: "Deal" },
  { value: "fund", label: "Fund" },
  { value: "co_invest", label: "Co-invest" },
  { value: "secondary", label: "Secondary" },
  { value: "service", label: "Service" },
];

// The create-listing form. Client-side so validation surfaces inline and the
// form resets on success without a full reload. Linking a deal lets the matching
// engine score listings on geography too, not just amount + type.
// `requiredStake` and `tier` are resolved server-side by the parent (page.tsx)
// and passed in — this client component never fetches.
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
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const res = await createListing(formData);
          if (res?.error) setError(res.error);
          else formRef.current?.reset();
        })
      }
      className="fx-card animate-fade-up p-4"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
        New listing
      </p>

      <div className="flex flex-col gap-3">
        <input
          name="title"
          placeholder="Title — e.g. Series B secondary, $4M allocation"
          className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
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

          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input type="checkbox" name="is_public" className="h-3.5 w-3.5 accent-gold-500" />
            Public
          </label>

          <button
            type="submit"
            disabled={pending}
            className="ml-auto rounded-md bg-gold-500 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Create listing"}
          </button>
        </div>

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
