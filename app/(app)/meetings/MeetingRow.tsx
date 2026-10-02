"use client";

// One meeting, as a line in the meetings workspace.
//
// The old row held a time, a title, one status chip and Join; everything else —
// preparing, a reminder, the guest link, editing — was a click into the row and
// a scroll through its details. This row carries what you decide on at a glance
// (who is coming, where prep and the follow-up stand, a raised priority, a linked
// deal) and the actions you take most often, shown on hover on a wide screen and
// in a ⋯ menu on a narrow one. Clicking the meeting itself opens its preview
// beside the list rather than pushing the list down.
//
// Memoised on primitives, for the reason the old row was: a fifteen-second clock
// drives the list, and a row whose text the tick did not change should not
// re-render.
import { memo } from "react";
import Link from "next/link";
import type { MeetingDisplayStatus, MeetingTimePhase } from "@/lib/meetings/schedule";
import { initialsOf, type RowChip } from "@/lib/meetings/workspace";
import { COUNTDOWN_TONE, STATUS_TONE, chip } from "./tone";
import { OverflowMenu } from "./meeting-shared";

export interface RowPerson {
  name: string;
  email: string | null;
}

export interface MeetingRowProps {
  id: string;
  roomCode: string;
  title: string;
  timeLabel: string;
  status: MeetingDisplayStatus;
  phase: MeetingTimePhase | null;
  countdown: string | null;
  live: boolean;
  /** Who is in the room right now, when anyone is. */
  inRoom: number;
  people: RowPerson[];
  chips: RowChip[];
  /** A reason this row is in "Needs action", shown first. */
  reason?: string | null;
  ended: boolean;
  selected: boolean;
  selectable: boolean;
  previewing: boolean;
  reminderState: "sending" | "sent" | "failed" | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onPrep: (id: string) => void;
  onFollowUp: (id: string) => void;
  onCopyLink: (id: string) => void;
  onRemind: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  copied: boolean;
}

const MAX_AVATARS = 3;
/** Chips beyond these collapse into "+N"; the preview shows them all. */
const MAX_CHIPS = 3;

