"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Recipient {
  id: string;
  name: string;
  email: string;
  routingOrder: number;
}

interface FormState {
  title: string;
  message: string;
  documentContent: string;
  recipients: Recipient[];
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = ["Document", "Recipients", "Review & Send"] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Wizard steps" className="mb-8 flex items-center gap-0">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;

        return (
          <div key={label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-sm font-semibold transition-colors",
                  done
                    ? "border-gold-500 bg-gold-500 text-[var(--color-surface-0)]"
                    : active
                      ? "border-gold-400 bg-gold-400/10 text-gold-400"
                      : "border-[var(--color-line)] bg-[var(--color-surface-1)] text-[var(--color-fg-muted)]",
                ].join(" ")}
                aria-current={active ? "step" : undefined}
              >
                {done ? (
                  // Checkmark SVG
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  idx
                )}
              </span>
              <span
                className={[
                  "font-mono text-[10px] uppercase tracking-widest",
                  active ? "text-gold-400" : "text-[var(--color-fg-muted)]",
                ].join(" ")}
              >
                {label}
              </span>
            </div>

            {i < STEPS.length - 1 && (
              <div
                className={[
                  "mx-2 h-px flex-1",
                  done ? "bg-gold-500" : "bg-[var(--color-line)]",
                ].join(" ")}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Document
// ---------------------------------------------------------------------------

interface Step1Props {
  state: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onNext: () => void;
}

function Step1Document({ state, onChange, onNext }: Step1Props) {
  const [touched, setTouched] = useState(false);
  const titleError = touched && state.title.trim() === "" ? "Title is required." : null;
  const contentError =
    touched && state.documentContent.trim() === "" ? "Document content is required." : null;

  function handleNext() {
    setTouched(true);
    if (state.title.trim() === "" || state.documentContent.trim() === "") return;
    onNext();
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="env-title"
          className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
        >
          Document title <span className="text-[var(--color-status-danger)]">*</span>
        </label>
        <input
          id="env-title"
          type="text"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Series A Term Sheet"
          aria-describedby={titleError ? "env-title-err" : undefined}
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:border-gold-500/60 focus:outline-none"
        />
        {titleError && (
          <p id="env-title-err" role="alert" className="text-xs text-[var(--color-status-danger)]">
            {titleError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="env-message"
          className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
        >
          Email message{" "}
          <span className="font-sans normal-case tracking-normal text-[var(--color-fg-muted)]">
            (optional)
          </span>
        </label>
        <textarea
          id="env-message"
          rows={3}
          value={state.message}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="A short note that will accompany the signature request email."
          className="resize-none rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:border-gold-500/60 focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="env-content"
          className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
        >
          Document content <span className="text-[var(--color-status-danger)]">*</span>
        </label>
        <textarea
          id="env-content"
          rows={10}
          value={state.documentContent}
          onChange={(e) => onChange({ documentContent: e.target.value })}
          placeholder="Paste or type your document here. Markdown and plain text are both accepted."
          aria-describedby={contentError ? "env-content-err" : undefined}
          className="resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:border-gold-500/60 focus:outline-none"
        />
        {contentError && (
          <p id="env-content-err" role="alert" className="text-xs text-[var(--color-status-danger)]">
            {contentError}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-[var(--color-surface-0)] transition hover:bg-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Next: Recipients
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Recipients
// ---------------------------------------------------------------------------

function newRecipient(order: number): Recipient {
  return { id: crypto.randomUUID(), name: "", email: "", routingOrder: order };
}

interface Step2Props {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  onBack: () => void;
  onNext: () => void;
}

function Step2Recipients({ recipients, onChange, onBack, onNext }: Step2Props) {
  const [touched, setTouched] = useState(false);

  function update(id: string, patch: Partial<Recipient>) {
    onChange(recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRecipient() {
    onChange([...recipients, newRecipient(recipients.length + 1)]);
  }

  function removeRecipient(id: string) {
    const next = recipients
      .filter((r) => r.id !== id)
      .map((r, i) => ({ ...r, routingOrder: i + 1 }));
    onChange(next);
  }

  function validate() {
    if (recipients.length === 0) return false;
    return recipients.every(
      (r) => r.name.trim() !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email),
    );
  }

  function handleNext() {
    setTouched(true);
    if (!validate()) return;
    onNext();
  }

  const hasMin = recipients.length > 0;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {recipients.length === 0 && touched && (
          <p role="alert" className="rounded-md bg-[var(--color-status-danger)]/10 px-3 py-2 text-xs text-[var(--color-status-danger)]">
            Add at least one recipient before continuing.
          </p>
        )}

        {recipients.map((r, i) => (
          <div
            key={r.id}
            className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                Signer {r.routingOrder}
              </span>
              {recipients.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRecipient(r.id)}
                  aria-label={`Remove signer ${r.routingOrder}`}
                  className="rounded-md border border-[var(--color-status-danger)]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-status-danger)] transition hover:bg-[var(--color-status-danger)]/10"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1">
                <label
                  htmlFor={`rec-name-${r.id}`}
                  className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
                >
                  Name
                </label>
                <input
                  id={`rec-name-${r.id}`}
                  type="text"
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  placeholder="Jane Smith"
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:border-gold-500/60 focus:outline-none"
                />
                {touched && r.name.trim() === "" && (
                  <p role="alert" className="text-[11px] text-[var(--color-status-danger)]">
                    Name is required.
                  </p>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1">
                <label
                  htmlFor={`rec-email-${r.id}`}
                  className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
                >
                  Email
                </label>
                <input
                  id={`rec-email-${r.id}`}
                  type="email"
                  value={r.email}
                  onChange={(e) => update(r.id, { email: e.target.value })}
                  placeholder="jane@example.com"
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-fg-primary)] placeholder:text-[var(--color-fg-muted)] focus:border-gold-500/60 focus:outline-none"
                />
                {touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) && (
                  <p role="alert" className="text-[11px] text-[var(--color-status-danger)]">
                    Valid email is required.
                  </p>
                )}
              </div>

              <div className="flex w-28 flex-col gap-1">
                <label
                  htmlFor={`rec-order-${r.id}`}
                  className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-muted)]"
                >
                  Order
                </label>
                <input
                  id={`rec-order-${r.id}`}
                  type="number"
                  min={1}
                  value={r.routingOrder}
                  onChange={(e) =>
                    update(r.id, { routingOrder: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2 text-sm text-[var(--color-fg-primary)] focus:border-gold-500/60 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addRecipient}
          className="self-start rounded-md border border-[var(--color-line)] px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-primary)]"
        >
          + Add signer
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-[var(--color-surface-0)] transition hover:bg-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Next: Review
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Review & Send
// ---------------------------------------------------------------------------

interface Step3Props {
  state: FormState;
  onBack: () => void;
  onSaveDraft: () => void;
  onSend: () => void;
  isPending: boolean;
  error: string | null;
}

function Step3Review({ state, onBack, onSaveDraft, onSend, isPending, error }: Step3Props) {
  return (
    <section className="flex flex-col gap-6">
      {/* Document summary */}
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
          Document
        </p>
        <p className="text-base font-semibold text-[var(--color-fg-primary)]">{state.title}</p>
        {state.message && (
          <p className="mt-1.5 text-sm text-[var(--color-fg-secondary)]">{state.message}</p>
        )}
        <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2">
          <pre className="max-h-40 overflow-auto font-mono text-[11px] leading-relaxed text-[var(--color-fg-secondary)] whitespace-pre-wrap">
            {state.documentContent}
          </pre>
        </div>
      </div>

      {/* Recipients summary */}
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
          Signers
        </p>
        <ol className="flex flex-col gap-2">
          {[...state.recipients]
            .sort((a, b) => a.routingOrder - b.routingOrder)
            .map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-0)] px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] font-mono text-[10px] text-[var(--color-fg-muted)]">
                  {r.routingOrder}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-fg-primary)]">
                    {r.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
                    {r.email}
                  </p>
                </div>
              </li>
            ))}
        </ol>
      </div>

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-status-danger)]/30 bg-[var(--color-status-danger)]/10 px-3 py-2 text-sm text-[var(--color-status-danger)]"
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-primary)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          Back
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isPending}
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg-primary)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {isPending ? "Saving…" : "Save as Draft"}
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={isPending}
            className="rounded-md bg-gold-500 px-4 py-2 text-sm font-medium text-[var(--color-surface-0)] transition hover:bg-gold-400 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {isPending ? "Sending…" : "Send for Signature"}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root wizard component
// ---------------------------------------------------------------------------

export function EnvelopeWizard() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [formState, setFormState] = useState<FormState>({
    title: "",
    message: "",
    documentContent: "",
    recipients: [newRecipient(1)],
  });

  function patchForm(patch: Partial<FormState>) {
    setFormState((prev) => ({ ...prev, ...patch }));
  }

  async function submit(send: boolean) {
    setError(null);
    const payload = {
      title: formState.title,
      message: formState.message,
      documentContent: formState.documentContent,
      recipients: formState.recipients.map(({ name, email, routingOrder }) => ({
        name,
        email,
        routingOrder,
      })),
      send,
    };

    const res = await fetch("/api/envelopes/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = `Request failed (${res.status}).`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json.error) msg = json.error;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(msg);
    }

    const data = (await res.json()) as { envelopeId?: string };
    if (!data.envelopeId) throw new Error("No envelope ID returned.");
    router.push(`/envelopes/${data.envelopeId}`);
  }

  function handleSaveDraft() {
    startTransition(async () => {
      try {
        await submit(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleSend() {
    startTransition(async () => {
      try {
        await submit(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="fx-ambient mx-auto max-w-2xl">
      <header className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
          Envelopes
        </span>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[var(--color-fg-primary)]">
          New Envelope
        </h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          Add your document, specify signers, then send or save as a draft.
        </p>
      </header>

      <StepIndicator current={step} />

      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-1)] p-6">
        {step === 1 && (
          <Step1Document
            state={formState}
            onChange={patchForm}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step2Recipients
            recipients={formState.recipients}
            onChange={(recipients) => patchForm({ recipients })}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <Step3Review
            state={formState}
            onBack={() => setStep(2)}
            onSaveDraft={handleSaveDraft}
            onSend={handleSend}
            isPending={isPending}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
