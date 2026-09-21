"use client";

// The rule book, and the run log next to it.
//
// Two decisions shape this panel.
//
// First, it shows what the rules DID, not only what they are. An automation is
// the one feature in a CRM that acts without anybody pressing anything, and
// the question it has to be able to answer is "why did this task appear on my
// queue?". The run log is the answer, so it sits beside the list rather than
// behind a link.
//
// Second, every member can read it. Only admins can change a rule — the API
// and RLS both say so — but hiding the rule book from the people the rules act
// on is how a workspace starts to feel haunted.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTION_LABEL,
  describeAutomation,
  TRIGGER_DEFAULT_DAYS,
  type Action,
  type ActionType,
  type Automation,
  type AutomationRun,
  type Condition,
  type ConditionOp,
  type TriggerType,
} from "@/lib/network-automations";
import type { FieldDef } from "@/lib/network-fields";

type Options = {
  triggers: { value: TriggerType; label: string; entity: string; defaultDays: number | null }[];
  actions: { value: ActionType; label: string }[];
  conditionFields: readonly string[];
  conditionOps: readonly ConditionOp[];
  opportunityStages: readonly string[];
  contactStages: readonly string[];
  customFields: { contact: FieldDef[]; opportunity: FieldDef[] };
  owners: { id: string; name: string }[];
};

const OP_LABEL: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  in: "is one of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const STATUS_TONE: Record<AutomationRun["status"], string> = {
  applied: "text-emerald-300",
  skipped: "text-fg-muted",
  failed: "text-rose-300",
};

/** An instant as a short UTC label. UTC everywhere in this workspace, so a run
 *  stamped 23:40Z is not filed under tomorrow for half the team. */
