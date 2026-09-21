// The automation rule model, and every decision it makes — pure.
//
// Nothing in this file touches the database or the network. Given a rule, a
// snapshot of the row that changed, and a clock, it answers three questions:
//
//   1. Does this trigger apply to what just happened?      (triggerMatches)
//   2. Do the rule's conditions hold on this row?          (conditionsHold)
//   3. What, concretely, should be done?                   (planActions)
//
// Keeping that here means the interesting behaviour is testable without a
// Postgres instance, and the server half stays a thin applier. It also means
// the event path (evaluated inside the request that changed the row) and the
// scheduled path (evaluated by the hourly sweep) share one evaluator rather
// than drifting into two definitions of what "in diligence for 30 days" means.

// ── Triggers ─────────────────────────────────────────────────────────────────

export const EVENT_TRIGGERS = [
  "opportunity_created",
  "opportunity_stage_changed",
  "opportunity_won",
  "opportunity_lost",
  "contact_stage_changed",
  "task_completed",
] as const;

export const SCHEDULED_TRIGGERS = [
  "opportunity_idle",
  "contact_going_cold",
  "close_date_approaching",
] as const;

export const TRIGGER_TYPES = [...EVENT_TRIGGERS, ...SCHEDULED_TRIGGERS] as const;

export type EventTrigger = (typeof EVENT_TRIGGERS)[number];
export type ScheduledTrigger = (typeof SCHEDULED_TRIGGERS)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(v: unknown): v is TriggerType {
  return typeof v === "string" && (TRIGGER_TYPES as readonly string[]).includes(v);
}

export function isScheduledTrigger(v: TriggerType): v is ScheduledTrigger {
  return (SCHEDULED_TRIGGERS as readonly string[]).includes(v);
}

/** Which object a trigger is about — decides which table the sweep scans and
 *  which id the run log records. */
export const TRIGGER_ENTITY: Record<TriggerType, "opportunity" | "contact" | "task"> = {
  opportunity_created: "opportunity",
  opportunity_stage_changed: "opportunity",
  opportunity_won: "opportunity",
  opportunity_lost: "opportunity",
  contact_stage_changed: "contact",
  task_completed: "task",
  opportunity_idle: "opportunity",
  contact_going_cold: "contact",
  close_date_approaching: "opportunity",
};

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  opportunity_created: "A deal is created",
  opportunity_stage_changed: "A deal changes stage",
  opportunity_won: "A deal is won",
  opportunity_lost: "A deal is lost",
  contact_stage_changed: "A contact changes stage",
  task_completed: "A task is completed",
  opportunity_idle: "A deal goes quiet",
  contact_going_cold: "A relationship goes cold",
  close_date_approaching: "A close date is approaching",
};

/** Sensible default for the `days` setting of each scheduled trigger, so the
 *  form opens on a number that means something rather than on zero. */
export const TRIGGER_DEFAULT_DAYS: Record<ScheduledTrigger, number> = {
  opportunity_idle: 21,
  contact_going_cold: 60,
  close_date_approaching: 14,
};

/** Upper bound on the `days` setting. A year is already well past the point
 *  where "went quiet" describes anything; beyond it the rule would sweep the
 *  whole book on every run. */
export const MAX_TRIGGER_DAYS = 365;

// ── Conditions ───────────────────────────────────────────────────────────────

export const CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "is_empty",
  "is_not_empty",
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

export type Condition = {
  field: string;
  op: ConditionOp;
  value?: unknown;
};

/** The columns a condition may read. Enumerated rather than open: a rule is
 *  written by an admin but evaluated on rows other members own, and an
 *  arbitrary field path would let a rule reach into whatever the snapshot
 *  happens to carry. Custom columns are reachable as `custom.<key>`. */
export const CONDITION_FIELDS = [
  "stage",
  "status",
  "owner_id",
  "contact_id",
  "investor_id",
  "fund_id",
  "target_amount",
  "currency",
  "probability",
  "expected_close",
  "source",
  "tags",
  "company",
  "title",
  "strength_score",
  "visibility",
  "priority",
  "name",
] as const;

export function isConditionField(field: string): boolean {
  if ((CONDITION_FIELDS as readonly string[]).includes(field)) return true;
  // custom.<field_key>, matching the slug shape network_field_defs enforces.
  return /^custom\.[a-z][a-z0-9_]{0,39}$/.test(field);
}

