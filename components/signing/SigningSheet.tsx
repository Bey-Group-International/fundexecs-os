"use client";

// The signer's view of the document: the real pages with this person's blocks on them.
// Text blocks are filled in place, a signature block opens the signature pad, a date and
// time block fills itself when they sign. Whatever the other party already filled in is
// shown on the page, read-only. Used by the recipient (by link) and the owner (countersign).
import { useMemo, useState, useTransition } from "react";
import { PdfPages } from "@/components/signing/PdfPages";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { blockSpec, blockValueProblem, formatBlockDateTime } from "@/lib/signing/blocks";

export interface SheetBlock {
  id: string;
  type: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  prefill: string | null;
  locked: boolean;
}
export interface DoneBlock extends Omit<SheetBlock, "required" | "prefill" | "locked"> {
  value: string | null;
  signaturePng: string | null;
}

const boxStyle = (b: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => ({
  left: `${b.xPct}%`,
  top: `${b.yPct}%`,
  width: `${b.widthPct}%`,
  height: `${b.heightPct}%`,
});

export function SigningSheet({
  pdfSrc,
  blocks,
  done,
  signerName,
  submitLabel,
  onSubmit,
}: {
  pdfSrc: string;
  blocks: SheetBlock[];
  done: DoneBlock[];
  signerName: string;
  submitLabel: string;
  /** Resolves to an error message, or null when it worked. */
  onSubmit: (signatureData: string, responses: Record<string, string>) => Promise<string | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(blocks.filter((b) => b.prefill).map((b) => [b.id, b.prefill as string])));
  const [signature, setSignature] = useState<string | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = useMemo(() => {
    const out: string[] = [];
    for (const b of blocks) {
      if (!b.required) continue;
      const spec = blockSpec(b.type);
      if (!spec || spec.input === "auto") continue;
      if (spec.input === "signature" ? !signature : !(values[b.id] ?? "").trim()) out.push(spec.label);
    }
    return out;
  }, [blocks, values, signature]);

  const problems = useMemo(
    () => blocks.map((b) => blockValueProblem(b.type, values[b.id])).filter((p): p is string => Boolean(p)),
    [blocks, values],
  );
  const canFinish = agreed && Boolean(signature) && open.length === 0 && problems.length === 0 && !pending;

  function finish() {
    if (!signature) return;
    setError(null);
    startTransition(async () => {
      // The date and time is stamped by the server at the moment of signing.
      const err = await onSubmit(signature, Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())));
      if (err) setError(err);
    });
  }

  return (
    <div>
      <div className="mb-4 rounded-xl border border-line bg-surface-1 p-4">
        <p className="text-sm text-fg-secondary">
          Fill in the highlighted blocks on the document, add your signature, then {submitLabel.toLowerCase()}.
          {open.length ? <span className="text-fg-primary"> Still to do: {open.join(", ")}.</span> : problems.length ? <span className="text-status-danger"> {problems[0]}</span> : <span className="text-gold-300"> Everything is filled in.</span>}
        </p>
      </div>

      <div className="rounded-xl bg-surface-2 p-3">
        <PdfPages src={pdfSrc}>
          {({ page }) => (
            <>
              {done
                .filter((d) => d.page === page)
                .map((d) => (
                  <div key={d.id} className="pointer-events-none absolute flex items-center overflow-hidden px-1 text-[11px] text-[#0d0d40]" style={boxStyle(d)}>
                    {d.type === "signature" || d.type === "initials" ? (
                      d.signaturePng ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.signaturePng} alt="Signature" className="h-full w-auto max-w-full object-contain" />
                      ) : null
                    ) : d.type === "datetime" && d.value ? (
                      formatBlockDateTime(d.value)
                    ) : (
                      <span className="whitespace-pre-wrap leading-tight">{d.value}</span>
                    )}
                  </div>
                ))}
              {blocks
                .filter((b) => b.page === page)
                .map((b) => {
                  const spec = blockSpec(b.type);
                  if (!spec) return null;
                  const base = "absolute overflow-hidden rounded-sm border-2 border-gold-500/70 bg-gold-500/10";
                  if (spec.input === "signature") {
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setDraft(signature);
                          setPadOpen(true);
                        }}
                        aria-label="Sign here"
                        className={`${base} flex items-center justify-center text-xs font-semibold text-[#7a5d00] hover:bg-gold-500/20`}
                        style={boxStyle(b)}
                      >
                        {signature ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={signature} alt="Your signature" className="h-full w-auto max-w-full object-contain" />
                        ) : (
                          "Click to sign"
                        )}
                      </button>
                    );
                  }
                  if (spec.input === "auto") {
                    return (
                      <div key={b.id} className={`${base} flex items-center px-1 text-[10px] text-[#7a5d00]`} style={boxStyle(b)}>
                        Date and time: filled when you sign
                      </div>
                    );
                  }
                  const common = {
                    "aria-label": spec.label,
                    value: values[b.id] ?? "",
                    readOnly: b.locked,
                    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [b.id]: e.target.value })),
                    placeholder: spec.label,
                    className: `h-full w-full bg-transparent px-1 text-[12px] text-[#0d0d40] placeholder:text-[#7a5d00]/70 focus:outline-none ${b.locked ? "cursor-not-allowed opacity-80" : ""}`,
                  };
                  return (
                    <div key={b.id} className={base} style={boxStyle(b)}>
                      {spec.input === "multiline" ? <textarea {...common} className={`${common.className} resize-none leading-tight`} /> : <input type={spec.inputType ?? "text"} {...common} />}
                    </div>
                  );
                })}
            </>
          )}
        </PdfPages>
      </div>

      <div className="sticky bottom-0 mt-4 rounded-xl border border-line bg-surface-1/95 p-4 backdrop-blur">
        <label className="mb-3 flex items-start gap-2 text-xs text-fg-secondary">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>I agree to sign this document electronically, and that my electronic signature is legally binding.</span>
        </label>
        {error ? <p role="alert" className="mb-2 text-sm text-status-danger">{error}</p> : null}
        <button type="button" onClick={finish} disabled={!canFinish} className="w-full rounded-lg bg-gold-500 py-2.5 text-sm font-semibold text-on-gold hover:brightness-110 disabled:opacity-40">
          {pending ? "Signing…" : submitLabel}
        </button>
      </div>

      {padOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Add your signature" className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-surface-0 p-4 shadow-xl">
            <SignaturePad signerName={signerName} onChange={setDraft} label="Your signature" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setPadOpen(false)} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary hover:bg-surface-2">
                Cancel
              </button>
              <button
                type="button"
                disabled={!draft}
                onClick={() => {
                  setSignature(draft);
                  setPadOpen(false);
                }}
                className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-on-gold hover:brightness-110 disabled:opacity-40"
              >
                Apply signature
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