function when(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

const BLANK_ACTION: Action = { type: "create_task", title: "", dueInDays: 3, priority: "normal" };

export function AutomationsPanel() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Orders reads. Without it a slow first load can land after a refresh that
  // followed a change and put the pre-change list back on screen — the same
  // failure the task queue and the calendar were fixed for.
  const latestRead = useRef(0);

  const load = useCallback(async () => {
    const token = ++latestRead.current;
    setLoading(true);
    try {
      const [rulesRes, runsRes] = await Promise.all([
        fetch("/api/network/automations"),
        fetch("/api/network/automations/runs?limit=25"),
      ]);
      if (!rulesRes.ok) {
        const body = await rulesRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not read the rules.");
      }
      const rules = await rulesRes.json();
      // The run log is secondary: a workspace whose rules load fine should not
      // report itself broken because the history query failed.
      const runBody = runsRes.ok ? await runsRes.json().catch(() => ({ runs: [] })) : { runs: [] };

      if (token !== latestRead.current) return;
      setAutomations(rules.automations ?? []);
      setOptions(rules.options ?? null);
      setCanManage(Boolean(rules.canManage));
      setRuns(runBody.runs ?? []);
      setError(null);
    } catch (err) {
      if (token !== latestRead.current) return;
      setError(err instanceof Error ? err.message : "Could not read the rules.");
    } finally {
      if (token === latestRead.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rule: Automation) {
    setBusy(rule.id);
    // Optimistic on this row only — a whole-list snapshot rollback would undo
    // a concurrent change somebody else made while this request was in flight.
    const previous = rule.enabled;
    setAutomations((list) =>
      list.map((a) => (a.id === rule.id ? { ...a, enabled: !previous } : a)),
    );
    try {
      const res = await fetch("/api/network/automations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: !previous }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not change the rule.");
      }
      const body = await res.json();
      setAutomations((list) => list.map((a) => (a.id === rule.id ? body.automation : a)));
    } catch (err) {
      setAutomations((list) =>
        list.map((a) => (a.id === rule.id ? { ...a, enabled: previous } : a)),
      );
      setError(err instanceof Error ? err.message : "Could not change the rule.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(rule: Automation) {
    if (!window.confirm(`Delete "${rule.name}"? What it has already done stays in the run log.`)) {
      return;
    }
    setBusy(rule.id);
    try {
      const res = await fetch(`/api/network/automations?id=${encodeURIComponent(rule.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not delete the rule.");
      }
      setAutomations((list) => list.filter((a) => a.id !== rule.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the rule.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg-primary">Automations</h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            Rules that raise the follow-up, write the timeline entry, or flag the relationship
            without anyone having to remember. Every firing is recorded below, including the ones
            that did nothing.
          </p>
        </div>
        {canManage && !building && (
          <button
            type="button"
            onClick={() => setBuilding(true)}
            className="rounded-md bg-accent-500/15 px-3 py-1.5 text-sm font-medium text-accent-200 hover:bg-accent-500/25"
          >
            New rule
          </button>
        )}
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
            disabled={loading}
            className="rounded px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Retry"}
          </button>
        </div>
      )}

      {building && options && (
        <RuleBuilder
          options={options}
          onCancel={() => setBuilding(false)}
          onCreated={(created) => {
            setBuilding(false);
            setAutomations((list) => [created, ...list]);
          }}
        />
      )}

      <section className="flex flex-col gap-2">
        {loading && automations.length === 0 && (
          <p className="text-sm text-fg-muted">Reading the rules…</p>
        )}

        {!loading && automations.length === 0 && !error && (
          <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-6 text-sm text-fg-secondary">
            <p className="font-medium text-fg-primary">No rules yet.</p>
            <p className="mt-1">
              A first one worth having: when a deal has had no activity for three weeks, raise a
              follow-up for whoever owns it.
            </p>
          </div>
        )}

        {automations.map((rule) => (
          <article
            key={rule.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border-subtle bg-surface-1 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    rule.enabled ? "bg-emerald-400" : "bg-fg-muted/40"
                  }`}
                />
                <h3 className="truncate text-sm font-medium text-fg-primary">{rule.name}</h3>
                {!rule.enabled && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted">
                    Off
                  </span>
                )}
              </div>
              {rule.description && (
                <p className="mt-1 text-sm text-fg-secondary">{rule.description}</p>
              )}
              {/* Built from the stored rule, so it cannot describe something
                  other than what will actually run. */}
              <p className="mt-1 font-mono text-[11px] text-fg-muted">{describeAutomation(rule)}</p>
              <p className="mt-1 text-[11px] text-fg-muted">
                Fired {rule.runCount} {rule.runCount === 1 ? "time" : "times"} · last{" "}
                {when(rule.lastRunAt)}
              </p>
              {rule.lastError && (
                <p className="mt-1 text-[11px] text-rose-300">Last run reported: {rule.lastError}</p>
              )}
            </div>

            {canManage && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggle(rule)}
                  disabled={busy === rule.id}
                  aria-pressed={rule.enabled}
                  className="rounded-md border border-border-subtle px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
                >
                  {rule.enabled ? "Turn off" : "Turn on"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(rule)}
                  disabled={busy === rule.id}
                  className="rounded-md px-2.5 py-1 text-xs text-fg-muted hover:text-rose-300 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          Recent runs
        </h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            Nothing has fired yet. A rule that is switched on but never appears here is not
            matching anything.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-border-subtle/60 bg-surface-1 px-3 py-2 text-sm"
              >
                <span className={`font-medium ${STATUS_TONE[run.status]}`}>
                  {run.status === "applied"
                    ? "Applied"
                    : run.status === "skipped"
                      ? "No match"
                      : "Failed"}
                </span>
                <span className="text-fg-secondary">{run.automationName ?? "a rule"}</span>
                <span className="text-fg-muted">on</span>
                <span className="truncate text-fg-secondary">{run.entityLabel ?? run.entityId}</span>
                <span className="ml-auto font-mono text-[11px] text-fg-muted">
                  {when(run.createdAt)}
                </span>
                {run.error && <p className="w-full text-[11px] text-rose-300">{run.error}</p>}
                {run.status === "applied" && run.results.length > 0 && (
                  <p className="w-full text-[11px] text-fg-muted">
                    {run.results
                      .map((r) => `${ACTION_LABEL[r.action as ActionType] ?? r.action}${r.ok ? "" : " (failed)"}`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── The builder ──────────────────────────────────────────────────────────────

/**
 * One rule, built in place.
 *
 * Deliberately not a wizard. A rule is three sentences — when this, and if
 * that, do these — and putting them on one screen is what lets somebody read
 * the whole thing back before switching it on. New rules are created switched
 * OFF by the API for the same reason.
 */
function RuleBuilder({
  options,
  onCancel,
  onCreated,
}: {
  options: Options;
  onCancel: () => void;
  onCreated: (automation: Automation) => void;
}) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("opportunity_stage_changed");
  const [days, setDays] = useState(21);
  const [toStage, setToStage] = useState("");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([BLANK_ACTION]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = options.triggers.find((t) => t.value === triggerType);
  const isScheduled = trigger?.defaultDays != null;
  const entity = trigger?.entity ?? "opportunity";
  const stages = entity === "contact" ? options.contactStages : options.opportunityStages;
  const customFields =
    entity === "contact" ? options.customFields.contact : options.customFields.opportunity;

  function changeTrigger(next: TriggerType) {
    setTriggerType(next);
    // The stage lists differ between objects, so a stage picked for a deal
    // rule is not a valid answer for a contact rule. Clearing it beats
    // submitting a value the validator will refuse.
    setToStage("");
    setConditions([]);
    const fallback = TRIGGER_DEFAULT_DAYS[next as keyof typeof TRIGGER_DEFAULT_DAYS];
    if (fallback) setDays(fallback);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/network/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          triggerType,
          triggerConfig: isScheduled ? { days } : toStage ? { toStage } : {},
          conditions,
          actions,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the rule.");
      onCreated(body.automation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-accent-500/30 bg-surface-1 px-4 py-4"
    >
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          placeholder="Chase deals that go quiet"
          className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-fg-primary"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            When
          </span>
          <select
            value={triggerType}
            onChange={(e) => changeTrigger(e.target.value as TriggerType)}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-fg-primary"
          >
            {options.triggers.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {isScheduled ? (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
              After how many days
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-fg-primary"
            />
          </label>
        ) : (
          triggerType.endsWith("stage_changed") && (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Moving into (any stage if blank)
              </span>
              <select
                value={toStage}
                onChange={(e) => setToStage(e.target.value)}
                className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-fg-primary"
              >
                <option value="">Any stage</option>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
      </div>

      {/* Conditions */}
      <fieldset className="flex flex-col gap-2">
        <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          Only if (all must hold)
        </legend>
        {conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              value={condition.field}
              onChange={(e) =>
                setConditions((list) =>
                  list.map((c, i) => (i === index ? { ...c, field: e.target.value } : c)),
                )
              }
              aria-label="Field"
              className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
            >
              {options.conditionFields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {customFields.map((f) => (
                <option key={f.key} value={`custom.${f.key}`}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={condition.op}
              onChange={(e) =>
                setConditions((list) =>
                  list.map((c, i) => {
                    if (i !== index) return c;
                    const op = e.target.value as ConditionOp;
                    // The stored shape depends on the operator, so switching
                    // between `in` and the rest has to convert what is already
                    // typed rather than leave a string where an array belongs.
                    if (op === "in" && !Array.isArray(c.value)) {
                      const text = String(c.value ?? "").trim();
                      return { ...c, op, value: text ? [text] : [] };
                    }
                    if (op !== "in" && Array.isArray(c.value)) {
                      return { ...c, op, value: (c.value as unknown[]).join(", ") };
                    }
                    return { ...c, op };
                  }),
                )
              }
              aria-label="Test"
              className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
            >
              {options.conditionOps.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op] ?? op}
                </option>
              ))}
            </select>
            {condition.op !== "is_empty" && condition.op !== "is_not_empty" && (
              <input
                // `in` is stored as an array — the API refuses a string for it,
                // so every "is one of" condition built here used to be rejected
                // on save. Typed as a comma-separated list and split on the way
                // into state; joined back for display so the field stays
                // editable.
                value={
                  Array.isArray(condition.value)
                    ? (condition.value as unknown[]).join(", ")
                    : String(condition.value ?? "")
                }
                onChange={(e) =>
                  setConditions((list) =>
                    list.map((c, i) =>
                      i === index
                        ? {
                            ...c,
                            value:
                              c.op === "in"
                                ? e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                : e.target.value,
                          }
                        : c,
                    ),
                  )
                }
                aria-label="Value"
                placeholder={condition.op === "in" ? "diligence, ic_review" : undefined}
                className="min-w-[8rem] flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              />
            )}
            <button
              type="button"
              onClick={() => setConditions((list) => list.filter((_, i) => i !== index))}
              className="rounded px-2 py-1 text-xs text-fg-muted hover:text-rose-300"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setConditions((list) => [...list, { field: "stage", op: "eq", value: "" }])
          }
          className="self-start rounded-md border border-border-subtle px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
        >
          Add a condition
        </button>
      </fieldset>

      {/* Actions */}
      <fieldset className="flex flex-col gap-3">
        <legend className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          Then
        </legend>
        {actions.map((action, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-md border border-border-subtle/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <select
                value={action.type}
                onChange={(e) => {
                  const type = e.target.value as ActionType;
                  setActions((list) =>
                    list.map((a, i) =>
                      i === index ? (blankAction(type) as Action) : a,
                    ),
                  );
                }}
                aria-label="Action"
                className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              >
                {options.actions
                  // set_stage only moves a CONTACT's stage — the validator and
                  // the engine both refuse it elsewhere. Offering it on a deal
                  // rule meant picking it, getting no stage control, and being
                  // told to choose a stage that was never on screen.
                  .filter((a) => a.value !== "set_stage" || entity === "contact")
                  .map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
              </select>
              {actions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setActions((list) => list.filter((_, i) => i !== index))}
                  className="ml-auto rounded px-2 py-1 text-xs text-fg-muted hover:text-rose-300"
                >
                  Remove
                </button>
              )}
            </div>

            {action.type === "create_task" && (
              <div className="flex flex-wrap gap-2">
                <input
                  value={action.title}
                  onChange={(e) =>
                    setActions((list) =>
                      list.map((a, i) =>
                        i === index && a.type === "create_task" ? { ...a, title: e.target.value } : a,
                      ),
                    )
                  }
                  placeholder="Follow up on {{name}}"
                  aria-label="Task title"
                  className="min-w-[14rem] flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
                />
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={action.dueInDays ?? 3}
                  onChange={(e) =>
                    setActions((list) =>
                      list.map((a, i) =>
                        i === index && a.type === "create_task"
                          ? { ...a, dueInDays: Number(e.target.value) }
                          : a,
                      ),
                    )
                  }
                  aria-label="Due in days"
                  className="w-24 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
                />
              </div>
            )}

            {action.type === "log_activity" && (
              <input
                value={action.subject}
                onChange={(e) =>
                  setActions((list) =>
                    list.map((a, i) =>
                      i === index && a.type === "log_activity"
                        ? { ...a, subject: e.target.value }
                        : a,
                    ),
                  )
                }
                placeholder="{{name}} went quiet for {{days}} days"
                aria-label="Entry subject"
                className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              />
            )}

            {action.type === "add_tag" && (
              <input
                value={action.tag}
                onChange={(e) =>
                  setActions((list) =>
                    list.map((a, i) =>
                      i === index && a.type === "add_tag" ? { ...a, tag: e.target.value } : a,
                    ),
                  )
                }
                placeholder="at-risk"
                aria-label="Tag"
                className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              />
            )}

            {action.type === "set_field" && (
              <div className="flex flex-wrap gap-2">
                <select
                  value={action.key}
                  onChange={(e) =>
                    setActions((list) =>
                      list.map((a, i) =>
                        i === index && a.type === "set_field" ? { ...a, key: e.target.value } : a,
                      ),
                    )
                  }
                  aria-label="Column"
                  className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
                >
                  <option value="">Choose a column…</option>
                  {customFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  value={String(action.value ?? "")}
                  onChange={(e) =>
                    setActions((list) =>
                      list.map((a, i) =>
                        i === index && a.type === "set_field" ? { ...a, value: e.target.value } : a,
                      ),
                    )
                  }
                  aria-label="Value"
                  className="min-w-[8rem] flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
                />
                {customFields.length === 0 && (
                  <p className="w-full text-[11px] text-fg-muted">
                    This workspace has no columns of its own yet. Add one under Columns first.
                  </p>
                )}
              </div>
            )}

            {(action.type === "set_stage" || action.type === "set_owner") && (
              <p className="text-[11px] text-fg-muted">
                {action.type === "set_stage"
                  ? "A rule can move a contact's stage. A deal's stage is tied to its status and close date, so those moves stay on the board."
                  : "Who this row should belong to afterwards."}
              </p>
            )}
            {action.type === "set_stage" && entity === "contact" && (
              <select
                value={action.stage}
                onChange={(e) =>
                  setActions((list) =>
                    list.map((a, i) =>
                      i === index && a.type === "set_stage" ? { ...a, stage: e.target.value } : a,
                    ),
                  )
                }
                aria-label="Stage"
                className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              >
                <option value="">Choose a stage…</option>
                {options.contactStages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            {action.type === "set_owner" && (
              <select
                value={action.ownerId}
                onChange={(e) =>
                  setActions((list) =>
                    list.map((a, i) =>
                      i === index && a.type === "set_owner" ? { ...a, ownerId: e.target.value } : a,
                    ),
                  )
                }
                aria-label="Reassign to"
                className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
              >
                <option value="">Choose a teammate…</option>
                {(options.owners ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        {actions.length < 5 && (
          <button
            type="button"
            onClick={() => setActions((list) => [...list, blankAction("create_task")])}
            className="self-start rounded-md border border-border-subtle px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
          >
            Add an action
          </button>
        )}
      </fieldset>

      <p className="text-[11px] text-fg-muted">
        Text can use <code>{"{{name}}"}</code>, <code>{"{{stage}}"}</code>,{" "}
        <code>{"{{amount}}"}</code>, <code>{"{{close_date}}"}</code>, <code>{"{{owner}}"}</code> and{" "}
        <code>{"{{days}}"}</code>. New rules are created switched off — read it back, then turn it
        on.
      </p>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent-500/15 px-3 py-1.5 text-sm font-medium text-accent-200 hover:bg-accent-500/25 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A fresh action of the chosen type. Switching the type replaces the whole
 *  action rather than merging, so a half-filled create_task cannot leave a
 *  stray title on a set_owner the API would then refuse. */
function blankAction(type: ActionType): Action {
  switch (type) {
    case "create_task":
      return { type: "create_task", title: "", dueInDays: 3, priority: "normal" };
    case "log_activity":
      return { type: "log_activity", subject: "" };
    case "set_stage":
      return { type: "set_stage", stage: "" };
    case "set_owner":
      return { type: "set_owner", ownerId: "" };
    case "set_field":
      return { type: "set_field", key: "", value: "" };
    case "add_tag":
      return { type: "add_tag", tag: "" };
    default:
      return BLANK_ACTION;
  }
}
