// lib/network-workspace.ts
//
// The pure half of the workspace: which bucket a task falls into, and what days
// a calendar month actually covers.
//
// All of this is kept out of the components because it is date arithmetic, and
// date arithmetic is where this sort of feature goes quietly wrong — a month
// grid that drops a day when a month starts on a Sunday, a "due today" that
// means something different at 23:00, a week that shifts by an hour across a
// daylight-saving boundary. None of that is visible in a screenshot, and all of
// it is trivial to assert.
//
// Days are handled as plain calendar days in UTC, never as instants in a local
// zone. A due date is a day somebody agreed to, not a moment; treating it as an
// instant is what makes a task due "Friday" show up on Thursday for a colleague
// one timezone east.

export const TASK_BUCKETS = ["overdue", "today", "week", "later", "someday"] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  someday: "No date",
};

/** How urgent a bucket reads, for ordering and colour. */
export const BUCKET_ORDER: Record<TaskBucket, number> = {
  overdue: 0,
  today: 1,
  week: 2,
  later: 3,
  someday: 4,
};

export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "open" | "done" | "cancelled";

export interface QueueTask {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** The plain UTC day an instant falls on, as `YYYY-MM-DD`. */
export function utcDay(value: string | Date): string | null {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both read as plain UTC days. Signed. */
export function daysBetween(from: string | Date, to: string | Date): number | null {
  const a = utcDay(from);
  const b = utcDay(to);
  if (!a || !b) return null;
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Which bucket a due date falls into, relative to `now`.
 *
 * Compared by plain day rather than by instant: a task due at 09:00 today is
 * "today" at 17:00, not "overdue". Somebody looking at their queue in the
 * afternoon should not see the morning's work reclassified as late while they
 * are still working on it — the day is the unit people agreed to.
 */
export function bucketTask(dueAt: string | null | undefined, now: Date = new Date()): TaskBucket {
  if (!dueAt) return "someday";
  const delta = daysBetween(now, dueAt);
  if (delta === null) return "someday";
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta <= 7) return "week";
  return "later";
}

export interface TaskGroup {
  bucket: TaskBucket;
  label: string;
  tasks: QueueTask[];
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * The queue: tasks grouped by urgency, each group sorted by date then priority.
 *
 * Empty groups are dropped. A column of headings with nothing under them reads
 * as a broken screen rather than as an empty queue, and "Overdue (0)" is a
 * sentence nobody needs to read every morning.
 */
export function groupTaskQueue(tasks: QueueTask[], now: Date = new Date()): TaskGroup[] {
  const groups = new Map<TaskBucket, QueueTask[]>();
  for (const bucket of TASK_BUCKETS) groups.set(bucket, []);

  for (const task of tasks) {
    groups.get(bucketTask(task.dueAt, now))!.push(task);
  }

  const out: TaskGroup[] = [];
  for (const bucket of TASK_BUCKETS) {
    const list = groups.get(bucket)!;
    if (list.length === 0) continue;
    list.sort((a, b) => {
      // Undated work sorts by priority alone; there is no date to order it by.
      if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return a.title.localeCompare(b.title);
    });
    out.push({ bucket, label: BUCKET_LABEL[bucket], tasks: list });
  }
  return out;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

/** Split a `YYYY-MM` into its parts, or null if it is not one. */
function parseMonth(month: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return { year, month: mon };
}

/** The month a date belongs to, as `YYYY-MM`. */
export function monthOf(value: string | Date = new Date()): string {
  const day = utcDay(value);
  return day ? day.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

/** Step a `YYYY-MM` forward or back without rolling into the wrong year. */
export function shiftMonth(month: string, by: number): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  // Months are 0-indexed here so the Date constructor carries the year for us:
  // month 12 becomes January of the next year rather than an invalid date.
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * The grid a month is drawn on: whole weeks, Monday-first, always six rows.
 *
 * Six rows regardless of the month is deliberate. A grid that is five rows in
 * February and six in March changes height as you page through it, and every
 * row below it jumps. The cost is a mostly-empty final row in short months,
 * which is the cheaper of the two.
 */
export function monthGrid(month: string, today: string | Date = new Date()): CalendarDay[] {
  const parsed = parseMonth(month);
  if (!parsed) return [];

  const first = new Date(Date.UTC(parsed.year, parsed.month - 1, 1));
  // getUTCDay is Sunday-0; shift so Monday is 0 and the week starts where the
  // working week does.
  const leading = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - leading * 86_400_000);
  const todayDay = utcDay(today);

  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    days.push({
      date,
      inMonth: d.getUTCMonth() === parsed.month - 1 && d.getUTCFullYear() === parsed.year,
      isToday: date === todayDay,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }
  return days;
}

/**
 * The first and last day the grid shows, which is what the schedule query has
 * to cover — not the month's own bounds. Asking the database for September and
 * drawing a grid that starts on 25 August leaves five days looking empty when
 * they are merely unfetched.
 */
export function gridRange(month: string): { start: string; end: string } | null {
  const grid = monthGrid(month);
  if (grid.length === 0) return null;
  return { start: grid[0].date, end: grid[grid.length - 1].date };
}

export type ScheduleKind = "task" | "close";

export interface ScheduleEntry {
  kind: ScheduleKind;
  id: string;
  title: string;
  onDate: string;
  status: string;
  priority: TaskPriority | null;
  assigneeId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  amount: number | null;
  currency: string | null;
  overdue: boolean;
}

/** Schedule entries keyed by `YYYY-MM-DD`, for O(1) lookup per calendar cell. */
export function byDay(entries: ScheduleEntry[]): Map<string, ScheduleEntry[]> {
  const map = new Map<string, ScheduleEntry[]>();
  for (const entry of entries) {
    const list = map.get(entry.onDate);
    if (list) list.push(entry);
    else map.set(entry.onDate, [entry]);
  }
  return map;
}

export interface ClosingBucket {
  currency: string;
  dealCount: number;
  targetTotal: number;
  weightedTotal: number;
}

export interface WorkspaceSummary {
  tasksOverdue: number;
  tasksDueToday: number;
  tasksDueWeek: number;
  tasksUnassigned: number;
  tasksMine: number;
  contactsCold: number;
  activitiesWeek: number;
  /** Open deals whose expected close is already in the past. */
  closesOverdue: number;
  /** Deals closing within 30 days, per currency. Never summed across them. */
  closingSoon: ClosingBucket[];
}

const EMPTY_SUMMARY: WorkspaceSummary = {
  tasksOverdue: 0,
  tasksDueToday: 0,
  tasksDueWeek: 0,
  tasksUnassigned: 0,
  tasksMine: 0,
  contactsCold: 0,
  activitiesWeek: 0,
  closesOverdue: 0,
  closingSoon: [],
};

/** Map the summary RPC's row onto the client shape. */
/**
 * Normalize one `network_workspace_summary` row into the shape the tiles read.
 *
 * Counts coerce to a finite number and money is grouped per currency exactly as
 * the database returned it. A missing row yields zeroes only because the caller
 * has already decided the read succeeded — a FAILED read must not reach here,
 * since "nothing overdue" and "we could not check" are different facts.
 */
export function mapWorkspaceSummary(row: Record<string, unknown> | null | undefined): WorkspaceSummary {
  if (!row) return { ...EMPTY_SUMMARY };
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const raw = Array.isArray(row.closing_soon) ? row.closing_soon : [];
  return {
    tasksOverdue: num(row.tasks_overdue),
    tasksDueToday: num(row.tasks_due_today),
    tasksDueWeek: num(row.tasks_due_week),
    tasksUnassigned: num(row.tasks_unassigned),
    tasksMine: num(row.tasks_mine),
    contactsCold: num(row.contacts_cold),
    activitiesWeek: num(row.activities_week),
    closesOverdue: num(row.closes_overdue),
    closingSoon: raw.map((b) => {
      const bucket = (b ?? {}) as Record<string, unknown>;
      return {
        currency: String(bucket.currency ?? "USD"),
        dealCount: num(bucket.deal_count),
        targetTotal: num(bucket.target_total),
        weightedTotal: Math.round(num(bucket.weighted_total)),
      };
    }),
  };
}