export function isConditionOp(v: unknown): v is ConditionOp {
  return typeof v === "string" && (CONDITION_OPS as readonly string[]).includes(v);
}

/** A flattened row, as the snapshot builders below produce it. */
export type Snapshot = Record<string, unknown>;

function readField(snapshot: Snapshot, field: string): unknown {
  if (field.startsWith("custom.")) {
    const custom = snapshot.custom;
    if (!custom || typeof custom !== "object") return undefined;
    return (custom as Record<string, unknown>)[field.slice("custom.".length)];
  }
  return snapshot[field];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Compare as numbers when both sides are numeric, otherwise as strings.
 *  Returns null when the comparison is not meaningful, which reads as "the
 *  condition does not hold" rather than as a silent true. */
function compare(left: unknown, right: unknown): number | null {
  const ln = typeof left === "number" ? left : Number(left);
  const rn = typeof right === "number" ? right : Number(right);
  if (
    left !== null &&
    left !== "" &&
    right !== null &&
    right !== "" &&
    Number.isFinite(ln) &&
    Number.isFinite(rn)
  ) {
    return ln === rn ? 0 : ln < rn ? -1 : 1;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return null;
}

/** Loose equality for the values that actually travel through jsonb: a
 *  probability arrives as a number from the row and as a string from a form. */
function looseEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (typeof left === "boolean" || typeof right === "boolean") {
    return String(left) === String(right);
  }
  const cmp = compare(left, right);
  return cmp === 0;
}

/** Evaluate one condition against a snapshot. */
export function conditionHolds(condition: Condition, snapshot: Snapshot): boolean {
  const actual = readField(snapshot, condition.field);
  const expected = condition.value;

  switch (condition.op) {
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "eq":
      return looseEquals(actual, expected);
    case "neq":
      return !looseEquals(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // An absent value is not "less than" anything — it is unknown, and an
      // unknown must not satisfy a threshold. A deal with no target_amount
      // should not match "amount under 5m".
      if (actual === null || actual === undefined || actual === "") return false;
      const cmp = compare(actual, expected);
      if (cmp === null) return false;
      if (condition.op === "gt") return cmp > 0;
      if (condition.op === "gte") return cmp >= 0;
      if (condition.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    case "contains": {
      // Array membership for tags and multi-selects; substring for text.
      if (Array.isArray(actual)) return actual.some((item) => looseEquals(item, expected));
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      return false;
    }
    case "in": {
      if (!Array.isArray(expected)) return false;
      if (Array.isArray(actual)) {
        return actual.some((item) => expected.some((e) => looseEquals(item, e)));
      }
      return expected.some((e) => looseEquals(actual, e));
    }
    default:
      return false;
  }
}

/** Every condition must hold. An empty list holds — a rule with no conditions
 *  fires on its trigger alone, which is the common case. */
export function conditionsHold(conditions: Condition[], snapshot: Snapshot): boolean {
  return conditions.every((c) => conditionHolds(c, snapshot));
}

// ── Actions ──────────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  "create_task",
  "log_activity",
  "set_stage",
  "set_owner",
  "set_field",
  "add_tag",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export function isActionType(v: unknown): v is ActionType {
  return typeof v === "string" && (ACTION_TYPES as readonly string[]).includes(v);
}

export const ACTION_LABEL: Record<ActionType, string> = {
  create_task: "Create a follow-up task",
  log_activity: "Write a timeline entry",
  set_stage: "Move the stage",
  set_owner: "Reassign the owner",
  set_field: "Set a column value",
  add_tag: "Add a tag",
};

/** Who a created task goes to. `owner` is the row's owner, `creator` the admin
 *  who wrote the rule — the fallback when a row has no owner, because a task
 *  assigned to nobody is a task nobody does. */
export type Assignee = "owner" | "creator" | "unassigned" | string;

export type Action =
  | {
      type: "create_task";
      title: string;
      notes?: string;
      dueInDays?: number;
      priority?: "low" | "normal" | "high";
      assignee?: Assignee;
    }
  | {
      type: "log_activity";
      activityType?: string;
      subject: string;
      body?: string;
    }
  | { type: "set_stage"; stage: string }
  | { type: "set_owner"; ownerId: string }
  | { type: "set_field"; key: string; value: unknown }
  | { type: "add_tag"; tag: string };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: Condition[];
  actions: Action[];
  runCount: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Templates ────────────────────────────────────────────────────────────────

/** Placeholders a rule's text may use. Deliberately small and explicit: the
 *  point is a readable task title, not a template language. */
export const TEMPLATE_TOKENS = [
  "name",
  "stage",
  "status",
  "company",
  "amount",
  "currency",
  "close_date",
  "owner",
  "days",
] as const;

/**
 * Substitute `{{token}}` in rule text from the snapshot.
 *
 * An unknown token is left as written rather than blanked. A rule that says
 * `{{cloze_date}}` by mistake should show the typo — silently producing
 * "Follow up on  before " hides the error in exactly the text a person reads
 * to work out what the rule does.
 */
export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, token: string) => {
    const key = token.toLowerCase();
    if (!(key in values)) return whole;
    const value = values[key];
    if (value === null || value === undefined || value === "") return whole;
    return String(value);
  });
}

