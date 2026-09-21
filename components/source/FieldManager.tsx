"use client";

// The org's own columns — the editor for them.
//
// network_field_defs and /api/network/fields have existed since Phase 1. The
// table view already renders whatever an org has defined, validates writes
// against the declared type, and stores the values. What was missing was any
// way to declare one: the API had no caller, so every workspace ran on the
// built-in columns and the feature was unreachable. This is the front door.
//
// Retiring a column ARCHIVES it. The values already recorded against it stay
// in each row's jsonb, and the wording here says so, because "delete" next to
// a column somebody spent a quarter filling in should not be ambiguous about
// what it destroys.

import { useCallback, useEffect, useRef, useState } from "react";
import { FIELD_TYPES, type FieldDef, type FieldEntity, type FieldType } from "@/lib/network-fields";

const ENTITY_LABEL: Record<FieldEntity, string> = {
  contact: "Relationships",
  opportunity: "Deals",
};

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency",
  percent: "Percent",
  date: "Date",
  boolean: "Yes / no",
  select: "One of a list",
  multi_select: "Several of a list",
  url: "Link",
  email: "Email",
};

const NEEDS_OPTIONS = new Set<FieldType>(["select", "multi_select"]);

export function FieldManager() {
  const [fields, setFields] = useState<{ contact: FieldDef[]; opportunity: FieldDef[] }>({
    contact: [],
    opportunity: [],
  });
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Same read-ordering token the rest of this workspace uses: a slow first
  // load must not land after a later refresh and restore a retired column.
  const latestRead = useRef(0);

  const load = useCallback(async () => {
    const token = ++latestRead.current;
    setLoading(true);
    try {
      const res = await fetch("/api/network/fields");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not read this workspace's columns.");
      }
      const body = await res.json();
      if (token !== latestRead.current) return;
      setFields(body.fields ?? { contact: [], opportunity: [] });
      setCanManage(Boolean(body.canManage));
      setError(null);
    } catch (err) {
      if (token !== latestRead.current) return;
      setError(err instanceof Error ? err.message : "Could not read this workspace's columns.");
    } finally {
      if (token === latestRead.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retire(field: FieldDef) {
    if (
      !window.confirm(
        `Retire "${field.label}"? It stops appearing and stops accepting new values. ` +
          `Everything already recorded against it is kept.`,
      )
    ) {
      return;
    }
    setBusy(field.id);
    const entity = field.entity;
    // Per-item optimistic removal, reverted per item. A whole-snapshot
    // rollback would discard a column somebody else added in the meantime.
    setFields((current) => ({
      ...current,
      [entity]: current[entity].filter((f) => f.id !== field.id),
    }));
    try {
      const res = await fetch(`/api/network/fields?id=${encodeURIComponent(field.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not retire the column.");
      }
    } catch (err) {
      setFields((current) => ({
        ...current,
        [entity]: [...current[entity], field].sort((a, b) => a.position - b.position),
      }));
      setError(err instanceof Error ? err.message : "Could not retire the column.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold text-fg-primary">Columns</h2>
        <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
          Whatever this firm tracks that the next one does not — an AUM band, a consultant, an
          investment-committee date. Columns defined here appear on the table view, can be filtered
          and sorted, and can be read and written by automation rules.
        </p>
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

      {(["opportunity", "contact"] as FieldEntity[]).map((entity) => (
        <section key={entity} className="flex flex-col gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            {ENTITY_LABEL[entity]}
          </h3>

          {fields[entity].length === 0 ? (
            <p className="text-sm text-fg-muted">
              {loading ? "Reading…" : "No columns of your own on this object yet."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {fields[entity].map((field) => (
                <li
                  key={field.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-surface-1 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-fg-primary">{field.label}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                    {field.key}
                  </span>
                  <span className="text-fg-muted">{TYPE_LABEL[field.type] ?? field.type}</span>
                  {field.required && (
                    <span className="text-[11px] text-gold-300">Required</span>
                  )}
                  {field.options.length > 0 && (
                    <span className="truncate text-[11px] text-fg-muted">
                      {field.options.join(" · ")}
                    </span>
                  )}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void retire(field)}
                      disabled={busy === field.id}
                      className="ml-auto rounded px-2 py-1 text-xs text-fg-muted hover:text-rose-300 disabled:opacity-50"
                    >
                      Retire
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <NewFieldForm
              entity={entity}
              onCreated={(field) =>
                setFields((current) => ({ ...current, [entity]: [...current[entity], field] }))
              }
            />
          )}
        </section>
      ))}

      {!canManage && !loading && (
        <p className="text-sm text-fg-muted">
          Only organization admins can add or retire columns.
        </p>
      )}
    </div>
  );
}

/** One column, added inline under the list it belongs to. */
function NewFieldForm({
  entity,
  onCreated,
}: {
  entity: FieldEntity;
  onCreated: (field: FieldDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [optionText, setOptionText] = useState("");
  const [required, setRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLabel("");
    setType("text");
    setOptionText("");
    setRequired(false);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/network/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          label,
          type,
          // One per line is easier to get right than a comma-separated string
          // when an option legitimately contains a comma.
          options: NEEDS_OPTIONS.has(type)
            ? optionText
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
          required,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not add the column.");
      onCreated(body.field);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the column.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md border border-border-subtle px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
      >
        Add a column
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-accent-500/30 bg-surface-1 px-3 py-3"
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={120}
          placeholder={entity === "contact" ? "Consultant" : "IC date"}
          aria-label="Column name"
          className="min-w-[12rem] flex-1 rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
          aria-label="Column type"
          className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      {NEEDS_OPTIONS.has(type) && (
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            Choices, one per line
          </span>
          <textarea
            value={optionText}
            onChange={(e) => setOptionText(e.target.value)}
            rows={4}
            required
            className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm text-fg-primary"
          />
        </label>
      )}

      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
          className="rounded border-border-subtle"
        />
        Every new record must have a value
      </label>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent-500/15 px-3 py-1.5 text-sm font-medium text-accent-200 hover:bg-accent-500/25 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add column"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
