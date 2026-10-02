"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// "Link to contact" on an open inbox thread.
//
// The inbox puts a conversation on a contact's record by itself only when the
// counterparty's address is EXACTLY the contact's (lib/inbox/crm-activity).
// That rule is strict on purpose, so a thread from somebody's second address or
// a shared mailbox never reaches their record on its own. This is how a person
// closes that gap: search the CRM, pick the contact, and the thread lands on
// their timeline and in their communications report
// (POST /api/network/contacts/[id]/links).
//
// Nothing is fetched until somebody opens the control and types: the search is
// a database query (no model), but a closed control should cost nothing.

interface ContactHit {
  id: string;
  fullName: string;
  email: string | null;
  company: string | null;
}

type Status =
  | { kind: "idle" }
  | { kind: "linking" }
  | { kind: "linked"; contact: ContactHit }
  | { kind: "error"; message: string };

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export function LinkToContact({ threadId, counterparty }: { threadId: string; counterparty: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Only the newest search may write results: a slow early answer must not
  // replace the one for what the person has typed since.
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setHits([]);
      setSearching(false);
      return;
    }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/network/search?q=${encodeURIComponent(q)}&limit=8`);
        const body = (await res.json().catch(() => null)) as { results?: ContactHit[] } | null;
        if (ticket !== latest.current) return;
        setHits(
          (body?.results ?? []).map((r) => ({
            id: r.id,
            fullName: r.fullName,
            email: r.email ?? null,
            company: r.company ?? null,
          })),
        );
      } catch {
        if (ticket === latest.current) setHits([]);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  async function link(contact: ContactHit) {
    setStatus({ kind: "linking" });
    try {
      const res = await fetch(`/api/network/contacts/${encodeURIComponent(contact.id)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      // Already on their record is the outcome somebody wanted, so it reads as
      // done rather than as a failure.
      if (res.ok || res.status === 409) {
        setStatus({ kind: "linked", contact });
        setOpen(false);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus({ kind: "error", message: body?.error ?? "Couldn't link this conversation." });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server." });
    }
  }

  if (status.kind === "linked") {
    return (
      <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
        Linked to {status.contact.fullName || status.contact.email} ·{" "}
        <Link href={`/network/${status.contact.id}`} className="text-gold-300 hover:underline">
          Open record →
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Put this conversation on a contact's record — for when ${counterparty} wrote from an address the CRM doesn't hold`}
        className="rounded-md border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500 hover:text-fg-primary"
      >
        Link to contact
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-1 p-2">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search contacts by name, company or email…"
          aria-label="Search contacts"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-fg-muted hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
      {status.kind === "error" ? <p className="mt-1.5 text-xs text-rose-300">{status.message}</p> : null}
      {query.trim().length >= MIN_QUERY ? (
        searching && hits.length === 0 ? (
          <p className="mt-1.5 text-xs text-fg-muted">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="mt-1.5 text-xs text-fg-muted">No contacts match.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col" role="listbox" aria-label="Matching contacts">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={status.kind === "linking"}
                  onClick={() => link(h)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-primary transition hover:bg-surface-2 disabled:opacity-50"
                >
                  {h.fullName || h.email}
                  <span className="ml-2 text-xs text-fg-muted">
                    {[h.company, h.email].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
