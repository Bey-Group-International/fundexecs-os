import Link from "next/link";
import type { Session, SessionGroup } from "@/lib/supabase/database.types";
import {
  createSessionGroup,
  renameSession,
  moveSessionToGroup,
  setSessionArchived,
} from "@/app/(app)/sessions/actions";
import { DeleteSessionButton } from "./DeleteSessionButton";

// Sessions on the Command Center: the operator's operations, named and filed
// into groups. Server-rendered with inline forms posting to server actions.
// Sessions can be renamed, moved, archived (reversible) or deleted (permanent).
export function SessionsSection({
  sessions,
  groups,
}: {
  sessions: Session[];
  groups: SessionGroup[];
}) {
  // Archived sessions drop out of the working list into their own section so the
  // operator's active surface stays uncluttered.
  const active = sessions.filter((s) => !s.archived_at);
  const archived = sessions.filter((s) => s.archived_at);

  const byGroup = new Map<string, Session[]>();
  for (const s of active) {
    const k = s.group_id ?? "";
    const list = byGroup.get(k) ?? [];
    list.push(s);
    byGroup.set(k, list);
  }
  // Named groups first (in catalog order), then Ungrouped.
  const sections: { key: string; label: string }[] = [
    ...groups.filter((g) => byGroup.has(g.id)).map((g) => ({ key: g.id, label: g.name })),
    ...(byGroup.has("") ? [{ key: "", label: "Ungrouped" }] : []),
  ];

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
          <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
          Sessions
        </h2>
        <form action={createSessionGroup} className="flex items-center gap-1.5">
          <input
            name="name"
            placeholder="New group…"
            className="w-32 rounded-md border border-line bg-surface-0 px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
            Add group
          </button>
        </form>
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No sessions yet — click <span className="text-fg-secondary">Sessions</span> to start
          one in Earn. Workflows create sessions automatically when they run.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((sec) => (
            <div key={sec.key || "ungrouped"}>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-gold-400">
                {sec.label}
              </p>
              <div className="flex flex-col gap-1.5">
                {(byGroup.get(sec.key) ?? []).map((s) => (
                  <div
                    key={s.id}
                    className="fx-card flex flex-wrap items-center gap-2 px-3 py-2.5"
                  >
                    <span
                      className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                        s.origin === "workflow"
                          ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                          : "border-line text-fg-muted"
                      }`}
                    >
                      {s.origin === "workflow" ? "Workflow" : "Earn"}
                    </span>

                    <form action={renameSession} className="flex min-w-0 flex-1 items-center gap-1.5">
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        name="name"
                        defaultValue={s.name}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-fg-primary hover:border-line focus:border-gold-500/60 focus:outline-none"
                      />
                      <button
                        title="Rename"
                        className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-fg-muted transition hover:text-fg-primary"
                      >
                        Save
                      </button>
                    </form>

                    <form action={moveSessionToGroup} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <select
                        name="group_id"
                        defaultValue={s.group_id ?? ""}
                        className="rounded-md border border-line bg-surface-0 px-1.5 py-1 text-xs text-fg-secondary focus:border-gold-500/60 focus:outline-none"
                      >
                        <option value="">Ungrouped</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-md border border-line px-1.5 py-1 text-[10px] text-fg-muted transition hover:text-fg-primary">
                        Move
                      </button>
                    </form>

                    <Link
                      href={`/session/${s.id}`}
                      className="rounded-md bg-gold-500 px-2.5 py-1 text-xs font-medium text-surface-0 transition hover:bg-gold-400"
                    >
                      Open
                    </Link>

                    <form action={setSessionArchived}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="archived" value="true" />
                      <button
                        title="Archive session"
                        className="rounded-md border border-line px-1.5 py-1 text-[10px] text-fg-muted transition hover:text-fg-primary"
                      >
                        Archive
                      </button>
                    </form>

                    <DeleteSessionButton id={s.id} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {active.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface-1 p-5 text-center text-sm text-fg-muted">
              No active sessions — everything below is archived.
            </p>
          ) : null}
        </div>
      )}

      {/* Archived sessions — out of the way, but unarchive or delete from here. */}
      {archived.length > 0 ? (
        <div className="mt-5">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Archived · {archived.length}
          </p>
          <div className="flex flex-col gap-1.5">
            {archived.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-surface-1/40 px-3 py-2 opacity-80"
              >
                <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  Archived
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">{s.name}</span>

                <Link
                  href={`/session/${s.id}`}
                  className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                >
                  Open
                </Link>

                <form action={setSessionArchived}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="archived" value="false" />
                  <button
                    title="Restore session"
                    className="rounded-md border border-line px-1.5 py-1 text-[10px] text-gold-300 transition hover:border-gold-500/50 hover:text-gold-200"
                  >
                    Unarchive
                  </button>
                </form>

                <DeleteSessionButton id={s.id} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
