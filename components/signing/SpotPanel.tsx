"use client";

// The small panel that opens beside a spot on the page, with just what that spot needs:
// text boxes for a name or address, wheels for a date and time, and a signature box that
// draws, types or takes an uploaded picture. One signature is made once and reused.
import { useState } from "react";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { DateTimeWheels } from "@/components/signing/DateTimeWheels";
import { blockValueProblem, toOffsetIso, type BlockSpec } from "@/lib/signing/blocks";

export interface SpotPanelProps {
  spec: BlockSpec;
  required: boolean;
  value: string;
  onValue: (v: string) => void;
  signature: string | null;
  onSignature: (png: string) => void;
  signerName: string;
  position: number;
  total: number;
  onBack: (() => void) | null;
  onNext: () => void;
  isLast: boolean;
  onClose: () => void;
  /** On the last spot only: the agreement to sign electronically, so there is one path to the end. */
  agree?: { checked: boolean; onChange: (v: boolean) => void };
}

export function SpotPanel(p: SpotPanelProps) {
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const kind = p.spec.input;
  const problem = kind === "text" || kind === "multiline" ? blockValueProblem(p.spec.type, p.value) : null;

  const filled = kind === "signature" ? Boolean(draft) || (Boolean(p.signature) && !changing) : kind === "auto" ? true : Boolean(p.value.trim());
  const canNext = (!p.required || filled) && !problem && (!p.agree || p.agree.checked);
  const nextLabel = p.isLast ? "Done" : "Next";

  function next() {
    if (kind === "signature" && (changing || !p.signature) && draft) {
      p.onSignature(draft);
      setChanging(false);
      setDraft(null);
    }
    p.onNext();
  }

  return (
    <div role="dialog" aria-label={p.spec.label} className="w-72 max-w-[85vw] rounded-xl border border-line bg-surface-0 p-3 text-left shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-primary">{p.spec.label}</h3>
        {p.total > 0 ? (
          <span className="font-mono text-[11px] text-fg-muted">
            {p.position} of {p.total}
          </span>
        ) : null}
        <button type="button" onClick={p.onClose} aria-label="Close" className="text-fg-muted hover:text-fg-primary">
          ✕
        </button>
      </div>

      {kind === "text" ? (
        <input
          autoFocus
          type={p.spec.inputType ?? "text"}
          aria-label={p.spec.label}
          value={p.value}
          placeholder={p.spec.label}
          onChange={(e) => p.onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canNext) next();
          }}
          className="w-full rounded-md border border-line bg-surface-1 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-400 focus:outline-none"
        />
      ) : null}

      {kind === "multiline" ? (
        <textarea
          autoFocus
          rows={3}
          aria-label={p.spec.label}
          value={p.value}
          placeholder={p.spec.label}
          onChange={(e) => p.onValue(e.target.value)}
          className="w-full resize-none rounded-md border border-line bg-surface-1 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-400 focus:outline-none"
        />
      ) : null}

      {kind === "auto" ? (
        <div>
          <DateTimeWheels value={p.value ? new Date(p.value) : new Date()} onChange={(d) => p.onValue(toOffsetIso(d))} />
          <button type="button" onClick={() => p.onValue(toOffsetIso(new Date()))} className="mt-1 block w-full text-center text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary">
            Set to now
          </button>
        </div>
      ) : null}

      {kind === "signature" ? (
        p.signature && !changing ? (
          <div>
            <div className="flex min-h-[64px] items-center justify-center rounded-lg border border-line bg-white px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.signature} alt="Your signature" className="max-h-16 w-auto object-contain" />
            </div>
            <button type="button" onClick={() => setChanging(true)} className="mt-1 block text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary">
              Change signature
            </button>
          </div>
        ) : (
          <SignaturePad signerName={p.signerName} onChange={setDraft} label="Sign" />
        )
      ) : null}

      {p.agree ? (
        <label className="mt-3 flex items-start gap-2 text-xs text-fg-secondary">
          <input type="checkbox" checked={p.agree.checked} onChange={(e) => p.agree!.onChange(e.target.checked)} className="mt-0.5" />
          <span>I agree to sign this document electronically, and that my electronic signature is legally binding.</span>
        </label>
      ) : null}

      {problem ? <p role="alert" className="mt-1 text-xs text-status-danger">{problem}</p> : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={p.onBack ?? undefined} disabled={!p.onBack} className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-secondary hover:bg-surface-2 disabled:opacity-40">
          Back
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!canNext}
          className="rounded-lg bg-gold-500 px-4 py-1.5 text-xs font-semibold text-on-gold hover:brightness-110 disabled:opacity-40"
        >
          {kind === "signature" && p.signature && !changing ? (p.isLast ? "Use it" : "Use it, next") : nextLabel}
        </button>
      </div>
    </div>
  );
}