/** The values renderTemplate reads, built from a row snapshot. */
export function templateValues(
  snapshot: Snapshot,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const amount = snapshot.target_amount;
  return {
    name: snapshot.name ?? null,
    stage: snapshot.stage ?? null,
    status: snapshot.status ?? null,
    company: snapshot.company ?? null,
    amount:
      amount === null || amount === undefined || amount === ""
        ? null
        : formatAmount(Number(amount), typeof snapshot.currency === "string" ? snapshot.currency : "USD"),
    currency: snapshot.currency ?? null,
    close_date: snapshot.expected_close ?? null,
    owner: snapshot.owner_name ?? null,
    ...extras,
  };
}

function formatAmount(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // An unknown currency code throws rather than falling back, and a bad code
    // in one rule should not take down the whole firing.
    return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  }
}

// ── Trigger matching ─────────────────────────────────────────────────────────

/** What happened, as the write path describes it. */
export type TriggerEvent =
  | { kind: "opportunity_created"; snapshot: Snapshot }
  | { kind: "opportunity_stage_changed"; from: string; to: string; snapshot: Snapshot }
  | { kind: "contact_stage_changed"; from: string; to: string; snapshot: Snapshot }
  | { kind: "task_completed"; snapshot: Snapshot };

/**
 * Does this rule's trigger apply to this event?
 *
 * `opportunity_won` and `opportunity_lost` are stage changes narrowed to the
 * two terminal stages — a separate trigger rather than a `toStage` setting
 * because "when we win one" is the rule people actually reach for, and making
 * them configure it is how it ends up subtly wrong.
 *
 * Note that a deal CREATED directly into `committed` does not fire
 * `opportunity_won`: it was recorded as already closed, not won here. That is
 * the behaviour a firm importing historical commitments wants, and the
 * alternative — congratulating everyone on a thousand deals from 2019 — is the
 * reason to be explicit about it rather than leave it to be discovered.
 */
export function triggerMatches(
  automation: Pick<Automation, "triggerType" | "triggerConfig">,
  event: TriggerEvent,
): boolean {
  const cfg = automation.triggerConfig ?? {};

  switch (automation.triggerType) {
    case "opportunity_created":
      return event.kind === "opportunity_created";

    case "opportunity_won":
      return event.kind === "opportunity_stage_changed" && event.to === "committed";

    case "opportunity_lost":
      return event.kind === "opportunity_stage_changed" && event.to === "passed";

    case "opportunity_stage_changed":
    case "contact_stage_changed": {
      const wanted =
        automation.triggerType === "opportunity_stage_changed"
          ? "opportunity_stage_changed"
          : "contact_stage_changed";
      if (event.kind !== wanted) return false;
      const from = cfg.fromStage;
      const to = cfg.toStage;
      if (typeof from === "string" && from && from !== event.from) return false;
      if (typeof to === "string" && to && to !== event.to) return false;
      return true;
    }

    case "task_completed":
      return event.kind === "task_completed";

    default:
      // Scheduled triggers are never matched by an event — the sweep selects
      // their candidates directly. Saying so here rather than falling through
      // to `true` is what keeps an idle-deal rule from firing on every edit.
      return false;
  }
}

// ── Dedupe keys ──────────────────────────────────────────────────────────────

