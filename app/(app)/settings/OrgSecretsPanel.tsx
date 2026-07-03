"use client";

import { useState, useTransition } from "react";
import { setOrgSecret, deleteOrgSecret, type OrgSecretMeta } from "./secrets-actions";

export interface SecretKeyGroup {
  channelLabel: string;
  keys: { key: string; hint: string }[];
}

// Manage the org's own provider credentials (the AES-256-GCM vault behind
// lib/org-secrets.ts). A stored credential makes dispatch act under this
// org's identity; removing it falls back to the deploy-wide env var (if the
// operator set one). Values are write-only: the panel shows last4 + when it
// was stored, never the plaintext.
export function OrgSecretsPanel({
  secrets,
  groups,
  vaultReady,
}: {
  secrets: OrgSecretMeta[];
  groups: SecretKeyGroup[];
  vaultReady: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const byKey = new Map(secrets.map((s) => [s.provider, s]));

  if (!vaultReady) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-4 text-xs leading-snug text-fg-muted">
        The credential vault isn&apos;t configured on this deployment (FUNDEXECS_VAULT_KEY), so
        per-organization provider credentials can&apos;t be stored. Channels use the deploy-wide
        environment credentials instead.
      </p>
    );
  }

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) =>
    startTransition(async () => {
      setError(null);
      const result = await action(fd);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      else setEditingKey(null);
    });

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.channelLabel} className="rounded-xl border border-line bg-surface-1 p-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {group.channelLabel}
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {group.keys.map(({ key, hint }) => {
              const stored = byKey.get(key);
              const editing = editingKey === key;
              return (
                <div key={key} className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-fg-primary">{key}</span>
                    <p className="text-[11px] leading-snug text-fg-muted">{hint}</p>
                  </div>

                  {stored && !editing ? (
                    <>
                      <span className="font-mono text-[10px] text-fg-secondary">
                        ••••{stored.last4}
                        {stored.updatedAt ? (
                          <span className="ml-1.5 text-fg-muted">
                            {new Date(stored.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setEditingKey(key)}
                        className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
                      >
                        Rotate
                      </button>
                      <form
                        action={(fd) => run(deleteOrgSecret, fd)}
                        className="shrink-0"
                      >
                        <input type="hidden" name="provider" value={key} />
                        <button
                          type="submit"
                          disabled={pending}
                          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </form>
                    </>
                  ) : editing ? (
                    <form action={(fd) => run(setOrgSecret, fd)} className="flex shrink-0 items-center gap-2">
                      <input type="hidden" name="provider" value={key} />
                      <input
                        type="password"
                        name="value"
                        required
                        autoComplete="off"
                        placeholder="Paste credential"
                        className="w-44 rounded-lg border border-line bg-surface-0 px-2.5 py-1.5 font-mono text-xs text-fg-primary placeholder:text-fg-muted"
                      />
                      <button
                        type="submit"
                        disabled={pending}
                        className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                      >
                        {pending ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setEditingKey(null)}
                        className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setEditingKey(key)}
                      className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
                    >
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
