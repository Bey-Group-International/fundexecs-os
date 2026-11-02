"use client";

// Open the document, click where each block goes, then send. The owner picks a block
// type, picks who fills it (the recipient or themselves), and clicks the page. Blocks
// can be dragged, and text blocks can carry a value the signer sees (optionally locked).
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PdfPages } from "@/components/signing/PdfPages";
import { BLOCKS, blockSpec, clampBlock, newBlockAt, type BlockType } from "@/lib/signing/blocks";

interface Party {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface Block {
  key: string;
  recipientId: string;
  type: BlockType;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  prefill: string;
  locked: boolean;
}

const TINT = ["#C9A227", "#3B82F6"]; // recipient, owner

let counter = 0;
const nextKey = () => `b${Date.now().toString(36)}${counter++}`;

export interface BlockPlacerProps {
  title: string;
  /** Where the blocks and parties are read and saved (an envelope's, or a room file's). */
  fieldsUrl: string;
  /** The document's pages. */
  pdfUrl: string;
  /** Present for an envelope: the owner sends it from here. Absent for a room file's template. */
  sendUrl?: string;
  /** Where to go once it is sent or finished. */
  doneHref: string;
  /** Pre-fill a name block with the party's name (an envelope knows it; a template does not). */
  prefillNames?: boolean;
  /** A line under the title. */
  hint?: string;
}

export function BlockPlacer({ title, fieldsUrl, pdfUrl, sendUrl, doneHref, prefillNames = true, hint }: BlockPlacerProps) {
  const router = useRouter();
  const [parties, setParties] = useState<Party[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tool, setTool] = useState<BlockType | null>("signature");
  const [partyId, setPartyId] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const drag = useRef<{ key: string; startX: number; startY: number; x0: number; y0: number; w: number; h: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(fieldsUrl, { cache: "no-store" });
    if (!res.ok) return setError("Could not load this document.");
    const j = (await res.json()) as {
      recipients: Party[];
      fields: { id: string; recipient_id: string; field_type: string; page: number; x_pct: number; y_pct: number; width_pct: number; height_pct: number; required: boolean; prefill: string | null; locked: boolean }[];
    };
    setParties(j.recipients);
    setPartyId((cur) => cur || j.recipients.find((r) => r.role !== "owner")?.id || j.recipients[0]?.id || "");
    setBlocks(
      j.fields
        .filter((f) => blockSpec(f.field_type))
        .map((f) => ({
          key: f.id,
          recipientId: f.recipient_id,
          type: blockSpec(f.field_type)!.type,
          page: f.page,
          xPct: f.x_pct,
          yPct: f.y_pct,
          widthPct: f.width_pct,
          heightPct: f.height_pct,
          required: f.required,
          prefill: f.prefill ?? "",
          locked: f.locked,
        })),
    );
  }, [fieldsUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const partyIndex = useMemo(() => new Map(parties.map((p, i) => [p.id, i === 0 ? 0 : p.role === "owner" ? 1 : 0])), [parties]);
  const sel = blocks.find((b) => b.key === selected) ?? null;
  const party = (id: string) => parties.find((p) => p.id === id);
  const signer = parties.find((p) => p.role !== "owner");
  const owner = parties.find((p) => p.role === "owner");

  function place(page: number, xPct: number, yPct: number) {
    if (!tool || !partyId) return;
    const pos = newBlockAt(tool, xPct, yPct);
    const target = party(partyId);
    // A name block starts with the signer's name, which they can still change.
    const prefill = prefillNames && tool === "name" ? target?.name ?? "" : "";
    const b: Block = { key: nextKey(), recipientId: partyId, type: tool, page, ...pos, required: true, prefill, locked: false };
    setBlocks((cur) => [...cur, b]);
    setSelected(b.key);
    setNotice(null);
  }

  function patch(key: string, p: Partial<Block>) {
    setBlocks((cur) => cur.map((b) => (b.key === key ? { ...b, ...p } : b)));
  }

  function save(): Promise<boolean> {
    return fetch(fieldsUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: blocks.map((b) => ({ recipientId: b.recipientId, type: b.type, page: b.page, xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, heightPct: b.heightPct, required: b.required, prefill: b.prefill, locked: b.locked })),
      }),
    }).then(async (res) => {
      if (res.ok) return true;
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save the blocks.");
      return false;
    });
  }

  function missingSignature(): string | null {
    for (const p of parties) {
      if (!blocks.some((b) => b.recipientId === p.id && b.type === "signature")) {
        return p.role === "owner" ? "Add a signature block for yourself: you countersign after the recipient." : `Add a signature block for ${p.name}.`;
      }
    }
    return null;
  }

  function onSave() {
    setError(null);
    startTransition(async () => {
      if (await save()) setNotice("Saved.");
    });
  }

  function onSend() {
    setError(null);
    const miss = missingSignature();
    if (miss) return setError(miss);
    startTransition(async () => {
      if (!(await save())) return;
      const res = sendUrl ? await fetch(sendUrl, { method: "POST" }) : null;
      if (res && !res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not send the document.");
      router.push(doneHref);
      router.refresh();
    });
  }

  // Dragging a block: pointer moves translate to percentages of the page it sits on.
  function startDrag(e: React.PointerEvent, b: Block, pageW: number, pageH: number) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(b.key);
    drag.current = { key: b.key, startX: e.clientX, startY: e.clientY, x0: b.xPct, y0: b.yPct, w: pageW, h: pageH };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const b = blocks.find((x) => x.key === d.key);
    if (!b) return;
    const moved = clampBlock({ xPct: d.x0 + ((e.clientX - d.startX) / d.w) * 100, yPct: d.y0 + ((e.clientY - d.startY) / d.h) * 100, widthPct: b.widthPct, heightPct: b.heightPct });
    patch(d.key, { xPct: moved.xPct, yPct: moved.yPct });
  }
  const endDrag = () => {
    drag.current = null;
  };

  const tint = (id: string) => TINT[partyIndex.get(id) ?? 0] ?? TINT[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-semibold text-fg-primary">{title}</h1>
          <p className="text-sm text-fg-secondary">{hint ?? "Click a block, then click the page where it goes. Drag to move."}</p>
        </div>
        <button type="button" onClick={onSave} disabled={pending} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary hover:bg-surface-2 disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={onSend} disabled={pending} className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-on-gold hover:brightness-110 disabled:opacity-50">
          {pending ? "Working…" : sendUrl ? "Send for signature" : "Save and finish"}
        </button>
      </header>
      {error ? <p role="alert" className="mb-3 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-fg-secondary">{notice}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Who fills it</h2>
            <div className="flex flex-col gap-1.5">
              {[signer, owner].filter(Boolean).map((p) => (
                <button
                  key={p!.id}
                  type="button"
                  onClick={() => setPartyId(p!.id)}
                  aria-pressed={partyId === p!.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${partyId === p!.id ? "border-gold-500/60 bg-gold-500/10 text-fg-primary" : "border-line text-fg-secondary hover:bg-surface-2"}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint(p!.id) }} />
                  <span className="min-w-0 flex-1 truncate">{p!.role === "owner" ? "You (countersign)" : p!.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Blocks</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {BLOCKS.map((b) => (
                <button
                  key={b.type}
                  type="button"
                  onClick={() => setTool(tool === b.type ? null : b.type)}
                  aria-pressed={tool === b.type}
                  className={`rounded-lg border px-2 py-2 text-xs transition ${tool === b.type ? "border-gold-500/60 bg-gold-500/10 text-fg-primary" : "border-line text-fg-secondary hover:bg-surface-2"}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-fg-muted">{tool ? `Click the page to place a ${blockSpec(tool)!.label.toLowerCase()} block.` : "Pick a block to place."}</p>
          </section>

          {sel ? (
            <section className="rounded-xl border border-line bg-surface-1 p-3">
              <h2 className="mb-2 text-sm font-semibold text-fg-primary">{blockSpec(sel.type)!.label}</h2>
              <p className="mb-2 text-xs text-fg-muted">For {party(sel.recipientId)?.role === "owner" ? "you" : party(sel.recipientId)?.name}</p>
              <label className="mb-2 flex items-center gap-2 text-xs text-fg-secondary">
                <input type="checkbox" checked={sel.required} onChange={(e) => patch(sel.key, { required: e.target.checked })} /> Required
              </label>
              {["name", "company", "title", "address"].includes(sel.type) ? (
                <>
                  <label className="mb-1 block text-xs text-fg-secondary">Pre-filled value</label>
                  <textarea
                    rows={sel.type === "address" ? 3 : 1}
                    value={sel.prefill}
                    onChange={(e) => patch(sel.key, { prefill: e.target.value })}
                    className="w-full rounded-md border border-line bg-surface-0 px-2 py-1.5 text-xs text-fg-primary focus:border-gold-400 focus:outline-none"
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
                    <input type="checkbox" checked={sel.locked} disabled={!sel.prefill.trim()} onChange={(e) => patch(sel.key, { locked: e.target.checked })} /> Lock (signer cannot change it)
                  </label>
                </>
              ) : null}
              {sel.type === "datetime" ? <p className="text-xs text-fg-muted">Filled automatically when it is signed.</p> : null}
              <button
                type="button"
                onClick={() => {
                  setBlocks((cur) => cur.filter((b) => b.key !== sel.key));
                  setSelected(null);
                }}
                className="mt-3 text-xs text-status-danger underline underline-offset-2"
              >
                Delete block
              </button>
            </section>
          ) : null}
        </aside>

        <div className="rounded-xl bg-surface-2 p-3">
          <PdfPages src={pdfUrl}>
            {({ page, width, height }) => (
              <div
                className={`absolute inset-0 ${tool ? "cursor-crosshair" : ""}`}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  if (tool) place(page, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
                  else setSelected(null);
                }}
              >
                {blocks
                  .filter((b) => b.page === page)
                  .map((b) => (
                    <div
                      key={b.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${blockSpec(b.type)!.label} block`}
                      onPointerDown={(e) => startDrag(e, b, width, height)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onKeyDown={(e) => {
                        if (e.key === "Delete" || e.key === "Backspace") {
                          setBlocks((cur) => cur.filter((x) => x.key !== b.key));
                          setSelected(null);
                        }
                      }}
                      className={`absolute flex cursor-move items-center overflow-hidden rounded-sm border-2 px-1 text-[10px] font-semibold leading-tight ${selected === b.key ? "ring-2 ring-white/70" : ""}`}
                      style={{
                        left: `${b.xPct}%`,
                        top: `${b.yPct}%`,
                        width: `${b.widthPct}%`,
                        height: `${b.heightPct}%`,
                        borderColor: tint(b.recipientId),
                        background: `${tint(b.recipientId)}26`,
                        color: "#111827",
                        touchAction: "none",
                      }}
                    >
                      {blockSpec(b.type)!.label}
                      {b.prefill ? <span className="ml-1 truncate font-normal opacity-70">· {b.prefill}</span> : null}
                    </div>
                  ))}
              </div>
            )}
          </PdfPages>
        </div>
      </div>
    </div>
  );
}