/**
 * The key that makes a firing idempotent, written into the run log's unique
 * index. Two calls that produce the same key are the same firing, and the
 * second one loses the insert and does nothing.
 *
 * Event triggers key on the row's version (`updated_at`), so a client retry,
 * a double-submitted form, or two routes evaluating the same mutation fire the
 * rule once. A genuine second edit carries a new version and fires again.
 *
 * Scheduled triggers key on the UTC day. The sweep runs hourly; without this
 * a "went quiet" rule would raise the same follow-up twenty-four times before
 * anyone noticed, and the day bucket is what makes "once while it is true"
 * mean once a day rather than once ever — a deal that goes quiet, gets a call,
 * and goes quiet again should be raised again.
 *
 * UTC throughout, matching network_workspace_summary and the client's date
 * formatting: a key that rolled over at local midnight would fire twice on the
 * day the two disagree.
 */
export function automationDedupeKey(
  trigger: TriggerType,
  opts: { version?: string | null; now?: Date; extra?: string } = {},
): string {
  if (isScheduledTrigger(trigger)) {
    const now = opts.now ?? new Date();
    const day = now.toISOString().slice(0, 10);
    return opts.extra ? `${trigger}:${day}:${opts.extra}` : `${trigger}:${day}`;
  }
  // A row with no version would make every firing collide on the same key and
  // silently fire once ever, so fall back to a value that never collides. The
  // write paths always have one; this is the belt.
  const version = opts.version || `nover:${(opts.now ?? new Date()).toISOString()}`;
  return opts.extra ? `${trigger}:${version}:${opts.extra}` : `${trigger}:${version}`;
}

// ── Planning ─────────────────────────────────────────────────────────────────

/** An action resolved against a concrete row: no templates left, ids filled
 *  in, dates computed. This is what the server half applies. */
export type PlannedAction =
  | {
      type: "create_task";
      title: string;
      notes: string | null;
      dueAt: string | null;
      priority: "low" | "normal" | "high";
      assigneeId: string | null;
    }
  | {
      type: "log_activity";
      activityType: string;
      subject: string;
      body: string | null;
    }
  | { type: "set_stage"; stage: string }
  | { type: "set_owner"; ownerId: string }
  | { type: "set_field"; key: string; value: unknown }
  | { type: "add_tag"; tag: string };

export type PlanContext = {
  snapshot: Snapshot;
  /** The admin who wrote the rule — the `creator` assignee, and the fallback
   *  when the row has no owner. */
  ruleAuthorId: string | null;
  now: Date;
  /** Extra template values the trigger supplies, e.g. the `days` threshold. */
  extras?: Record<string, unknown>;
};

/** Add whole days to an instant. Used for a task due date, which people read
 *  as a day rather than as an instant, so the arithmetic is on the UTC day. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * Turn a rule's declared actions into concrete ones for this row.
 *
 * Actions that cannot be resolved are dropped with a reason rather than
 * applied halfway: a `set_owner` with no owner id, or a `create_task` whose
 * title renders empty, is a broken rule, and the run log should say which
 * action was skipped rather than leave an unexplained gap.
 */
