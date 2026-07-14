"use client";

import { useState } from "react";
import {
  saveMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  type McpServerView,
  type McpActionResult,
} from "./mcp-actions";
import { MCP_TRANSPORTS, MCP_TRANSPORT_LABELS } from "@/lib/mcp/registry";

// Register and manage custom MCP (Model Context Protocol) servers for the org.
// Registry-only: this stores the connection details (name, transport, URL, and
// an optional bearer token encrypted in the vault). The token is write-only —
// the panel shows a masked last-4 and "leave blank to keep" on edit, never the
// plaintext.
export function McpServersPanel({
  servers,
  vaultReady,
}: {
  servers: McpServerView[];
  vaultReady: boolean;
}) {
  // Manual busy flag rather than useTransition: isPending can drop to false
  // after the action's first await and allow a duplicate submit.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `editing` is null (list view), "new" (add form), or a server id (edit form).
  const [editing, setEditing] = useState<string | null>(null);

  const run = async (action: (fd: FormData) => Promise<McpActionResult>, fd: FormData) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await action(fd);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setEditing(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger"
        >
          {error}
        </p>
      ) : null}

      {servers.length === 0 && editing !== "new" ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-4 text-xs leading-snug text-fg-muted">
          No MCP servers registered yet. Add a remote (HTTP or SSE) server so your workspace has its
          connection details on file.
        </p>
      ) : null}

      {servers.map((server) =>
        editing === server.id ? (
          <McpServerForm
            key={server.id}
            server={server}
            vaultReady={vaultReady}
            pending={pending}
            onCancel={() => setEditing(null)}
            onSubmit={(fd) => run(saveMcpServer, fd)}
          />
        ) : (
          <div key={server.id} className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg-primary">{server.name}</span>
                  <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                    {MCP_TRANSPORT_LABELS[server.transport]}
                  </span>
                  {server.enabled ? (
                    <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                      Enabled
                    </span>
                  ) : (
                    <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-fg-secondary">{server.url}</p>
                <p className="mt-0.5 text-[11px] text-fg-muted">
                  {server.hasToken ? (
                    <>
                      Auth: <span className="font-mono">{server.authHeader}</span> ••••
                      {server.tokenLast4}
                    </>
                  ) : (
                    "No auth token"
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <form action={(fd) => run(toggleMcpServer, fd)}>
                  <input type="hidden" name="id" value={server.id} />
                  <input type="hidden" name="enabled" value={server.enabled ? "0" : "1"} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </button>
                </form>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setEditing(server.id);
                  }}
                  className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
                >
                  Edit
                </button>
                <form action={(fd) => run(deleteMcpServer, fd)}>
                  <input type="hidden" name="id" value={server.id} />
                  <button
                    type="submit"
                    disabled={pending}
                    onClick={(e) => {
                      if (!window.confirm(`Remove the "${server.name}" MCP server registration?`)) {
                        e.preventDefault();
                      }
                    }}
                    className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
                  >
                    Remove
                  </button>
                </form>
              </div>
            </div>
          </div>
        ),
      )}

      {editing === "new" ? (
        <McpServerForm
          vaultReady={vaultReady}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={(fd) => run(saveMcpServer, fd)}
        />
      ) : (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
          >
            Add MCP server
          </button>
        </div>
      )}
    </div>
  );
}

// The add/edit form. When `server` is provided it edits that row; the token
// input is left blank and preserved unless the operator types a new one.
function McpServerForm({
  server,
  vaultReady,
  pending,
  onCancel,
  onSubmit,
}: {
  server?: McpServerView;
  vaultReady: boolean;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
  const labelClass = "text-xs font-medium text-fg-secondary";

  return (
    <form
      action={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-gold-500/30 bg-surface-1 p-4"
    >
      {server ? <input type="hidden" name="id" value={server.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={server?.name ?? ""}
            placeholder="e.g. Apollo MCP"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Transport</span>
          <select name="transport" defaultValue={server?.transport ?? "http"} className={inputClass}>
            {MCP_TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {MCP_TRANSPORT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>Server URL</span>
        <input
          name="url"
          type="url"
          inputMode="url"
          required
          defaultValue={server?.url ?? ""}
          placeholder="https://mcp.example.com/sse"
          className={`${inputClass} font-mono`}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Auth header</span>
          <input
            name="auth_header"
            defaultValue={server?.authHeader ?? "Authorization"}
            placeholder="Authorization"
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>
            Bearer token{" "}
            <span className="font-normal text-fg-muted">
              {server?.hasToken ? "(leave blank to keep current)" : "(optional)"}
            </span>
          </span>
          <input
            name="token"
            type="password"
            autoComplete="off"
            placeholder={server?.hasToken ? `••••${server.tokenLast4}` : "Paste token"}
            disabled={!vaultReady}
            className={`${inputClass} font-mono disabled:opacity-50`}
          />
        </label>
      </div>

      {!vaultReady ? (
        <p className="rounded-lg border border-dashed border-line bg-surface-0 px-3 py-2 text-[11px] leading-snug text-fg-muted">
          The credential vault isn&apos;t configured on this deployment (FUNDEXECS_VAULT_KEY), so
          tokens can&apos;t be stored. You can still register servers that need no auth.
        </p>
      ) : null}

      {server?.hasToken ? (
        <label className="flex items-center gap-2 text-[11px] text-fg-muted">
          <input type="checkbox" name="clear_token" value="1" className="h-3.5 w-3.5" />
          Remove the stored token (make this server unauthenticated)
        </label>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
        >
          {pending ? "…" : server ? "Save changes" : "Register server"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
