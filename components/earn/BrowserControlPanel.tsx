"use client";

import { useCallback, useState } from "react";
import {
  describeAuditEvent,
  isTerminalStatus,
  type BrowserTaskScope,
  type EarnBrowserSessionStatus,
  type ExtractedDataPoint,
} from "@/lib/earn/browser-operator";
import type { EarnBrowserAuditLog, EarnBrowserSession } from "@/lib/supabase/database.types";
import { AuthHandoffNotice } from "./AuthHandoffNotice";
import { ExtractionReviewQueue } from "./ExtractionReviewQueue";
import { SaveToSystemApproval } from "./SaveToSystemApproval";

// BrowserControlPanel — the operator's cockpit for a controlled browser session.
// It shows live status, the approved scope, the current source/URL, and the
// stop/resume controls. It composes the auth-handoff notice, the review queue,
// and the save-approval gate. Live extraction is a seam (the /extract route
// returns pending), so the review queue starts empty until the driver lands.

const STATUS_STYLE: Record<string, string> = {
  awaiting_user_approval: "border-gold-500/50 text-gold-400",
  paused_for_user_auth: "border-gold-500/50 text-gold-400",
  awaiting_user_review: "border-accent/50 text-accent",
  saved: "border-status-success/50 text-status-success",
  cancelled: "border-line text-fg-muted",
  rejected: "border-status-danger/50 text-status-danger",
  failed: "border-status-danger/50 text-status-danger",
};

function statusBadge(status: string): string {
  return STATUS_STYLE[status] ?? "border-accent/40 text-accent";
}

type SessionView = {
  session: EarnBrowserSession;
  scope: BrowserTaskScope | null;
  audit: EarnBrowserAuditLog[];
};

export function BrowserControlPanel() {
  const [prompt, setPrompt] = useState("");
  const [view, setView] = useState<SessionView | null>(null);
  const [extracted] = useState<ExtractedDataPoint[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = (view?.session.status ?? null) as EarnBrowserSessionStatus | null;

  const refresh = useCallback(async (id: string) => {
    const res = await fetch(`/api/earn/browser/session-status?id=${id}`);
    const body = await res.json().catch(() => null);
    if (res.ok && body?.session) {
      setView({
        session: body.session,
        scope: (body.session.approved_scope as BrowserTaskScope | null) ?? null,
        audit: body.audit ?? [],
      });
    }
  }, []);

  async function start() {
    if (!prompt.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/earn/browser/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.sessionId) {
        setError(body?.error ?? "Could not start the session.");
        return;
      }
      await refresh(body.sessionId);
    } finally {
      setPending(false);
    }
  }

  async function act(path: "resume" | "cancel" | "complete") {
    if (!view) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/earn/browser/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: view.session.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Could not ${path} the session.`);
      }
      await refresh(view.session.id);
    } finally {
      setPending(false);
    }
  }

  // ── Empty state: prompt entry ──────────────────────────────────────────────
  if (!view) {
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted">What should Earn research?</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. Research the LP behind Cedar Ridge on LinkedIn and pull their latest EDGAR filing"
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        {error && <p className="mt-2 text-xs text-status-danger">{error}</p>}
        <button
          type="button"
          onClick={start}
          disabled={pending || !prompt.trim()}
          className="mt-3 rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {pending ? "Proposing scope…" : "Propose a scope"}
        </button>
        <p className="mt-3 text-[11px] text-fg-muted">
          Earn proposes a scope card first. Nothing opens a browser until you
          approve it.
        </p>
      </div>
    );
  }

  const { session, scope, audit } = view;
  const terminal = isTerminalStatus(session.status as EarnBrowserSessionStatus);

  return (
    <div className="flex flex-col gap-4">
      {/* Status + controls */}
      <div className="rounded-2xl border border-line bg-surface-1 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg-muted">{session.requested_prompt}</p>
            <span
              className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${statusBadge(
                session.status,
              )}`}
            >
              {session.status.replace(/_/g, " ")}
            </span>
          </div>
          {!terminal && (
            <button
              type="button"
              onClick={() => act("cancel")}
              disabled={pending}
              className="rounded-md border border-status-danger/50 px-3 py-1.5 text-xs text-status-danger transition hover:bg-status-danger/10 disabled:opacity-50"
            >
              Stop
            </button>
          )}
        </div>

        {session.current_url && (
          <p className="mt-3 font-mono text-[11px] text-accent">{session.current_url}</p>
        )}

        {scope && (
          <div className="mt-4 grid gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[12px]">
            <div>
              <span className="text-fg-muted">Sources: </span>
              <span className="text-fg">{scope.permitted_sources.join(", ")}</span>
            </div>
            <div>
              <span className="text-fg-muted">Allowed: </span>
              <span className="text-fg">{scope.permitted_actions.join(", ")}</span>
            </div>
            <div>
              <span className="text-fg-muted">Never: </span>
              <span className="text-status-danger">{scope.prohibited_actions.join(", ")}</span>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-status-danger">{error}</p>}
      </div>

      {/* Auth handoff */}
      {status === "paused_for_user_auth" && (
        <AuthHandoffNotice
          sourceLabel={scope?.permitted_sources.join(", ")}
          pending={pending}
          onResume={() => act("resume")}
          onCancel={() => act("cancel")}
        />
      )}

      {/* Review + save gates */}
      {(status === "awaiting_user_review" || status === "extracting" || status === "normalizing") && (
        <ExtractionReviewQueue points={extracted} />
      )}

      {status === "approved_for_save" && (
        <SaveToSystemApproval
          approvedFieldCount={extracted.length}
          destinationLabel="your professional network"
          pending={pending}
          onConfirmSave={() => act("complete")}
          onCancel={() => act("cancel")}
        />
      )}

      {/* Audit trail */}
      <div className="rounded-2xl border border-line bg-surface-1 p-5">
        <h3 className="text-sm font-semibold text-fg">Audit trail</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {audit.length === 0 && <li className="text-xs text-fg-muted">No events yet.</li>}
          {audit.map((row) => (
            <li key={row.id} className="flex items-start gap-2 text-[12px]">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="text-fg-muted">
                {describeAuditEvent({
                  action: row.action as Parameters<typeof describeAuditEvent>[0]["action"],
                  url: row.url,
                  source_type: row.source_type as never,
                  summary: row.summary,
                })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
