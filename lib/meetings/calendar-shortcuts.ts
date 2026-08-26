// lib/meetings/calendar-shortcuts.ts
// Keyboard shortcuts for the calendar grid.
//
// The bindings mirror Google Calendar's, because that is what anyone who lives
// in a calendar already has in their fingers: d/w/m for the views, t for today,
// j/k or the arrows to move through time. Pure so the mapping can be tested
// without mounting a grid.

import type { CalendarView } from "@/lib/meetings/calendar";

export type CalendarAction =
  | { kind: "view"; view: CalendarView }
  | { kind: "today" }
  | { kind: "prev" }
  | { kind: "next" }
  | { kind: "help" };

/** The shape of a keyboard event this needs, so tests need no DOM. */
export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Where the keystroke landed, enough to tell typing from navigating. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

const VIEW_KEYS: Record<string, CalendarView> = {
  d: "day",
  "1": "day",
  w: "week",
  "2": "week",
  m: "month",
  "3": "month",
  a: "agenda",
  "4": "agenda",
};

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether a keystroke is someone typing rather than navigating.
 *
 * Without this, "d" in a meeting title jumps the whole calendar to day view and
 * eats the character. A contenteditable counts too — rich-text fields are not
 * <textarea> and would otherwise be missed.
 */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has((target.tagName ?? "").toUpperCase());
}

/**
 * The action a keystroke means, or null for anything else.
 *
 * Modified keys are deliberately ignored: ⌘D is a browser bookmark and Ctrl+A
 * is select-all, and stealing either would be worse than having no shortcut.
 */
export function actionForKey(event: KeyLike, target?: TargetLike | null): CalendarAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(target)) return null;

  const key = event.key;

  // `?` needs Shift on most layouts, so it is checked before the shift guard.
  if (key === "?") return { kind: "help" };
  if (event.shiftKey) return null;

  const lower = key.toLowerCase();

  const view = VIEW_KEYS[lower];
  if (view) return { kind: "view", view };

  if (lower === "t") return { kind: "today" };
  if (lower === "j" || lower === "n" || key === "ArrowRight" || key === "ArrowDown") return { kind: "next" };
  if (lower === "k" || lower === "p" || key === "ArrowLeft" || key === "ArrowUp") return { kind: "prev" };

  return null;
}

export interface ShortcutHelp {
  keys: string;
  description: string;
}

/** The shortcut list, for the help overlay. Order is how it reads on screen. */
export const SHORTCUT_HELP: ShortcutHelp[] = [
  { keys: "D · 1", description: "Day view" },
  { keys: "W · 2", description: "Week view" },
  { keys: "M · 3", description: "Month view" },
  { keys: "A · 4", description: "Agenda view" },
  { keys: "T", description: "Jump to today" },
  { keys: "J · N · →", description: "Next period" },
  { keys: "K · P · ←", description: "Previous period" },
  { keys: "Drag", description: "Move a meeting; drag its edges to resize" },
  { keys: "?", description: "Show this list" },
  { keys: "Esc", description: "Close" },
];
