"use client";

// Room switcher. A firm runs several rooms at once — a raise, a co-invest, a
// lender pack — each with its own contents and links, so picking one is the
// first thing this page asks. The choice rides in the URL (?room=) so a room is
// linkable and survives a refresh.
import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createRoom, renameRoom, archiveRoom } from "./room-actions";
import { ActionError, useActionError } from "./use-action-error";

export interface RoomOption {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
}

export function RoomSwitcher({ rooms, current }: { rooms: RoomOption[]; current: RoomOption }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mode, setMode] = useState<"none" | "new" | "edit">("none");
  const [pending, startTransition] = useTransition();
  const { error, run, clear } = useActionError();

  function select(id: string) {
    router.push(`${pathname}?room=${id}`);
  }

  return (
    <div className="mb-6 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => select(r.id)}
            aria-current={r.id === current.id}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition ${
              r.id === current.id
                ? "bg-gold-400 font-medium text-on-gold"
                : "border border-line text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {r.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            clear();
            setMode(mode === "new" ? "none" : "new");
          }}
          className="rounded-lg border border-dashed border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
        >
          + New room
        </button>
        <button
          type="button"
          onClick={() => {
            clear();
            setMode(mode === "edit" ? "none" : "edit");
          }}
          className="rounded-lg px-2 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
        >
          Settings
        </button>
      </div>

      {mode === "new" ? (
        <form
          // onSubmit, not action: a form action resets its inputs when it finishes,
          // success or not, which would discard the name after a failed create.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              if (await run(() => createRoom(fd), "Couldn't create the room. Try again.")) setMode("none");
            });
          }}
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1 p-3"
        >
          <input
            name="name"
            required
            placeholder="Room name (e.g. 'Fund III Raise')"
            className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <input
            name="description"
            placeholder="Who is this for? (optional)"
            className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create room"}
          </button>
        </form>
      ) : null}

      {mode === "edit" ? (
        <div className="mt-3 rounded-xl border border-line bg-surface-1 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(async () => {
                if (await run(() => renameRoom(fd), "Couldn't save the room. Try again.")) setMode("none");
              });
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="room_id" value={current.id} />
            <input
              name="name"
              required
              defaultValue={current.name}
              className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
            />
            <input
              name="description"
              defaultValue={current.description ?? ""}
              placeholder="Description (optional)"
              className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-secondary transition hover:text-fg-primary disabled:opacity-50"
            >
              Save
            </button>
          </form>

          {current.isDefault ? (
            <p className="mt-2 text-[11px] text-fg-muted">
              This is your default room — it can be renamed but not archived.
            </p>
          ) : (
            <form
              action={(fd) =>
                startTransition(async () => {
                  if (await run(() => archiveRoom(fd), "Couldn't archive the room. Its links may still be live. Try again.")) {
                    setMode("none");
                    router.push(pathname);
                  }
                })
              }
              onSubmit={(e) => {
                if (
                  !confirm(
                    `Archive "${current.name}"? Its live links stop working immediately. The documents stay in your library.`,
                  )
                )
                  e.preventDefault();
              }}
              className="mt-2"
            >
              <input type="hidden" name="room_id" value={current.id} />
              <button
                type="submit"
                className="rounded-md border border-status-danger/40 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/10"
              >
                Archive room
              </button>
            </form>
          )}
        </div>
      ) : null}

      <ActionError message={error} className="mt-2" />
    </div>
  );
}
