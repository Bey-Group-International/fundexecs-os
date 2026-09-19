"use client";

// Saved views — named segments of the roster.
//
// /api/network/views has existed since the CRM spine landed and nothing called
// it, so the feature was built and unreachable. This is the surface for it.
//
// A view stores the FILTER, not the rows it matched. Reopening "German LPs in
// diligence" next quarter re-runs the query rather than replaying a frozen list,
// which is the difference between a saved view and a stale export.

import { useCallback, useEffect, useState } from "react";

export interface SavedView {
  id: string;
  name: string;
  description: string | null;
  filters: Record<string, unknown>;
  sort: string;
  isShared: boolean;
  isMine: boolean;
  createdAt: string;
}

interface Props {
  /** The query string describing what is on screen now. */
  currentQuery: string;
  /** Apply a stored view's filters to the workspace. */
  onApply: (view: SavedView) => void;
  /** The id of the view currently applied, if any. */
  activeId: string | null;
  onClearActive: () => void;
}

export function SavedViewBar({ currentQuery, onApply, activeId, onClearActive }: Props) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/network/views", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { views?: SavedView[] };
      setViews(body.views ?? []);
    } catch {
      // A workspace whose saved views cannot be listed should still be usable.
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/network/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, query: currentQuery, isShared: shared }),
      });
      const body = (await res.json().catch(() => null)) as
        | { view?: SavedView; error?: string }
        | null;
      if (!res.ok || !body?.view) throw new Error(body?.error ?? "Couldn't save that view.");
      // Upsert by (org, creator, name), so saving over an existing name
      // replaces it rather than adding a duplicate.
      setViews((prev) => [body.view!, ...prev.filter((v) => v.id !== body.view!.id)]);
      setName("");
      setNaming(false);
      setShared(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that view.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (view: SavedView) => {
    const before = views;
    setViews((prev) => prev.filter((v) => v.id !== view.id));
    if (activeId === view.id) onClearActive();
    try {
      const res = await fetch(`/api/network/views?id=${encodeURIComponent(view.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setViews(before);
      setError("Couldn't delete that view.");
    }
  };

  if (loading && views.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((view) => (
            <span
              key={view.id}
              className={`group inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                activeId === view.id
                  ? "border-gold-500/50 bg-gold-500/10 text-gold-200"
                  : "border-line text-fg-muted hover:text-fg-primary"
              }`}
            >
              <button onClick={() => onApply(view)} title={view.description ?? undefined}>
                {view.name}
              </button>
              {view.isShared && (
                <span className="text-[10px] text-fg-muted/70" title="Shared with the organization">
                  ◇
                </span>
              )}
              {view.isMine && (
                <button
                  onClick={() => void remove(view)}
                  aria-label={`Delete the ${view.name} view`}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {activeId && (
            <button
              onClick={onClearActive}
              className="text-xs text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {naming ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="Name this view…"
            className="fx-focus w-44 rounded-lg border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted"
          />
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="fx-focus h-3 w-3 rounded border-line accent-gold-400"
            />
            Share
          </label>
          <button
            onClick={() => void save()}
            disabled={saving || !name.trim()}
            className="fx-btn-secondary text-xs disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setNaming(false)}
            className="text-xs text-fg-muted transition hover:text-fg-primary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="text-xs text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline"
        >
          + Save this view
        </button>
      )}

      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
