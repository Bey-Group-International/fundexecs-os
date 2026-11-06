"use client";

// Organising a recorded call — tags, who was on it, the deal — and the bulk
// bar for doing the same to several at once.

import { useEffect, useState } from "react";
import { cleanCallPeople, cleanCallTags } from "@/lib/meetings/call-organise";

export interface DealOption {
  id: string;
  name: string;
}

let dealsCache: Promise<DealOption[]> | null = null;

/** The organisation's deals, read once per page and shared by every form. */
export function useDeals(enabled: boolean): DealOption[] | null {
  const [deals, setDeals] = useState<DealOption[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    dealsCache ??= fetch("/api/meetings/calls/deals")
      .then((r) => (r.ok ? r.json() : { deals: [] }))
      .then((b: { deals?: DealOption[] }) => (Array.isArray(b.deals) ? b.deals : []))
      .catch(() => []);
    let live = true;
    void dealsCache.then((d) => {
      if (live) setDeals(d);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return deals;
}

/** For tests: forget the cached deals. */
export function resetDealsCache() {
  dealsCache = null;
}

export interface OrganisePatch {
  tags: string[];
  people: string[];
  dealId: string | null;
}

/** The inline editor under a call: tags, people, deal. */
export function OrganiseForm({
  title,
  tags,
  people,
  dealId,
  onSave,
  onCancel,
}: {
  title: string;
  tags: string[];
  people: string[];
  dealId: string | null;
  onSave: (patch: OrganisePatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [tagText, setTagText] = useState(tags.join(", "));
  const [peopleText, setPeopleText] = useState(people.join(", "));
  const [deal, setDeal] = useState(dealId ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const deals = useDeals(true);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFailed(false);
    const ok = await onSave({ tags: cleanCallTags(tagText), people: cleanCallPeople(peopleText), dealId: deal || null });
    setSaving(false);
    if (!ok) setFailed(true);
  };

  const field =
    "min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 text-base text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none sm:min-h-9 sm:text-sm";

  return (
    <form onSubmit={save} aria-label={`Organise ${title}`} className="flex flex-col gap-2 border-t border-[var(--line)] px-4 py-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--fg-muted)]">
        Tags
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="LP, diligence" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--fg-muted)]">
        Who was on the call
        <input value={peopleText} onChange={(e) => setPeopleText(e.target.value)} placeholder="Ana Ruiz, Bo Chen" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--fg-muted)]">
        Deal
        <select value={deal} onChange={(e) => setDeal(e.target.value)} className={field} disabled={deals === null}>
          <option value="">{deals === null ? "Loading deals…" : "No deal"}</option>
          {(deals ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-gold-400 px-3 text-xs font-semibold text-on-gold disabled:opacity-50 sm:min-h-9">
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 rounded-lg bg-[var(--surface-2)] px-3 text-xs font-medium text-[var(--fg-secondary)] hover:bg-[var(--surface-3)] sm:min-h-9"
        >
          Cancel
        </button>
        {failed ? (
          <span role="alert" className="text-xs text-[var(--status-danger)]">
            That couldn&rsquo;t be saved. Try again.
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** What to do with the calls ticked. */
export function BulkBar({
  count,
  busy,
  onTag,
  onDelete,
  onClear,
}: {
  count: number;
  busy: boolean;
  onTag: (tag: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [tag, setTag] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <div role="region" aria-label="Selected calls" className="sticky top-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--gold-400)]/40 bg-[var(--surface-1)] px-3 py-2 text-xs shadow-sm">
      <span className="font-medium text-[var(--fg-primary)]">{count} selected</span>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const clean = cleanCallTags(tag)[0];
          if (clean) {
            onTag(clean);
            setTag("");
          }
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Add a tag"
          aria-label="Tag to add to the selected calls"
          className="min-h-9 w-32 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2 text-xs text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none"
        />
        <button type="submit" disabled={busy || !tag.trim()} className="min-h-9 rounded-lg bg-[var(--surface-2)] px-3 font-medium text-[var(--fg-secondary)] disabled:opacity-50">
          Tag
        </button>
      </form>
      {confirming ? (
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--fg-muted)]">Delete {count} call{count === 1 ? "" : "s"} and recordings?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
            className="min-h-9 rounded-lg bg-status-danger/15 px-3 font-medium text-[var(--status-danger)] disabled:opacity-50"
          >
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="min-h-9 px-2 text-[var(--fg-muted)]">
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-9 rounded-lg px-3 font-medium text-[var(--status-danger)] disabled:opacity-50">
          Delete
        </button>
      )}
      <button type="button" onClick={onClear} className="ml-auto min-h-9 px-2 text-[var(--fg-muted)] hover:text-[var(--fg-primary)]">
        Done
      </button>
    </div>
  );
}
