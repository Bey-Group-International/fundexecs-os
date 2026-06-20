"use client";

import { useRef, useState, useTransition } from "react";
import { saveSecret, deleteSecret } from "./vault-actions";

// A stored third-party secret as surfaced to the UI — never the ciphertext or
// plaintext, only a recognizable masked last-4.
export interface OrgSecretView {
  id: string;
  provider: string;
  label: string | null;
  last4: string;
  updated_at: string;
}

export function SecretVault({
  secrets,
  configured,
}: {
  secrets: OrgSecretView[];
  configured: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-4">
      {!configured ? (
        <div className="rounded-xl border border-status-warning/40 bg-status-warning/[0.06] p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-status-warning">
            Vault disabled
          </p>
          <p className="mt-1 text-xs leading-snug text-fg-secondary">
            Set <code className="font-mono text-fg-primary">FUNDEXECS_VAULT_KEY</code> in the server
            environment to enable encrypted storage of third-party credentials.
          </p>
        </div>
      ) : null}

      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            const res = await saveSecret(formData);
            if (res?.error) setError(res.error);
            else formRef.current?.reset();
          })
        }
        className="rounded-xl border border-line bg-surface-1 p-4"
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
          Store a secret
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              name="provider"
              placeholder="Provider — e.g. anthropic, stripe"
              disabled={!configured}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none disabled:opacity-50"
            />
            <input
              name="label"
              placeholder="Label (optional)"
              disabled={!configured}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none disabled:opacity-50"
            />
          </div>
          <input
            name="value"
            type="password"
            autoComplete="off"
            placeholder="Secret value — encrypted on save, never shown again"
            disabled={!configured}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending || !configured}
            className="ml-auto rounded-md bg-gold-500 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save secret"}
          </button>
          {error ? <p className="text-xs text-status-danger">{error}</p> : null}
          <p className="text-[11px] leading-snug text-fg-muted">
            Stored encrypted at rest (AES-256-GCM). FundExecs uses it server-side on your behalf;
            it is never displayed again — re-save to replace.
          </p>
        </div>
      </form>

      {secrets.length ? (
        <div className="flex flex-col gap-2">
          {secrets.map((s) => (
            <SecretRow key={s.id} s={s} />
          ))}
        </div>
      ) : (
        <p className="fx-card border-dashed p-6 text-center text-sm text-fg-muted">
          No stored secrets. Add a provider credential above for FundExecs to use on your behalf.
        </p>
      )}
    </div>
  );
}

function SecretRow({ s }: { s: OrgSecretView }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="fx-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-success" aria-label="stored" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium capitalize text-fg-primary">{s.provider}</span>
            {s.label ? <span className="text-xs text-fg-secondary">{s.label}</span> : null}
          </div>
          <p className="mt-1 font-mono text-[11px] text-fg-muted">{`••••••••${s.last4}`}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Updated {new Date(s.updated_at).toLocaleDateString()}
          </p>
          {error ? <p className="mt-2 text-xs text-status-danger">{error}</p> : null}
        </div>
        <form
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              const res = await deleteSecret(formData);
              if (res?.error) setError(res.error);
            })
          }
          className="shrink-0"
        >
          <input type="hidden" name="id" value={s.id} />
          <button
            disabled={pending}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-60"
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}
