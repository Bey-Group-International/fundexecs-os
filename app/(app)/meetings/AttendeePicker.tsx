"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  avatarColorFor,
  initialsFor,
  inviteRowFor,
  isEmail,
  rankSuggestions,
  toAttendee,
  type PersonSuggestion,
  type SelectedAttendee,
} from "@/lib/meetings/people";

/**
 * One box for everyone coming to a meeting.
 *
 * It replaces two free-text areas ("Internal attendees" / "External guests")
 * whose contents were only resolved into addresses on save, by an exact and
 * unique-or-nothing match against the member directory. Two colleagues called
 * Jane Doe resolved to neither of them, nobody was emailed, and the host found
 * out from a line of text under a meeting that had already gone out. Choosing a
 * person instead of describing one moves that resolution to the moment of
 * entry, where two Jane Does are simply two rows with two addresses.
 *
 * Internal vs external is inferred from which directory someone came from, so
 * the member never has to answer a question the app can answer itself.
 */
export function AttendeePicker({
  value,
  onChange,
  label = "Guests",
}: {
  value: SelectedAttendee[];
  onChange: (next: SelectedAttendee[]) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId("attendee-listbox");

  const selectedEmails = useMemo(() => value.map((a) => a.email), [value]);

  // Fetch on a debounce. The directory is org-scoped and a few hundred rows, so
  // the whole set is fetched and ranked client-side — which also means typing
  // stays responsive between fetches instead of waiting on a round trip per key.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/meetings/people?q=${encodeURIComponent(query)}&exclude=${encodeURIComponent(selectedEmails.join(","))}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("lookup failed");
        const json = (await res.json()) as { results?: PersonSuggestion[] };
        if (!cancelled) setPeople(json.results ?? []);
      } catch {
        // A directory that cannot be reached must not block the box: an address
        // typed in full still works, and that is the path that always works.
        if (!cancelled) setPeople([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedEmails]);

  // Re-ranked locally against the current query so the list narrows on every
  // keystroke rather than only when the debounced fetch lands.
  const suggestions = useMemo(() => {
    const ranked = rankSuggestions(people, query, selectedEmails);
    const invite = inviteRowFor(query, selectedEmails);
    // Only offer "invite this address" when it isn't already a real row —
    // otherwise a known contact appears twice, once anonymously.
    return invite && !ranked.some((r) => r.email === invite.email) ? [...ranked, invite] : ranked;
  }, [people, query, selectedEmails]);

  // Reset the highlight when the query changes, and keep it inside the list when
  // a debounced fetch lands and shortens it — otherwise arrowing down and then
  // typing leaves the highlight pointing past the end, and Enter adds nothing.
  //
  // Adjusted during render rather than in an effect: this is derived state, and
  // an effect would commit one render with a stale highlight before correcting
  // it — visible as a flicker on the wrong row, and an extra pass every keystroke.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActive(0);
  } else if (active >= suggestions.length && suggestions.length > 0) {
    setActive(suggestions.length - 1);
  }

  const add = useCallback(
    (person: PersonSuggestion) => {
      if (!value.some((a) => a.email === person.email)) onChange([...value, toAttendee(person)]);
      setQuery("");
      setOpen(false);
      inputRef.current?.focus();
    },
    [value, onChange],
  );

  const removeAt = useCallback(
    (index: number) => onChange(value.filter((_, i) => i !== index)),
    [value, onChange],
  );

  // Close on an outside click. Blur alone would fire before a click on a row
  // registers, which is the classic way a typeahead becomes unclickable.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !query && value.length > 0) {
      // Backspace on an empty box removes the last chip — the behaviour every
      // token field has, and the only way to undo without reaching for a mouse.
      removeAt(value.length - 1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (suggestions.length === 0) return;
      setActive((i) => (e.key === "ArrowDown"
        ? (i + 1) % suggestions.length
        : (i - 1 + suggestions.length) % suggestions.length));
      return;
    }
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      const choice = open ? suggestions[active] : undefined;
      if (choice) {
        // Tab still moves on when there is nothing highlighted; it only commits
        // a choice the member can actually see.
        e.preventDefault();
        add(choice);
        return;
      }
      // Enter on a complete address adds it even with the list closed, so
      // pasting a list of addresses never requires touching the dropdown.
      if (e.key !== "Tab" && isEmail(query)) {
        e.preventDefault();
        const invite = inviteRowFor(query, selectedEmails);
        if (invite) add(invite);
      }
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  // A name with no address cannot become a guest — say why, rather than
  // dropping it silently on save the way the old boxes did.
  const bareName = query.trim().length > 0 && !isEmail(query) && suggestions.length === 0;

  return (
    <div className="flex flex-col gap-1" ref={boxRef}>
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>

      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-0 px-2 py-1.5 transition-colors focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-400/30"
      >
        {value.map((attendee, i) => (
          <Chip key={attendee.email} attendee={attendee} onRemove={() => removeAt(i)} />
        ))}

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? "Add people by name or email" : ""}
          className="min-w-[10rem] flex-1 bg-transparent py-0.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
        />
      </div>

      {open && (suggestions.length > 0 || loading) ? (
        <div className="relative">
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface-1 py-1 shadow-[0_18px_40px_-20px_rgb(15_23_42/0.45)]"
          >
            {suggestions.map((person, i) => {
              const isInvite = !people.some((p) => p.email === person.email);
              return (
                <li key={person.email} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => add(person)}
                    className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
                      i === active ? "bg-surface-2" : ""
                    }`}
                  >
                    <Avatar person={person} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg-primary">
                        {isInvite ? `Invite ${person.email}` : person.name}
                      </span>
                      {!isInvite ? (
                        <span className="block truncate text-[11px] text-fg-muted">
                          {[person.email, person.subtitle].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-muted">
                      {person.source === "member" ? "Team" : isInvite ? "New" : person.source === "past" ? "Recent" : "Contact"}
                    </span>
                  </button>
                </li>
              );
            })}
            {loading && suggestions.length === 0 ? (
              <li className="px-3 py-2 text-xs text-fg-muted">Searching…</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <span className="text-[11px] leading-snug text-fg-muted">
        {bareName
          ? `No match for “${query.trim()}”. Enter an email address — a guest without one can't be invited.`
          : "Guests are invited by email on save. Teammates skip the waiting room."}
      </span>
    </div>
  );
}

function Chip({ attendee, onRemove }: { attendee: SelectedAttendee; onRemove: () => void }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-1 py-0.5 pl-0.5 pr-1.5 text-xs"
      title={attendee.email}
    >
      <Avatar person={attendee} size={20} />
      <span className="truncate text-fg-primary">{attendee.name}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`Remove ${attendee.name}`}
        className="fx-focus shrink-0 rounded-full px-0.5 leading-none text-fg-muted transition-colors hover:text-[var(--status-danger)]"
      >
        ×
      </button>
    </span>
  );
}

/**
 * The disc. A photo when the directory has one, otherwise initials on a colour
 * derived from the address — so the same person is the same colour everywhere,
 * every time, which is the only reason a colour is worth anything here.
 */
function Avatar({
  person,
  size = 24,
}: {
  person: { name?: string | null; email: string; avatarUrl?: string };
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: size <= 20 ? 9 : 10 };
  if (person.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external avatar host; next/image would need every one allow-listed
      <img
        src={person.avatarUrl}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, backgroundColor: avatarColorFor(person.email) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide text-white"
    >
      {initialsFor(person)}
    </span>
  );
}

/** Stable per-instance id, so two pickers on one page don't share a listbox id. */
let idSeq = 0;
function useId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${(idSeq += 1)}`);
  return id;
}
