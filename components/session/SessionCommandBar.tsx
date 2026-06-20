"use client";

import { useState } from "react";
import Link from "next/link";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";
import { formatCredits } from "@/lib/billing";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  renameSession,
  setSessionColor,
  setSessionArchived,
  deleteSession,
  createSessionShare,
} from "@/app/(app)/sessions/actions";

const HUB_ORDER: Hub[] = ["build", "run", "source", "execute"];
const COLORS = ["#f7c948", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#f87171", "#94a3b8"];

export interface BarTask {
  id: string;
  title: string;
  status: string;
}

// The session command surface: the top bar (name · notifications · share ·
// balance · profile · ⋮) plus the Session Actions drawer, which is the
// activation layer for Hub Modules — surfaced contextually inside the session.
export function SessionCommandBar({
  sessionId,
  name,
  color,
  balance,
  tasks,
}: {
  sessionId: string;
  name: string;
  color: string | null;
  balance: number;
  tasks: BarTask[];
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [share, setShare] = useState(false);
  const [notif, setNotif] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [hoverHub, setHoverHub] = useState<Hub | null>(null);
  const [selected, setSelected] = useState<BarTask | null>(null);

  const accent = color ?? "#f7c948";
  const active = tasks.filter((t) => t.status === "in_progress" || t.status === "pending").length;

  return (
    <div className="relative flex min-h-12 items-center gap-2 border-b border-line bg-surface-0/82 px-3 py-2 backdrop-blur-xl sm:h-12 sm:px-4">
      {/* Session name */}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      {renaming ? (
        <form
          action={renameSession}
          className="flex items-center gap-1"
          onSubmit={() => setRenaming(false)}
        >
          <input type="hidden" name="id" value={sessionId} />
          <input
            name="name"
            autoFocus
            defaultValue={name}
            className="rounded-md border border-line bg-surface-0 px-2 py-1 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
          />
          <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary">
            Save
          </button>
        </form>
      ) : (
        <button
          onClick={() => setRenaming(true)}
          title="Rename session"
          className="truncate text-sm font-medium text-fg-primary hover:text-gold-300"
        >
          {name}
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle compact />
        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setNotif((v) => !v)}
            title="Notifications"
            className="rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            💡
          </button>
          {notif ? (
            <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-line bg-surface-1 p-3 text-xs text-fg-muted shadow-xl">
              No new notifications.
            </div>
          ) : null}
        </div>

        {/* Share */}
        <div className="relative">
          <button
            onClick={() => setShare((v) => !v)}
            className="hidden rounded-md px-2 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary sm:inline-flex"
          >
            Share
          </button>
          {share ? (
            <div className="absolute right-0 top-9 z-50 w-60 rounded-lg border border-line bg-surface-1 p-2 shadow-xl">
              <form action={createSessionShare}>
                <input type="hidden" name="id" value={sessionId} />
                <input type="hidden" name="scope" value="org" />
                <button className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                  Share with your team
                </button>
              </form>
              <form action={createSessionShare}>
                <input type="hidden" name="id" value={sessionId} />
                <input type="hidden" name="scope" value="public" />
                <button className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                  Create read-only link
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {/* Balance → Wallet */}
        <Link
          href="/wallet"
          title="Credit balance — open wallet"
          className="hidden items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary sm:flex"
        >
          <span className="text-gold-400">◇</span>
          {formatCredits(balance)}
        </Link>

        {/* Profile → Settings */}
        <Link
          href="/settings"
          title="Settings"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
        >
          ⚙
        </Link>

        {/* Session Actions */}
        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            title="Session actions"
            className="rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            ⋮
          </button>
          {menu ? (
            <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-line bg-surface-1 p-1.5 shadow-2xl">
              {/* Background Tasks */}
              <button
                onClick={() => {
                  setTasksOpen(true);
                  setMenu(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
              >
                Background Tasks
                {active > 0 ? (
                  <span className="rounded-full bg-gold-500/15 px-1.5 py-0.5 font-mono text-[10px] text-gold-300">
                    {active}
                  </span>
                ) : null}
              </button>

              <div className="my-1 border-t border-line" />
              <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                Hub Modules
              </p>
              {HUB_ORDER.map((hk) => {
                const hub = HUB_BY_KEY[hk];
                return (
                  <div
                    key={hk}
                    className="relative"
                    onMouseEnter={() => setHoverHub(hk)}
                    onMouseLeave={() => setHoverHub(null)}
                  >
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-2 hover:text-fg-primary">
                      {hub.label}
                      <span className="text-fg-muted">›</span>
                    </div>
                    {hoverHub === hk ? (
                      <div className="absolute right-full top-0 z-50 mr-1 w-52 rounded-lg border border-line bg-surface-1 p-1.5 shadow-2xl">
                        {hub.modules.map((m) => (
                          <Link
                            key={m.key}
                            href={`/session/${sessionId}/${hub.key}/${m.key}`}
                            onClick={() => setMenu(false)}
                            className="block rounded-md px-2 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                          >
                            {m.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <div className="my-1 border-t border-line" />

              {/* Rename */}
              <button
                onClick={() => {
                  setRenaming(true);
                  setMenu(false);
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
              >
                Rename
              </button>

              {/* Color */}
              <div className="px-2 py-1.5">
                <p className="mb-1 text-xs text-fg-muted">Color</p>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <form key={c} action={setSessionColor}>
                      <input type="hidden" name="id" value={sessionId} />
                      <input type="hidden" name="color" value={c} />
                      <button
                        title={c}
                        className="h-5 w-5 rounded-full border border-line transition hover:scale-110"
                        style={{ backgroundColor: c }}
                      />
                    </form>
                  ))}
                </div>
              </div>

              {/* Archive */}
              <form action={setSessionArchived}>
                <input type="hidden" name="id" value={sessionId} />
                <input type="hidden" name="archived" value="true" />
                <button className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                  Archive
                </button>
              </form>

              {/* Delete */}
              <form
                action={deleteSession}
                onSubmit={(e) => {
                  if (!confirm("Delete this session permanently? This removes all its data.")) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="id" value={sessionId} />
                <button className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-red-400 transition hover:bg-red-500/10">
                  Delete
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>

      {/* Background Tasks slide-over */}
      {tasksOpen ? (
        <div className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-sm flex-col border-l border-line bg-surface-1 shadow-2xl sm:w-80">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-widest text-gold-400">
              Background Tasks
            </span>
            <button
              onClick={() => {
                setTasksOpen(false);
                setSelected(null);
              }}
              className="text-fg-muted hover:text-fg-primary"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {tasks.length === 0 ? (
              <p className="p-4 text-center text-sm text-fg-muted">No tasks in this session yet.</p>
            ) : selected ? (
              <div className="p-2">
                <button
                  onClick={() => setSelected(null)}
                  className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline"
                >
                  ← All tasks
                </button>
                <p className="text-sm font-medium text-fg-primary">{selected.title}</p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                  {selected.status}
                </p>
              </div>
            ) : (
              tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      t.status === "completed"
                        ? "bg-emerald-400"
                        : t.status === "in_progress"
                          ? "bg-gold-400"
                          : "bg-fg-muted/50"
                    }`}
                  />
                  <span className="truncate">{t.title}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
