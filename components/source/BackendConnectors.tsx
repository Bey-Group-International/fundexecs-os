"use client";

// Backend connector panel for the Professional Network Import tab.
//
// Backend connectors (Google Contacts, official LinkedIn API, future CRM) are
// the PRIMARY sync path; CSV stays the visible fallback below this panel. Each
// connector is honest about availability: when provider credentials are not yet
// configured it shows a "pending authorization" reason instead of a broken
// button. Connect/Sync call the /api/professional-network/* routes.

import { useCallback, useEffect, useState } from "react";

type LastSync = {
  status: string;
  syncType: string;
  recordsSeen: number;
  recordsCreated: number;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ConnectorStatus = {
  provider: string;
  label: string;
  available: boolean;
  reason: string | null;
  lastSync: LastSync | null;
};

const STATUS_TONE: Record<string, string> = {
  completed: "text-emerald-400",
  running: "text-accent",
  queued: "text-fg-muted",
  paused: "text-amber-400",
  failed: "text-rose-400",
};

export function BackendConnectors() {
  const [connectors, setConnectors] = useState<ConnectorStatus[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ provider: string; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/professional-network/status");
    if (res.ok) {
      const data = await res.json();
      setConnectors(data.connectors ?? []);
    } else {
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConnect(provider: string) {
    setBusy(provider);
    setNote(null);
    try {
      const res = await fetch("/api/professional-network/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.connectUrl) {
        window.location.href = data.connectUrl as string;
        return;
      }
      setNote({
        provider,
        text: data.reason ?? "This connector needs no interactive step yet.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleSync(provider: string) {
    setBusy(provider);
    setNote(null);
    try {
      const res = await fetch("/api/professional-network/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (data.pending) {
        setNote({ provider, text: data.reason ?? "Sync is pending provider authorization." });
      } else if (data.ok) {
        setNote({ provider, text: "Sync complete." });
      } else {
        setNote({ provider, text: data.error ?? "Sync failed." });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!connectors) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-fg-muted">
        Loading backend connectors…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-fg text-sm">Backend connectors</p>
          <p className="text-xs text-fg-muted">
            Primary sync path — permission-first, server-side. CSV below is the fallback.
          </p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-line">
        {connectors.map((c) => {
          const tone = c.lastSync ? STATUS_TONE[c.lastSync.status] ?? "text-fg-muted" : "text-fg-muted";
          const isBusy = busy === c.provider;
          return (
            <div key={c.provider} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-fg text-sm">{c.label}</p>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider ${
                        c.available
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      {c.available ? "Available" : "Pending"}
                    </span>
                  </div>
                  {!c.available && c.reason && (
                    <p className="mt-1 text-xs text-fg-muted">{c.reason}</p>
                  )}
                  {c.lastSync && (
                    <p className="mt-1 text-xs text-fg-muted">
                      Last sync:{" "}
                      <span className={tone}>{c.lastSync.status}</span>
                      {c.lastSync.status === "completed" && (
                        <> · {c.lastSync.recordsCreated.toLocaleString()} added</>
                      )}
                      {c.lastSync.errorMessage && <> · {c.lastSync.errorMessage}</>}
                    </p>
                  )}
                  {note?.provider === c.provider && (
                    <p className="mt-1 text-xs text-accent">{note.text}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => handleConnect(c.provider)}
                    disabled={isBusy}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted hover:text-fg hover:border-fg-muted/40 transition-colors disabled:opacity-50"
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => handleSync(c.provider)}
                    disabled={isBusy}
                    className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                  >
                    {isBusy ? "Working…" : "Sync"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
