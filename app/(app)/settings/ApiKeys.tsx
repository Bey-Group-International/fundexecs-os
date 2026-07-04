"use client";

import { useRef, useState, useTransition } from "react";
import type { ApiKeyMode } from "@/lib/supabase/database.types";
import { maskedSecret, API_SCOPES, API_SCOPE_LABELS, DEFAULT_API_SCOPES, type ApiScope } from "@/lib/api-keys";
import { createApiKey, revokeApiKey, rotateApiKey } from "./api-keys-actions";

// A key as surfaced to the UI — never the secret hash. The secret itself only
// ever exists client-side in the one-time reveal returned by create/rotate.
export interface ApiKeyView {
  id: string;
  name: string;
  mode: ApiKeyMode;
  scopes: string[];
  publishable_key: string;
  secret_prefix: string;
  secret_last4: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface Reveal {
  forName: string;
  publishableKey?: string;
  secretKey: string;
}

export function ApiKeys({ keys }: { keys: ApiKeyView[] }) {
  const [mode, setMode] = useState<ApiKeyMode>("test");
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* One-time reveal — the only moment the full secret is ever shown. */}
      {reveal ? (
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/[0.06] p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-gold-300">
              New key · {reveal.forName}
            </p>
            <button
              onClick={() => setReveal(null)}
              className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-xs leading-snug text-fg-secondary">
            Copy your secret key now — for your security it{"’"}s shown once and can{"’"}t be
            retrieved again. If you lose it, rotate the key.
          </p>
          {reveal.publishableKey ? (
            <CopyField label="Publishable key" value={reveal.publishableKey} />
          ) : null}
          <CopyField label="Secret key" value={reveal.secretKey} highlight />
        </div>
      ) : null}

      {/* Create */}
      <form
        ref={formRef}
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            const res = await createApiKey(formData);
            if (res?.error) setError(res.error);
            else if (res?.secretKey) {
              setReveal({
                forName: String(formData.get("name") ?? "Key"),
                publishableKey: res.publishableKey,
                secretKey: res.secretKey,
              });
              formRef.current?.reset();
              setMode("test");
            }
          })
        }
        className="rounded-xl border border-line bg-surface-1 p-4"
      >
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
          New API key
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            name="name"
            placeholder="Label — e.g. Production server"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
            {(["test", "live"] as ApiKeyMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 text-xs font-medium capitalize transition ${
                  mode === m
                    ? "bg-gold-500 text-surface-0"
                    : "bg-surface-0 text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <input type="hidden" name="mode" value={mode} />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
          >
            {pending ? "Generating…" : "Generate key"}
          </button>
        </div>
        {/* Scope picker — the key's blast radius. Read scopes start checked
            (the pre-scopes default); write scopes are deliberately opt-in so a
            key never gains proposal rights the issuer didn't tick. */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {API_SCOPES.map((scope) => (
            <label
              key={scope}
              className="flex items-center gap-1.5 text-xs text-fg-secondary"
            >
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                defaultChecked={DEFAULT_API_SCOPES.includes(scope)}
                className="h-3.5 w-3.5 accent-gold-400"
              />
              {API_SCOPE_LABELS[scope as ApiScope]}
            </label>
          ))}
        </div>
        {error ? <p className="mt-2 text-xs text-status-danger">{error}</p> : null}
        <p className="mt-2 text-[11px] leading-snug text-fg-muted">
          Test keys are for development; live keys act on real data. The secret key is shown once at
          creation — store it somewhere safe. Scopes limit what the key can read; leave all checked
          for a full-access read key.
        </p>
      </form>

      {/* List */}
      {keys.length ? (
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <KeyRow key={k.id} k={k} />
          ))}
        </div>
      ) : (
        <p className="fx-card border-dashed p-6 text-center text-sm text-fg-muted">
          No API keys yet. Generate one to start calling the FundExecs OS API.
        </p>
      )}
    </div>
  );
}

function KeyRow({ k }: { k: ApiKeyView }) {
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const revoked = Boolean(k.revoked_at);

  return (
    <div className={`fx-card p-4 ${revoked ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            revoked ? "bg-fg-muted" : "bg-status-success"
          }`}
          aria-label={revoked ? "revoked" : "active"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">{k.name}</span>
            <span
              className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                k.mode === "live"
                  ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                  : "border-line bg-surface-0 text-fg-secondary"
              }`}
            >
              {k.mode}
            </span>
            {revoked ? (
              <span className="rounded-full border border-status-danger/40 bg-status-danger/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger">
                Revoked
              </span>
            ) : null}
          </div>

          {k.scopes.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {k.scopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] text-fg-secondary"
                >
                  {scope}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-1">
            <CopyField label="Publishable" value={k.publishable_key} compact />
            <p className="font-mono text-[11px] text-fg-muted">
              <span className="text-fg-secondary">Secret</span>{" "}
              {maskedSecret(k.secret_prefix, k.secret_last4)}
            </p>
          </div>

          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Created {new Date(k.created_at).toLocaleDateString()}
            {k.last_used_at
              ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`
              : " · never used"}
          </p>

          {rotated ? (
            <div className="mt-2 rounded-md border border-gold-500/40 bg-gold-500/[0.06] p-2">
              <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                New secret — copy now
              </p>
              <CopyField label="Secret key" value={rotated} highlight />
            </div>
          ) : null}
          {error ? <p className="mt-2 text-xs text-status-danger">{error}</p> : null}
        </div>

        {!revoked ? (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const fd = new FormData();
                  fd.set("id", k.id);
                  const res = await rotateApiKey(fd);
                  if (res?.error) setError(res.error);
                  else if (res?.secretKey) setRotated(res.secretKey);
                })
              }
              className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-60"
            >
              Rotate
            </button>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const fd = new FormData();
                  fd.set("id", k.id);
                  const res = await revokeApiKey(fd);
                  if (res?.error) setError(res.error);
                })
              }
              className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-60"
            >
              Revoke
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  highlight,
  compact,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={compact ? "" : "mt-2"}>
      <div
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
          highlight ? "border-gold-500/40 bg-surface-0" : "border-line bg-surface-0"
        }`}
      >
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-primary" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300"
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