export function planActions(
  actions: Action[],
  ctx: PlanContext,
): { planned: PlannedAction[]; skipped: { action: string; reason: string }[] } {
  const planned: PlannedAction[] = [];
  const skipped: { action: string; reason: string }[] = [];
  const values = templateValues(ctx.snapshot, ctx.extras ?? {});
  const rowOwner = typeof ctx.snapshot.owner_id === "string" ? ctx.snapshot.owner_id : null;

  for (const action of actions) {
    switch (action.type) {
      case "create_task": {
        const title = renderTemplate(action.title ?? "", values).trim();
        if (!title) {
          skipped.push({ action: "create_task", reason: "The task title is empty." });
          break;
        }
        const notes = action.notes ? renderTemplate(action.notes, values).trim() || null : null;
        const due =
          typeof action.dueInDays === "number" && Number.isFinite(action.dueInDays)
            ? addDays(ctx.now, action.dueInDays).toISOString()
            : null;
        planned.push({
          type: "create_task",
          title: title.slice(0, 300),
          notes: notes ? notes.slice(0, 4000) : null,
          dueAt: due,
          priority: action.priority ?? "normal",
          assigneeId: resolveAssignee(action.assignee, rowOwner, ctx.ruleAuthorId),
        });
        break;
      }

      case "log_activity": {
        const subject = renderTemplate(action.subject ?? "", values).trim();
        if (!subject) {
          skipped.push({ action: "log_activity", reason: "The entry has no subject." });
          break;
        }
        const body = action.body ? renderTemplate(action.body, values).trim() || null : null;
        planned.push({
          type: "log_activity",
          activityType: action.activityType ?? "note",
          subject: subject.slice(0, 300),
          body: body ? body.slice(0, 8000) : null,
        });
        break;
      }

      case "set_stage": {
        if (!action.stage) {
          skipped.push({ action: "set_stage", reason: "No stage was chosen." });
          break;
        }
        // Moving a row to the stage it is already in is not a change; applying
        // it would bump updated_at and, with it, every event rule's dedupe key.
        if (ctx.snapshot.stage === action.stage) {
          skipped.push({ action: "set_stage", reason: "Already in that stage." });
          break;
        }
        planned.push({ type: "set_stage", stage: action.stage });
        break;
      }

      case "set_owner": {
        if (!action.ownerId) {
          skipped.push({ action: "set_owner", reason: "No owner was chosen." });
          break;
        }
        if (rowOwner === action.ownerId) {
          skipped.push({ action: "set_owner", reason: "Already owned by that person." });
          break;
        }
        planned.push({ type: "set_owner", ownerId: action.ownerId });
        break;
      }

      case "set_field": {
        if (!action.key) {
          skipped.push({ action: "set_field", reason: "No column was chosen." });
          break;
        }
        planned.push({ type: "set_field", key: action.key, value: action.value ?? null });
        break;
      }

      case "add_tag": {
        const tag = (action.tag ?? "").trim();
        if (!tag) {
          skipped.push({ action: "add_tag", reason: "The tag is empty." });
          break;
        }
        const existing = Array.isArray(ctx.snapshot.tags) ? (ctx.snapshot.tags as unknown[]) : [];
        if (existing.some((t) => String(t) === tag)) {
          skipped.push({ action: "add_tag", reason: "Already tagged." });
          break;
        }
        planned.push({ type: "add_tag", tag: tag.slice(0, 60) });
        break;
      }

      default:
        skipped.push({
          action: String((action as { type?: unknown }).type ?? "unknown"),
          reason: "Unknown action type.",
        });
    }
  }

  return { planned, skipped };
}

function resolveAssignee(
  assignee: Assignee | undefined,
  rowOwner: string | null,
  ruleAuthorId: string | null,
): string | null {
  if (assignee === "unassigned") return null;
  // No setting at all means "whoever owns the row", which is what a follow-up
  // on someone else's deal should do.
  if (!assignee || assignee === "owner") return rowOwner ?? ruleAuthorId;
  if (assignee === "creator") return ruleAuthorId;
  return assignee;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; value: { triggerConfig: Record<string, unknown>; conditions: Condition[]; actions: Action[] } }
  | { ok: false; errors: string[] };

export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 5;

/**
 * Validate the body of a rule against its trigger.
 *
 * Refusals are specific because a rule is written once and then runs
 * unattended: "Invalid rule" tells the admin nothing, and a rule that was
 * accepted but can never fire is worse than one that was rejected.
 */
