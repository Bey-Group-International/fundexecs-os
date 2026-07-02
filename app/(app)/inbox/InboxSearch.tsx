"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INBOX_CHANNELS } from "@/lib/inbox/channels";

// Server-driven search + filter bar for the communications inbox. Writes q /
// channel / unread into the URL so the RSC page re-queries in the database
// (getInboxThreads) — search therefore scales past the 100-row page rather than
// filtering only what's already loaded. The pillar chips in InboxBoard stay a
// separate, instant client-side facet.
const CHANNEL_OPTIONS = Object.values(INBOX_CHANNELS)
  .filter((c) => c.channel !== "deal_share")
  .map((c) => ({ value: c.channel, label: c.label }));

export function InboxSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push a changed param set to the URL, preserving the others. Empty values are
  // removed so the URL stays clean and filters clear cleanly.
  function apply(next: { q?: string; channel?: string; unread?: string }) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    const query = sp.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  // Debounce free-text so we don't push a navigation on every keystroke.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q }), 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // apply/params/pathname are stable enough for this debounced push; q drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const channel = params.get("channel") ?? "";
  const unread = params.get("unread") === "1";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search subject or counterparty…"
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
      />
      <select
        value={channel}
        onChange={(e) => apply({ channel: e.target.value })}
        className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-fg-secondary outline-none focus:border-gold-500"
      >
        <option value="">All channels</option>
        {CHANNEL_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => apply({ unread: unread ? "" : "1" })}
        className={`rounded-full border px-3 py-1.5 text-xs transition ${
          unread
            ? "border-gold-500 bg-gold-500/10 text-gold-300"
            : "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
        }`}
      >
        Unread only
      </button>
    </div>
  );
}
