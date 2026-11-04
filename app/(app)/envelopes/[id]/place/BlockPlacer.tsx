"use client";

// Open the document, click where a block goes, choose what it is, then send. A click on the
// page opens a small menu right there: who it is for (the recipient or you) and the block
// types. Picking one drops the block on that spot and closes the menu (so does Esc, or a
// click anywhere else). Blocks can be dragged; click one to change what it asks for
// (required, a pre-filled value, locked).
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
const PREFILLABLE = ["name", "company", "title", "address", "email", "phone"];

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
  // The open menu: the page and the spot (as percentages of it) that was clicked.
  const [menu, setMenu] = useState<{ page: number; xPct: number; yPct: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setSelected(null);
        setMenu(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        setBlocks((cur) => cur.filter((b) => b.key !== selected));
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // A click anywhere outside the menu and the page closes the menu.
  useEffect(() => {
    if (!menu) return;
    function onDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || menuRef.current?.contains(t) || t.closest("[data-page-layer]")) return;
      setMenu(null);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const partyIndex = useMemo(() => new Map(parties.map((p, i) => [p.id, i === 0 ? 0 : p.role === "owner" ? 1 : 0])), [parties]);
  const sel = blocks.find((b) => b.key === selected) ?? null;
  const party = (id: string) => parties.find((p) => p.id === id);
  const signer = parties.find((p) => p.role !== "owner");
  const owner = parties.find((p) => p.role === "owner");

  function place(type: BlockType, page: number, xPct: number, yPct: number) {
    if (!partyId) return;
    const pos = newBlockAt(type, xPct, yPct);
    const target = party(partyId);
    // A name or email block starts with the person's own, which they can still change.
    const prefill = prefillNames ? (type === "name" ? target?.name : type === "email" ? target?.email : "") ?? "" : "";
    const b: Block = { key: nextKey(), recipientId: partyId, type, page, ...pos, required: true, prefill, locked: false };
    setBlocks((cur) => [...cur, b]);
    setSelected(null);
    setMenu(null);
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
    setMenu(null);
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

  const who = [signer, owner].filter((p): p is Party => Boolean(p));
  const hasSignature = (id: string) => blocks.some((b) => b.recipientId === id && b.type === "signature");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-semibold text-fg-primary">{title}</h1>
          {hint ? <p className="text-sm text-fg-secondary">{hint}</p> : null}
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

      <p className="mb-3 text-sm text-fg-secondary">Click the page where a block goes, then choose what it is. Each spot shows as a ×; drag it to move it, click it to change it.</p>

      <div className={sel ? "sticky top-0 z-10 mb-4 rounded-xl border border-line bg-surface-1/95 p-3 backdrop-blur" : "hidden"}>
        {sel ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2 text-xs text-fg-secondary">
            <span className="font-semibold text-fg-primary">
              {blockSpec(sel.type)!.label} <span className="font-normal text-fg-muted">for {party(sel.recipientId)?.role === "owner" ? "you" : party(sel.recipientId)?.name}</span>
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={sel.required} onChange={(e) => patch(sel.key, { required: e.target.checked })} /> Required
            </label>
            {PREFILLABLE.includes(sel.type) ? (
              <>
                <input
                  aria-label="Pre-filled value"
                  placeholder="Pre-filled value (optional)"
                  value={sel.prefill}
                  onChange={(e) => patch(sel.key, { prefill: e.target.value })}
                  className="min-w-[10rem] flex-1 rounded-md border border-line bg-surface-0 px-2 py-1 text-xs text-fg-primary focus:border-gold-400 focus:outline-none"
                />
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={sel.locked} disabled={!sel.prefill.trim()} onChange={(e) => patch(sel.key, { locked: e.target.checked })} /> Lock
                </label>
              </>
            ) : null}
            {sel.type === "datetime" ? <span className="text-fg-muted">Starts at the signing moment; the signer can adjust it, and the true time is recorded.</span> : null}
            <button
              type="button"
              onClick={() => {
                setBlocks((cur) => cur.filter((b) => b.key !== sel.key));
                setSelected(null);
              }}
              className="ml-auto text-status-danger underline underline-offset-2"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      <div>
        <div className="rounded-xl bg-surface-2 p-3">
          <PdfPages src={pdfUrl}>
            {({ page, width, height }) => (
              <div
                data-page-layer
                className="absolute inset-0 cursor-crosshair"
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setSelected(null);
                  setMenu({ page, xPct: ((e.clientX - r.left) / r.width) * 100, yPct: ((e.clientY - r.top) / r.height) * 100 });
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
                      className={`absolute flex cursor-move items-center ${selected === b.key ? "rounded-sm border border-dashed" : ""}`}
                      style={{
                        left: `${b.xPct}%`,
                        top: `${b.yPct}%`,
                        width: `${b.widthPct}%`,
                        height: `${b.heightPct}%`,
                        borderColor: tint(b.recipientId),
                        touchAction: "none",
                      }}
                    >
                      <button
                        type="button"
                        aria-label={`Delete ${blockSpec(b.type)!.label} block`}
                        title="Delete this block"
                        // Not a drag, and not a click on the page behind it.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setBlocks((cur) => cur.filter((x) => x.key !== b.key));
                          setSelected((cur) => (cur === b.key ? null : cur));
                        }}
                        className="absolute -right-2.5 -top-2.5 z-10 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border bg-white text-[11px] font-bold leading-none text-status-danger shadow-sm hover:bg-status-danger hover:text-white"
                        style={{ borderColor: "currentColor" }}
                      >
                        −
                      </button>
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 -translate-x-1/2 items-center justify-center rounded-full border-2 bg-white/90 text-xs font-bold leading-none"
                        style={{ borderColor: tint(b.recipientId), color: tint(b.recipientId) }}
                      >
                        ×
                      </span>
                    </div>
                  ))}
                {menu && menu.page === page ? (
                  // The × appears at the click at once, where the block will start; the menu sits just beside it.
                  <span
                    aria-hidden="true"
                    data-pending-marker
                    className="pointer-events-none absolute z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-white/90 text-xs font-bold leading-none"
                    style={{ left: `${menu.xPct}%`, top: `${menu.yPct}%`, borderColor: tint(partyId), color: tint(partyId) }}
                  >
                    ×
                  </span>
                ) : null}
                {menu && menu.page === page ? (
                  <div
                    ref={menuRef}
                    role="menu"
                    aria-label="Add a block"
                    className="absolute z-20 w-52 rounded-xl border border-line bg-surface-0 p-2 text-sm shadow-xl"
                    style={{
                      left: `calc(${menu.xPct}% ${menu.xPct > 55 ? "-" : "+"} 16px)`,
                      top: `calc(${menu.yPct}% ${menu.yPct > 60 ? "-" : "+"} 16px)`,
                      transform: `translate(${menu.xPct > 55 ? "-100%" : "0"}, ${menu.yPct > 60 ? "-100%" : "0"})`,
                    }}
                  >
                    <div role="group" aria-label="Who it is for" className="mb-1.5 flex overflow-hidden rounded-lg border border-line">
                      {who.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPartyId(p.id)}
                          aria-pressed={partyId === p.id}
                          className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-1 text-xs transition ${partyId === p.id ? "bg-gold-500/15 text-fg-primary" : "text-fg-secondary hover:bg-surface-2"}`}
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tint(p.id) }} />
                          <span className="truncate">{p.role === "owner" ? "Me" : p.name}</span>
                          {hasSignature(p.id) ? <span aria-label="has a signature block" className="text-emerald-400">✓</span> : <span aria-label="needs a signature block" className="text-amber-400">!</span>}
                        </button>
                      ))}
                    </div>
                    {BLOCKS.map((bl) => (
                      <button
                        key={bl.type}
                        type="button"
                        role="menuitem"
                        onClick={() => place(bl.type, menu.page, menu.xPct, menu.yPct)}
                        className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                      >
                        {bl.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </PdfPages>
        </div>
      </div>
    </div>
  );
}
