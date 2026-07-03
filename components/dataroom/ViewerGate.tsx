"use client";

import { useState, useTransition } from "react";
import { verifySharePassword } from "@/components/build/materials-actions";
import { passEmailGate, recordNdaSignature } from "@/components/dataroom/viewer-actions";

export interface GateConfig {
  requireEmail: boolean;
  requireNda: boolean;
  ndaText: string | null;
  passwordProtected: boolean;
}

interface Props {
  token: string;
  /** UUID of the data_room_shares row — needed to persist NDA signatures. */
  shareId: string;
  config: GateConfig;
  /** Called once all required gates are passed, with the captured email (or null). */
  onPass: (email: string | null) => void;
}

type Stage = "email" | "nda" | "password" | "done";

function nextStage(config: GateConfig, after: Stage | null): Stage {
  const order: Stage[] = [];
  if (config.requireEmail) order.push("email");
  if (config.requireNda) order.push("nda");
  if (config.passwordProtected) order.push("password");
  order.push("done");

  if (after === null) return order[0];
  const idx = order.indexOf(after);
  return order[idx + 1] ?? "done";
}

// ---------------------------------------------------------------------------
// Sub-forms
// ---------------------------------------------------------------------------

function EmailGate({
  token,
  onNext,
  accent,
}: {
  token: string;
  onNext: (email: string) => void;
  accent: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await passEmailGate(token, trimmed);
      if (result.ok) {
        onNext(trimmed);
      } else {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <h2 className="font-display text-xl font-semibold text-fg-primary">Enter your email</h2>
      <p className="mt-2 text-sm text-fg-secondary">
        This data room requires your email address before viewing.
      </p>
      <div className="mt-5 space-y-3">
        <input
          type="email"
          autoFocus
          placeholder="you@example.com"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
        />
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full rounded-lg py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {pending ? "Checking…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function NdaGate({
  ndaText,
  shareId,
  signerEmail,
  onNext,
  accent,
}: {
  ndaText: string | null;
  shareId: string;
  signerEmail: string | null;
  onNext: () => void;
  accent: string;
}) {
  const [signerName, setSignerName] = useState("");
  const [pending, startTransition] = useTransition();

  const defaultNda = `By proceeding, you agree to keep all information in this data room strictly confidential. You shall not disclose, reproduce, or distribute any materials herein to any third party without prior written consent from the issuing organization. This obligation survives the termination of any relationship with the organization.`;

  const trimmedName = signerName.trim();
  const canSubmit = trimmedName.length > 0 && !pending;

  // Build the legal-timestamp string shown beneath the signature preview.
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("share_id", shareId);
      fd.set("signer_name", trimmedName);
      fd.set("signer_email", signerEmail ?? "");
      fd.set("signed_at", new Date().toISOString());
      const result = await recordNdaSignature(fd);
      if (result.ok) onNext();
    });
  }

  return (
    <>
      {/* Google Fonts — Dancing Script for the cursive signature preview */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap"
      />
      <div className="w-full max-w-lg">
        <h2 className="font-display text-xl font-semibold text-fg-primary">
          Non-Disclosure Agreement
        </h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Please read the NDA below, then sign with your full name to proceed.
        </p>

        {/* NDA text scroll box */}
        <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-1 p-4 text-xs leading-relaxed text-fg-secondary">
          {ndaText ?? defaultNda}
        </div>

        {/* Signer name input */}
        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-secondary">
              Your full name
            </span>
            <input
              type="text"
              autoFocus
              autoComplete="name"
              placeholder="Jane Smith"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
            />
          </label>

          {/* Live signature preview */}
          {trimmedName ? (
            <div className="rounded-lg border border-line bg-surface-0 px-4 py-3">
              <p className="mb-1 text-xs text-fg-muted">Signature preview</p>
              <p
                style={{
                  fontFamily: "'Dancing Script', cursive",
                  fontSize: "1.6rem",
                  lineHeight: 1.2,
                  color: accent,
                }}
              >
                {trimmedName}
              </p>
            </div>
          ) : null}

          {/* Legal timestamp */}
          <p className="text-xs text-fg-muted">
            By clicking <span className="font-medium text-fg-secondary">Sign &amp; Continue</span>,{" "}
            {trimmedName ? (
              <span className="font-medium text-fg-secondary">{trimmedName}</span>
            ) : (
              "you"
            )}{" "}
            agree to the NDA on{" "}
            <span className="font-medium text-fg-secondary">{dateStr}</span> at{" "}
            <span className="font-medium text-fg-secondary">{timeStr} UTC</span>.
          </p>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            {pending ? "Recording signature…" : "Sign & Continue →"}
          </button>
        </div>
      </div>
    </>
  );
}

function PasswordGate({
  token,
  onNext,
  accent,
}: {
  token: string;
  onNext: () => void;
  accent: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!value.trim()) { setError("Please enter the password."); return; }
    setError("");
    startTransition(async () => {
      const ok = await verifySharePassword(token, value.trim());
      if (ok) {
        onNext();
      } else {
        setError("Incorrect password. Please try again.");
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <h2 className="font-display text-xl font-semibold text-fg-primary">Password required</h2>
      <p className="mt-2 text-sm text-fg-secondary">
        This data room is password-protected. Enter the password provided by the sender.
      </p>
      <div className="mt-5 space-y-3">
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
        />
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="w-full rounded-lg py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {pending ? "Checking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ViewerGate — orchestrates the gate sequence
// ---------------------------------------------------------------------------

export function ViewerGate({ token, shareId, config, onPass }: Props) {
  const accent = "#D4AF6A";

  // The starting stage is a pure function of the gate config (email → nda →
  // password), so it's identical on server and client — no hydration dance
  // needed. Whether the visitor has ALREADY passed these gates on a prior
  // visit is now a server-side fact (the signed pass cookie, checked by the
  // page before it decides whether to render this component at all), not
  // something this component re-derives from localStorage.
  const [stage, setStage] = useState<Stage>(() => nextStage(config, null));
  const [email, setEmail] = useState<string | null>(null);

  // Advance to the next gate stage. Each sub-gate's own `onNext` only fires
  // after ITS server action has already granted that gate — this function
  // just tracks which stage to show next and, once every stage is done,
  // signals the parent so it can refresh from the server (which will now see
  // every gate granted and return real content).
  function advance(current: Stage, capturedEmail?: string) {
    if (current === "email" && capturedEmail) {
      setEmail(capturedEmail);
    }
    const next = nextStage(config, current);
    setStage(next);
    if (next === "done") {
      const resolvedEmail = current === "email" ? (capturedEmail ?? null) : email;
      onPass(resolvedEmail);
    }
  }

  // All gates passed — signal parent already fired via onPass above; nothing
  // left to render (the parent is now refreshing from the server).
  if (stage === "done") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/90 px-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface-1 p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3 border-b border-line pb-5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-xs font-bold text-surface-0"
            style={{ backgroundColor: accent }}
          >
            DR
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-fg-primary">Data Room</p>
            <p className="text-xs text-fg-muted">Confidential — authorised viewers only</p>
          </div>
        </div>

        {/* Gate content */}
        {stage === "email" ? (
          <EmailGate token={token} accent={accent} onNext={(e) => advance("email", e)} />
        ) : stage === "nda" ? (
          <NdaGate
            ndaText={config.ndaText}
            shareId={shareId}
            signerEmail={email}
            accent={accent}
            onNext={() => advance("nda")}
          />
        ) : stage === "password" ? (
          <PasswordGate token={token} accent={accent} onNext={() => advance("password")} />
        ) : null}
      </div>
    </div>
  );
}
