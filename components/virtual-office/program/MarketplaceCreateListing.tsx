"use client";

import { useState } from "react";

const TEAL = "#2dd4bf";

const LISTING_TYPES = [
  { value: "deal", label: "Deal" },
  { value: "fund", label: "Fund" },
  { value: "co_invest", label: "Co-invest" },
  { value: "secondary", label: "Secondary" },
  { value: "service", label: "Service" },
];

const inputCls =
  "w-full rounded-md border px-2.5 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-600 focus:outline-none";
const inputStyle = { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" } as const;

/**
 * In-world "list something" overlay. Opened from the Marketplace panel's + New,
 * it publishes a listing through the office's own API (a thin wrapper over the
 * marketplace createListing action) so the operator never leaves the floor. New
 * listings default to draft/private, exactly like the full-page form; ticking
 * "List publicly" flips both so it shows up on the floor immediately.
 */
export function MarketplaceCreateListing({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called after a successful create so the hall can refresh its listings. */
  onCreated: () => void;
}) {
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const [error, setError] = useState<string>("");
  const [showDetails, setShowDetails] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "pending") return;
    const fd = new FormData(e.currentTarget);
    const title = String(fd.get("title") ?? "").trim();
    if (!title) {
      setState("error");
      setError("Title is required.");
      return;
    }
    const publicNow = fd.get("is_public") === "on";
    setState("pending");
    setError("");
    try {
      const res = await fetch("/api/marketplace/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          listing_type: fd.get("listing_type"),
          summary: fd.get("summary"),
          amount: fd.get("amount"),
          // Publishing publicly implies it should be visible ("listed"), not draft.
          status: publicNow ? "listed" : "draft",
          is_public: publicNow,
          target_irr: fd.get("target_irr"),
          hold_period_years: fd.get("hold_period_years"),
          geography: fd.get("geography"),
          asset_class: fd.get("asset_class"),
          teaser_url: fd.get("teaser_url"),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState("error");
        setError(json.error ?? "Couldn't create the listing.");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setState("error");
      setError("Network error — try again.");
    }
  };

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: "rgba(4,6,10,0.55)" }}
      onClick={onClose}
      role="presentation"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[92%] w-full max-w-[380px] flex-col overflow-hidden rounded-xl border backdrop-blur-sm"
        style={{ borderColor: "rgba(45,212,191,0.35)", background: "rgba(10,8,6,0.97)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="List something"
      >
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${TEAL}, transparent)` }} />

        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "rgba(45,212,191,0.18)" }}>
          <div>
            <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: TEAL, fontFamily: "Georgia, serif" }}>
              List something
            </span>
            <p className="mt-0.5 text-[10px] text-slate-500">Publish to the exchange floor without leaving the office.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-[13px] leading-none text-slate-400 transition-colors hover:text-slate-100"
            style={{ border: "1px solid rgba(45,212,191,0.25)" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          <input
            name="title"
            autoFocus
            placeholder="Title — e.g. Series B secondary, $4M allocation"
            className={inputCls}
            style={inputStyle}
          />
          <textarea
            name="summary"
            rows={2}
            placeholder="Short summary buyers will see (optional)"
            className={`${inputCls} resize-none`}
            style={inputStyle}
          />
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Type</span>
              <select name="listing_type" defaultValue="deal" className={inputCls} style={inputStyle}>
                {LISTING_TYPES.map((t) => (
                  <option key={t.value} value={t.value} style={{ background: "#0a0806" }}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Amount (USD)</span>
              <input name="amount" inputMode="decimal" placeholder="0" className={inputCls} style={inputStyle} />
            </label>
          </div>

          {/* Optional deal details */}
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-[9px] uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
          >
            {showDetails ? "▾ Deal details" : "▸ Add deal details (optional)"}
          </button>
          {showDetails && (
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Target IRR %</span>
                <input name="target_irr" inputMode="decimal" placeholder="22.5" className={inputCls} style={inputStyle} />
              </label>
              <label>
                <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Hold (yrs)</span>
                <input name="hold_period_years" inputMode="decimal" placeholder="5" className={inputCls} style={inputStyle} />
              </label>
              <label>
                <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Geography</span>
                <input name="geography" placeholder="Southeast US" className={inputCls} style={inputStyle} />
              </label>
              <label>
                <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Asset class</span>
                <input name="asset_class" placeholder="Multifamily" className={inputCls} style={inputStyle} />
              </label>
              <label className="col-span-2">
                <span className="mb-0.5 block text-[8px] uppercase tracking-[0.16em] text-slate-500">Teaser URL</span>
                <input name="teaser_url" type="url" placeholder="https://…" className={inputCls} style={inputStyle} />
              </label>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] text-slate-300" style={inputStyle}>
            <input type="checkbox" name="is_public" className="h-3.5 w-3.5" style={{ accentColor: TEAL }} />
            <span>
              List publicly now <span className="text-slate-500">— else saved as a private draft</span>
            </span>
          </label>

          {state === "error" && <p className="text-[10px]" style={{ color: "#ef4444" }}>{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 border-t px-4 py-3" style={{ borderColor: "rgba(45,212,191,0.18)" }}>
          <button
            type="submit"
            disabled={state === "pending"}
            className="flex-1 rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-50"
            style={{ background: TEAL, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            {state === "pending" ? "Publishing…" : "Publish listing"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-slate-300 transition-colors hover:text-slate-100"
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