export const MeetingRow = memo(function MeetingRow(p: MeetingRowProps) {
  const shown = p.people.slice(0, MAX_AVATARS);
  const more = p.people.length - shown.length;
  const peopleTitle = p.people.map((a) => a.name || a.email).join(", ");
  const chips = p.chips.slice(0, MAX_CHIPS);
  const hiddenChips = p.chips.length - chips.length;

  return (
    <div
      className={`fx-card group flex items-center gap-2 pr-2 transition-colors ${
        p.live ? "border-status-success/50" : ""
      } ${p.previewing ? "border-gold-400/60 bg-gold-400/5" : ""}`}
    >
      {p.selectable ? (
        <label className="flex shrink-0 cursor-pointer items-center self-stretch pl-3" title="Select">
          <input
            type="checkbox"
            checked={p.selected}
            onChange={() => p.onSelect(p.id)}
            aria-label={`Select ${p.title}`}
            className="h-4 w-4 accent-[var(--gold-400)]"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => p.onPreview(p.id)}
        aria-pressed={p.previewing}
        aria-label={`Preview ${p.title}`}
        className={`fx-focus flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left ${p.selectable ? "pl-1" : "pl-3"}`}
      >
        <span className="hidden w-[68px] shrink-0 font-mono text-[11px] tabular-nums uppercase tracking-[0.06em] text-fg-secondary sm:block">
          {p.timeLabel}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-fg-primary">{p.title}</span>
            <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-fg-muted sm:hidden">{p.timeLabel}</span>
          </span>
          {p.reason || p.chips.length > 0 || p.inRoom > 0 ? (
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {p.reason ? <span className={chip("warning")}>{p.reason}</span> : null}
              {p.inRoom > 0 ? (
                <span className={chip("success")}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  {p.inRoom} in room
                </span>
              ) : null}
              {chips.map((c, i) => (
                // Two on a phone, three on anything wider.
                <span key={c.label} className={`${chip(c.tone)} max-w-[14rem] truncate ${i >= 2 ? "hidden sm:inline-flex" : ""}`}>
                  {c.label}
                </span>
              ))}
              {hiddenChips > 0 ? (
                <span className={chip("neutral")} title={p.chips.slice(MAX_CHIPS).map((c) => c.label).join(", ")}>
                  +{hiddenChips}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        {shown.length > 0 ? (
          <span className="hidden shrink-0 items-center md:flex" title={peopleTitle} aria-label={`${p.people.length} people`}>
            {shown.map((a, i) => (
              <span
                key={`${a.email ?? a.name}-${i}`}
                aria-hidden="true"
                className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--surface-1)] bg-surface-3 text-[9px] font-semibold text-fg-secondary first:ml-0"
              >
                {initialsOf(a.name || a.email)}
              </span>
            ))}
            {more > 0 ? <span className="ml-1 text-[11px] text-fg-muted">+{more}</span> : null}
          </span>
        ) : null}

        {p.phase && p.phase !== "ended" && p.phase !== "upcoming" ? (
          <span className={`${chip(COUNTDOWN_TONE[p.phase])} hidden sm:inline-flex`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {p.phase === "in_progress" ? "In progress" : p.countdown}
          </span>
        ) : null}
        {/* A "Needs action" reason already says what the status would. */}
        {!p.reason ? <span className={`${chip(STATUS_TONE[p.status])} hidden sm:inline-flex`}>{p.status}</span> : null}
      </button>

      {/* Quick actions. On a wide screen they appear with the pointer or
          keyboard focus; on a narrow one, behind the ⋯ menu. */}
      <div className="hidden shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 lg:flex">
        <QuickButton onClick={() => (p.ended ? p.onFollowUp(p.id) : p.onPrep(p.id))}>
          {p.ended ? "Follow up" : "Prep"}
        </QuickButton>
        <QuickButton onClick={() => p.onCopyLink(p.id)}>{p.copied ? "Copied" : "Copy link"}</QuickButton>
        {!p.ended ? (
          <QuickButton disabled={p.reminderState === "sending"} onClick={() => p.onRemind(p.id)}>
            {p.reminderState === "sending" ? "Sending…" : p.reminderState === "sent" ? "Reminded" : "Remind"}
          </QuickButton>
        ) : null}
      </div>
      <OverflowMenu
        label={`Actions for ${p.title}`}
        items={[
          { label: p.ended ? "Follow up with Earn" : "Prepare with Earn", onSelect: () => (p.ended ? p.onFollowUp(p.id) : p.onPrep(p.id)) },
          { label: "Copy guest link", onSelect: () => p.onCopyLink(p.id) },
          ...(p.ended ? [] : [{ label: "Send reminder", onSelect: () => p.onRemind(p.id), disabled: p.reminderState === "sending" }]),
          { label: "Edit or reschedule", onSelect: () => p.onEdit(p.id) },
          { label: "Delete", danger: true, onSelect: () => p.onDelete(p.id) },
        ]}
      />
      {p.ended ? (
        <Link
          href={`/meetings/${p.roomCode}/report`}
          className="fx-btn shrink-0 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-xs font-semibold text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
        >
          Report
        </Link>
      ) : (
        <Link
          href={`/meetings/${p.roomCode}`}
          className={`fx-btn shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            p.live
              ? "bg-[var(--status-success)] text-white hover:opacity-90"
              : "border border-gold-400/35 bg-gold-400/10 text-[var(--gold-300)] hover:bg-gold-400/20"
          }`}
        >
          {p.live ? "Join live" : "Join"}
        </Link>
      )}
    </div>
  );
});

function QuickButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="fx-btn rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg-primary disabled:opacity-50"
    >
      {children}
    </button>
  );
}
