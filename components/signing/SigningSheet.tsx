"use client";

// The signer's view of the document: the real pages with a plain × at each spot this person
// has to complete. The first spot is open to start; a small panel beside it has just what that
// spot needs, and Next moves to the following one, with the rest dimmed. A filled spot shows
// what was entered in place of its ×. Whatever the other party already filled in is shown on
// the page, read-only. Used by the recipient (by link) and the owner (countersign).
import { useEffect, useMemo, useState, useTransition } from "react";
import { PdfPages } from "@/components/signing/PdfPages";
import { SpotPanel } from "@/components/signing/SpotPanel";
import { blockSpec, blockValueProblem, formatBlockDateTime, toOffsetIso } from "@/lib/signing/blocks";

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
  const [values, setValues] = useState<Record<string, string>>(() => {
    const now = toOffsetIso(new Date());
    return Object.fromEntries(
      blocks
        .map((b) => [b.id, b.prefill ?? (blockSpec(b.type)?.input === "auto" ? now : "")] as const)
        .filter(([, v]) => v),
    );
  });
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The spots to complete, in reading order. A locked, pre-filled block is shown but not asked for,
  // and neither is one that arrives already filled in correctly (an email or name we know): it
  // shows its value on the page, and a click still opens it to change.
  const steps = useMemo(
    () =>
      blocks
        .filter((b) => {
          const spec = blockSpec(b.type);
          if (!spec || (b.locked && b.prefill)) return false;
          const known = (spec.input === "text" || spec.input === "multiline") && Boolean(b.prefill?.trim()) && !blockValueProblem(b.type, b.prefill);
          return !known;
        })
        .sort((a, b) => a.page - b.page || a.yPct - b.yPct || a.xPct - b.xPct),
    [blocks],
  );
  const [activeId, setActiveId] = useState<string | null>(() => steps[0]?.id ?? null);
  const activeIndex = steps.findIndex((b) => b.id === activeId);
  const lastOpen = activeIndex >= 0 && activeIndex === steps.length - 1;

  // Bring the open spot into view.
  useEffect(() => {
    if (!activeId) return;
    document.querySelector(`[data-block-id="${activeId}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [activeId]);

  const isFilled = (b: SheetBlock) => (blockSpec(b.type)!.input === "signature" ? Boolean(signature) : Boolean((values[b.id] ?? "").trim()));

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
      const err = await onSubmit(signature, Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())));
      if (err) setError(err);
    });
  }

  return (
    <div>
      <div className="mb-4 rounded-xl border border-line bg-surface-1 p-4">
        <p className="text-sm text-fg-secondary">
          Click each <span aria-hidden="true">×</span> on the document to complete it, or use Next.
          {open.length ? <span className="text-fg-primary"> Still to do: {open.join(", ")}.</span> : problems.length ? <span className="text-status-danger"> {problems[0]}</span> : <span className="text-gold-300"> Everything is filled in. Agree below and send it back.</span>}
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
                  const locked = b.locked && Boolean(b.prefill);
                  const isActive = b.id === activeId;
                  const filled = locked || isFilled(b);
                  const v = values[b.id] ?? "";
                  return (
                    <div
                      key={b.id}
                      data-block-id={b.id}
                      role={locked ? undefined : "button"}
                      tabIndex={locked ? undefined : 0}
                      aria-label={locked ? undefined : `${spec.label}: ${filled ? "filled, click to change" : "click to complete"}`}
                      onClick={locked ? undefined : () => setActiveId(b.id)}
                      onKeyDown={locked ? undefined : (e) => (e.key === "Enter" || e.key === " ") && setActiveId(b.id)}
                      className={`absolute flex items-center ${locked ? "" : "cursor-pointer"} ${activeId && !isActive ? "opacity-50" : ""}`}
                      style={boxStyle(b)}
                    >
                      <div className="flex h-full w-full items-center overflow-hidden">
                      {filled ? (
                        spec.input === "signature" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={signature ?? ""} alt="Your signature" className="h-full w-auto max-w-full object-contain" />
                        ) : (
                          <span className="whitespace-pre-wrap px-1 text-[11px] leading-tight text-[#0d0d40]">
                            {spec.input === "auto" ? formatBlockDateTime(v) : locked ? b.prefill : v}
                          </span>
                        )
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold leading-none ${isActive ? "animate-pulse border-gold-500 bg-gold-500 text-on-gold" : "border-gold-500 bg-white/80 text-[#7a5d00]"}`}
                        >
                          ×
                        </span>
                      )}
                      </div>
                      {isActive ? (
                        <div
                          className="absolute z-30"
                          style={{
                            ...(b.xPct > 45 ? { right: 0 } : { left: 0 }),
                            ...(b.yPct > 55 ? { bottom: "100%", marginBottom: 6 } : { top: "100%", marginTop: 6 }),
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SpotPanel
                            key={b.id}
                            spec={spec}
                            required={b.required}
                            value={v}
                            onValue={(nv) => setValues((cur) => ({ ...cur, [b.id]: nv }))}
                            signature={signature}
                            onSignature={setSignature}
                            signerName={signerName}
                            // A spot outside the walk (already filled in) opens alone: no count, no Back, Done closes it.
                            position={activeIndex + 1}
                            total={activeIndex >= 0 ? steps.length : 0}
                            onBack={activeIndex > 0 ? () => setActiveId(steps[activeIndex - 1].id) : null}
                            onNext={() => setActiveId(activeIndex >= 0 && activeIndex < steps.length - 1 ? steps[activeIndex + 1].id : null)}
                            isLast={activeIndex < 0 || activeIndex === steps.length - 1}
                            agree={lastOpen ? { checked: agreed, onChange: setAgreed } : undefined}
                            onClose={() => setActiveId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </>
          )}
        </PdfPages>
      </div>

      <div className="sticky bottom-0 mt-4 rounded-xl border border-line bg-surface-1/95 p-4 backdrop-blur">
        {lastOpen ? null : (
          <label className="mb-3 flex items-start gap-2 text-xs text-fg-secondary">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>I agree to sign this document electronically, and that my electronic signature is legally binding.</span>
          </label>
        )}
        {error ? <p role="alert" className="mb-2 text-sm text-status-danger">{error}</p> : null}
        <button type="button" onClick={finish} disabled={!canFinish} className="w-full rounded-lg bg-gold-500 py-2.5 text-sm font-semibold text-on-gold hover:brightness-110 disabled:opacity-40">
          {pending ? "Signing…" : submitLabel}
        </button>
      </div>
    </div>
  );
}