export function validateAutomationBody(
  triggerType: TriggerType,
  rawConfig: unknown,
  rawConditions: unknown,
  rawActions: unknown,
  opts: { stages?: readonly string[]; customKeys?: readonly string[] } = {},
): ValidationResult {
  const errors: string[] = [];

  // — trigger config —
  const config: Record<string, unknown> = {};
  const cfg =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};

  if (isScheduledTrigger(triggerType)) {
    const days = Number(cfg.days ?? TRIGGER_DEFAULT_DAYS[triggerType]);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TRIGGER_DAYS) {
      errors.push(`Choose a number of days between 1 and ${MAX_TRIGGER_DAYS}.`);
    } else {
      config.days = days;
    }
  } else if (
    triggerType === "opportunity_stage_changed" ||
    triggerType === "contact_stage_changed"
  ) {
    for (const key of ["fromStage", "toStage"] as const) {
      const value = cfg[key];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string") {
        errors.push(`${key} must be a stage name.`);
        continue;
      }
      if (opts.stages && !opts.stages.includes(value)) {
        errors.push(`"${value}" is not a stage on this object.`);
        continue;
      }
      config[key] = value;
    }
    // A rule keyed on the same stage in both directions can never fire: a
    // stage change is by definition a move between two different stages.
    if (config.fromStage && config.fromStage === config.toStage) {
      errors.push("A stage change moves between two different stages.");
    }
  }

  // — conditions —
  const conditions: Condition[] = [];
  const rawCondList = Array.isArray(rawConditions) ? rawConditions : [];
  if (rawCondList.length > MAX_CONDITIONS) {
    errors.push(`A rule can have at most ${MAX_CONDITIONS} conditions.`);
  }
  for (const raw of rawCondList.slice(0, MAX_CONDITIONS)) {
    if (!raw || typeof raw !== "object") {
      errors.push("A condition must name a field, a test, and a value.");
      continue;
    }
    const { field, op, value } = raw as { field?: unknown; op?: unknown; value?: unknown };
    if (typeof field !== "string" || !isConditionField(field)) {
      errors.push(`"${String(field)}" is not a field a rule can test.`);
      continue;
    }
    if (!isConditionOp(op)) {
      errors.push(`"${String(op)}" is not a test a rule can apply.`);
      continue;
    }
    if (op !== "is_empty" && op !== "is_not_empty" && (value === undefined || value === "")) {
      errors.push(`The "${field}" condition needs a value to compare against.`);
      continue;
    }
    if (op === "in" && !Array.isArray(value)) {
      errors.push(`The "${field}" condition needs a list of values.`);
      continue;
    }
    conditions.push({ field, op, value });
  }

  // — actions —
  const actions: Action[] = [];
  const rawActionList = Array.isArray(rawActions) ? rawActions : [];
  if (rawActionList.length === 0) {
    errors.push("A rule has to do something — add at least one action.");
  }
  if (rawActionList.length > MAX_ACTIONS) {
    errors.push(`A rule can have at most ${MAX_ACTIONS} actions.`);
  }
  for (const raw of rawActionList.slice(0, MAX_ACTIONS)) {
    if (!raw || typeof raw !== "object") {
      errors.push("An action must say what it does.");
      continue;
    }
    const a = raw as Record<string, unknown>;
    if (!isActionType(a.type)) {
      errors.push(`"${String(a.type)}" is not something a rule can do.`);
      continue;
    }
    switch (a.type) {
      case "create_task": {
        const title = typeof a.title === "string" ? a.title.trim() : "";
        if (!title) {
          errors.push("A follow-up task needs a title.");
          break;
        }
        const dueInDays = a.dueInDays === undefined || a.dueInDays === null ? undefined : Number(a.dueInDays);
        if (dueInDays !== undefined && (!Number.isInteger(dueInDays) || dueInDays < 0 || dueInDays > MAX_TRIGGER_DAYS)) {
          errors.push(`A task is due between 0 and ${MAX_TRIGGER_DAYS} days out.`);
          break;
        }
        const priority = a.priority === undefined ? "normal" : a.priority;
        if (priority !== "low" && priority !== "normal" && priority !== "high") {
          errors.push(`"${String(priority)}" is not a priority.`);
          break;
        }
        actions.push({
          type: "create_task",
          title: title.slice(0, 300),
          notes: typeof a.notes === "string" ? a.notes.slice(0, 4000) : undefined,
          dueInDays,
          priority,
          assignee: typeof a.assignee === "string" ? a.assignee : undefined,
        });
        break;
      }
      case "log_activity": {
        const subject = typeof a.subject === "string" ? a.subject.trim() : "";
        if (!subject) {
          errors.push("A timeline entry needs a subject.");
          break;
        }
        actions.push({
          type: "log_activity",
          activityType: typeof a.activityType === "string" ? a.activityType : "note",
          subject: subject.slice(0, 300),
          body: typeof a.body === "string" ? a.body.slice(0, 8000) : undefined,
        });
        break;
      }
      case "set_stage": {
        // Contact rules only. A deal's stage is tied to status, closed_at and
        // probability by check constraints, so the engine refuses to write it
        // and the route that maintains those invariants is buildOpportunityPatch.
        // Until now the validator accepted the action anyway: an admin could
        // save a deal rule that looked fine, watch it fire, and find every run
        // carrying a failed action. A rule that can never do what it says
        // should not be storable.
        if (TRIGGER_ENTITY[triggerType] !== "contact") {
          errors.push(
            "Only a contact rule can move a stage — a deal's stage is tied to its status and close date, so those moves stay on the board.",
          );
          break;
        }
        const stage = typeof a.stage === "string" ? a.stage : "";
        if (!stage) {
          errors.push("Choose the stage to move to.");
          break;
        }
        if (opts.stages && !opts.stages.includes(stage)) {
          errors.push(`"${stage}" is not a stage on this object.`);
          break;
        }
        actions.push({ type: "set_stage", stage });
        break;
      }
      case "set_owner": {
        const ownerId = typeof a.ownerId === "string" ? a.ownerId : "";
        if (!ownerId) {
          errors.push("Choose who to reassign to.");
          break;
        }
        actions.push({ type: "set_owner", ownerId });
        break;
      }
      case "set_field": {
        const key = typeof a.key === "string" ? a.key : "";
        if (!key) {
          errors.push("Choose the column to set.");
          break;
        }
        // Only this org's own columns. Letting a rule write a built-in column
        // through set_field would bypass every invariant the PATCH route
        // enforces — the stage/status/probability rules above all.
        if (opts.customKeys && !opts.customKeys.includes(key)) {
          errors.push(`"${key}" is not one of this workspace's columns.`);
          break;
        }
        actions.push({ type: "set_field", key, value: a.value ?? null });
        break;
      }
      case "add_tag": {
        const tag = typeof a.tag === "string" ? a.tag.trim() : "";
        if (!tag) {
          errors.push("The tag is empty.");
          break;
        }
        actions.push({ type: "add_tag", tag: tag.slice(0, 60) });
        break;
      }
    }
  }

  // A rule whose actions all failed validation is not a rule.
  if (actions.length === 0 && !errors.some((e) => e.startsWith("A rule has to do something"))) {
    errors.push("None of the actions on this rule are usable.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { triggerConfig: config, conditions, actions } };
}

// ── Mapping ──────────────────────────────────────────────────────────────────

/** Row → the shape the API and the UI speak. */
export function mapAutomation(row: Record<string, unknown>): Automation {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: (row.description as string | null) ?? null,
    enabled: row.enabled !== false,
    triggerType: isTriggerType(row.trigger_type) ? row.trigger_type : "opportunity_created",
    triggerConfig:
      row.trigger_config && typeof row.trigger_config === "object"
        ? (row.trigger_config as Record<string, unknown>)
        : {},
    conditions: Array.isArray(row.conditions) ? (row.conditions as Condition[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as Action[]) : [],
    runCount: typeof row.run_count === "number" ? row.run_count : 0,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export type AutomationRun = {
  id: string;
  automationId: string;
  automationName: string | null;
  entityType: "opportunity" | "contact" | "task";
  entityId: string;
  entityLabel: string | null;
  status: "applied" | "skipped" | "failed";
  results: { action: string; ok: boolean; detail?: string }[];
  error: string | null;
  createdAt: string;
};

export function mapAutomationRun(row: Record<string, unknown>): AutomationRun {
  const rule = row.network_automations as { name?: unknown } | null | undefined;
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    automationName: rule && typeof rule.name === "string" ? rule.name : null,
    entityType: (row.entity_type as AutomationRun["entityType"]) ?? "opportunity",
    entityId: String(row.entity_id),
    entityLabel: (row.entity_label as string | null) ?? null,
    status: (row.status as AutomationRun["status"]) ?? "applied",
    results: Array.isArray(row.results) ? (row.results as AutomationRun["results"]) : [],
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** A one-line description of what a rule does, for the list. Built from the
 *  stored shape so it cannot drift from what the rule will actually do. */
export function describeAutomation(automation: Pick<Automation, "triggerType" | "triggerConfig" | "conditions" | "actions">): string {
  const parts: string[] = [];
  const cfg = automation.triggerConfig ?? {};

  let when = TRIGGER_LABEL[automation.triggerType];
  if (isScheduledTrigger(automation.triggerType)) {
    const days = typeof cfg.days === "number" ? cfg.days : TRIGGER_DEFAULT_DAYS[automation.triggerType];
    when =
      automation.triggerType === "close_date_approaching"
        ? `A deal's close date is within ${days} days`
        : `${when} for ${days} days`;
  } else if (typeof cfg.fromStage === "string" || typeof cfg.toStage === "string") {
    const from = typeof cfg.fromStage === "string" ? cfg.fromStage : "any stage";
    const to = typeof cfg.toStage === "string" ? cfg.toStage : "any stage";
    when = `${when}: ${from} → ${to}`;
  }
  parts.push(when);

  if (automation.conditions.length > 0) {
    parts.push(
      `${automation.conditions.length} condition${automation.conditions.length === 1 ? "" : "s"}`,
    );
  }

  parts.push(automation.actions.map((a) => ACTION_LABEL[a.type] ?? a.type).join(", "));
  return parts.join(" · ");
}
