"use client";

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlideLayout = "cover" | "content" | "team" | "metrics" | "blank";

export type BlockType = "text" | "metric" | "bullets" | "divider";

export interface TextBlock {
  type: "text";
  value: string;
  size?: "sm" | "base" | "lg" | "xl" | "2xl";
  bold?: boolean;
}

export interface MetricBlock {
  type: "metric";
  number: string;
  label: string;
}

export interface BulletsBlock {
  type: "bullets";
  items: string[];
}

export interface DividerBlock {
  type: "divider";
}

export type Block = TextBlock | MetricBlock | BulletsBlock | DividerBlock;

export interface Slide {
  id: string;
  layout: SlideLayout;
  blocks: Block[];
}

export interface DeckData {
  __deck: true;
  slides: Slide[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultBlocks(layout: SlideLayout): Block[] {
  switch (layout) {
    case "cover":
      return [
        { type: "text", value: "Fund Name", size: "2xl", bold: true },
        { type: "text", value: "Subtitle / Vintage", size: "lg" },
        { type: "divider" },
        { type: "text", value: "Manager Name · City, Country", size: "sm" },
      ];
    case "content":
      return [
        { type: "text", value: "Slide Title", size: "xl", bold: true },
        { type: "text", value: "Body text goes here.", size: "base" },
      ];
    case "team":
      return [
        { type: "text", value: "Our Team", size: "xl", bold: true },
        {
          type: "bullets",
          items: [
            "Partner Name — Role, 20 yrs experience",
            "Partner Name — Role, 15 yrs experience",
            "Partner Name — Role, 12 yrs experience",
          ],
        },
      ];
    case "metrics":
      return [
        { type: "text", value: "Track Record", size: "xl", bold: true },
        { type: "metric", number: "2.4×", label: "Gross MOIC" },
        { type: "metric", number: "28%", label: "Gross IRR" },
        { type: "metric", number: "$850M", label: "AUM" },
        { type: "metric", number: "12", label: "Portfolio Companies" },
      ];
    case "blank":
    default:
      return [];
  }
}

function newSlide(layout: SlideLayout): Slide {
  return { id: uid(), layout, blocks: defaultBlocks(layout) };
}

export function parseDeck(content: string): DeckData | null {
  if (!content.startsWith('{"__deck"')) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "__deck" in parsed &&
      (parsed as Record<string, unknown>).__deck === true
    ) {
      return parsed as DeckData;
    }
    return null;
  } catch {
    return null;
  }
}

export function emptyDeck(): DeckData {
  return {
    __deck: true,
    slides: [newSlide("cover"), newSlide("content")],
  };
}

// ---------------------------------------------------------------------------
// Text sizes
// ---------------------------------------------------------------------------

const TEXT_SIZE_CLASSES: Record<NonNullable<TextBlock["size"]>, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-3xl",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EditableText({
  value,
  onChange,
  className,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={`w-full resize-none bg-transparent outline-none placeholder:text-fg-muted/40 ${className ?? ""}`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-transparent outline-none placeholder:text-fg-muted/40 ${className ?? ""}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Slide renderer (edit mode — blocks are editable inline)
// ---------------------------------------------------------------------------

function SlideEditor({
  slide,
  onChange,
  onDeleteBlock,
}: {
  slide: Slide;
  onChange: (s: Slide) => void;
  onDeleteBlock: (idx: number) => void;
}) {
  function updateBlock(idx: number, block: Block) {
    const blocks = slide.blocks.map((b, i) => (i === idx ? block : b));
    onChange({ ...slide, blocks });
  }

  function updateBullet(blockIdx: number, bulletIdx: number, value: string) {
    const block = slide.blocks[blockIdx];
    if (block.type !== "bullets") return;
    const items = block.items.map((it, i) => (i === bulletIdx ? value : it));
    updateBlock(blockIdx, { ...block, items });
  }

  function addBullet(blockIdx: number) {
    const block = slide.blocks[blockIdx];
    if (block.type !== "bullets") return;
    updateBlock(blockIdx, { ...block, items: [...block.items, ""] });
  }

  function removeBullet(blockIdx: number, bulletIdx: number) {
    const block = slide.blocks[blockIdx];
    if (block.type !== "bullets") return;
    const items = block.items.filter((_, i) => i !== bulletIdx);
    updateBlock(blockIdx, { ...block, items });
  }

  const isCover = slide.layout === "cover";
  const isMetrics = slide.layout === "metrics";

  return (
    <div
      className={`relative flex h-full w-full flex-col gap-3 overflow-y-auto p-8 ${
        isCover ? "items-center justify-center text-center" : ""
      }`}
    >
      {/* Layout label */}
      <span className="absolute right-3 top-2 rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted/50">
        {slide.layout}
      </span>

      {/* Metrics layout: title above, metric tiles in a grid */}
      {isMetrics ? (
        <>
          {slide.blocks
            .map((block, idx) => ({ block, idx }))
            .filter(({ block }) => block.type === "text")
            .map(({ block, idx }) => {
              const b = block as TextBlock;
              return (
                <div key={idx} className="group relative mb-2">
                  <EditableText
                    value={b.value}
                    onChange={(v) => updateBlock(idx, { ...b, value: v })}
                    placeholder="Title…"
                    className={`${TEXT_SIZE_CLASSES[b.size ?? "base"]} ${b.bold ? "font-bold" : ""} text-fg-primary`}
                  />
                  <DeleteBlockBtn onClick={() => onDeleteBlock(idx)} />
                </div>
              );
            })}
          <div className="grid grid-cols-2 gap-3">
            {slide.blocks.map((block, idx) => {
              if (block.type !== "metric") return null;
              return (
                <div key={idx} className="group relative flex flex-col items-center gap-1 rounded-lg border border-line bg-surface-1 px-4 py-3">
                  <EditableText
                    value={block.number}
                    onChange={(v) => updateBlock(idx, { ...block, number: v })}
                    placeholder="0×"
                    className="text-center font-display text-4xl font-bold text-gold-400"
                  />
                  <EditableText
                    value={block.label}
                    onChange={(v) => updateBlock(idx, { ...block, label: v })}
                    placeholder="Label"
                    className="text-center text-xs text-fg-secondary"
                  />
                  <DeleteBlockBtn onClick={() => onDeleteBlock(idx)} />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        slide.blocks.map((block, idx) => {
          if (block.type === "text") {
            return (
              <div key={idx} className="group relative">
                <EditableText
                  value={block.value}
                  onChange={(v) => updateBlock(idx, { ...block, value: v })}
                  placeholder="Text…"
                  className={`${TEXT_SIZE_CLASSES[block.size ?? "base"]} ${block.bold ? "font-bold" : ""} text-fg-primary`}
                  multiline={block.size === "base" || block.size === "sm"}
                />
                <DeleteBlockBtn onClick={() => onDeleteBlock(idx)} />
              </div>
            );
          }
          if (block.type === "metric") {
            return (
              <div key={idx} className="group relative flex flex-col items-center gap-1 rounded-lg border border-line bg-surface-1 px-4 py-3">
                <EditableText
                  value={block.number}
                  onChange={(v) => updateBlock(idx, { ...block, number: v })}
                  placeholder="0×"
                  className="text-center font-display text-4xl font-bold text-gold-400"
                />
                <EditableText
                  value={block.label}
                  onChange={(v) => updateBlock(idx, { ...block, label: v })}
                  placeholder="Label"
                  className="text-center text-xs text-fg-secondary"
                />
                <DeleteBlockBtn onClick={() => onDeleteBlock(idx)} />
              </div>
            );
          }
          if (block.type === "bullets") {
            return (
              <div key={idx} className="group relative flex flex-col gap-1">
                {block.items.map((item, bi) => (
                  <div key={bi} className="flex items-center gap-1.5">
                    <span className="text-fg-muted">•</span>
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => updateBullet(idx, bi, e.target.value)}
                      placeholder="Bullet point…"
                      className="flex-1 bg-transparent text-sm text-fg-primary outline-none placeholder:text-fg-muted/40"
                    />
                    <button
                      type="button"
                      onClick={() => removeBullet(idx, bi)}
                      className="text-fg-muted opacity-0 transition hover:text-status-danger group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => addBullet(idx)}
                    className="mt-1 text-xs text-gold-400 hover:underline"
                  >
                    + Add bullet
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteBlock(idx)}
                    className="mt-1 text-xs text-fg-muted opacity-0 transition hover:text-status-danger group-hover:opacity-100"
                  >
                    Remove block
                  </button>
                </div>
              </div>
            );
          }
          if (block.type === "divider") {
            return (
              <div key={idx} className="group relative">
                <hr className="border-line" />
                <DeleteBlockBtn onClick={() => onDeleteBlock(idx)} />
              </div>
            );
          }
          return null;
        })
      )}
    </div>
  );
}

function DeleteBlockBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[10px] text-fg-muted opacity-0 transition hover:bg-status-danger/20 hover:text-status-danger group-hover:opacity-100"
    >
      ✕
    </button>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail (mini preview, read-only)
// ---------------------------------------------------------------------------

function SlideThumbnail({ slide, active }: { slide: Slide; active: boolean }) {
  const firstText = slide.blocks.find((b) => b.type === "text") as TextBlock | undefined;
  const metricCount = slide.blocks.filter((b) => b.type === "metric").length;

  return (
    <div
      className={`flex h-14 w-full flex-col items-start justify-start gap-0.5 overflow-hidden rounded border p-1.5 transition ${
        active ? "border-gold-400 bg-gold-500/10" : "border-line bg-surface-1"
      }`}
    >
      <span className="truncate font-mono text-[8px] uppercase tracking-widest text-fg-muted">{slide.layout}</span>
      {firstText ? (
        <span className="line-clamp-2 text-[9px] leading-tight text-fg-secondary">{firstText.value}</span>
      ) : metricCount > 0 ? (
        <span className="text-[9px] text-fg-muted">{metricCount} metrics</span>
      ) : (
        <span className="text-[9px] text-fg-muted/40">Empty</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deck PDF export
// ---------------------------------------------------------------------------

function printDeck(deck: DeckData, docName: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  const safe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const slideHtml = deck.slides
    .map((slide) => {
      const isCover = slide.layout === "cover";
      const blockHtml = slide.blocks
        .map((block) => {
          if (block.type === "text") {
            const tag = block.bold ? "strong" : "span";
            const size = block.size === "2xl" ? "2em" : block.size === "xl" ? "1.5em" : block.size === "lg" ? "1.2em" : block.size === "sm" ? "0.85em" : "1em";
            return `<div style="font-size:${size};margin-bottom:0.5em;${isCover ? "text-align:center;" : ""}"><${tag}>${safe(block.value)}</${tag}></div>`;
          }
          if (block.type === "metric") {
            return `<div style="display:inline-block;border:1px solid #ccc;border-radius:8px;padding:12px 20px;margin:8px;text-align:center;"><div style="font-size:2.4em;font-weight:bold;color:#b8922c">${safe(block.number)}</div><div style="font-size:0.75em;color:#555">${safe(block.label)}</div></div>`;
          }
          if (block.type === "bullets") {
            return `<ul style="margin:0.5em 0 0.5em 1.5em;padding:0;">${block.items.map((it) => `<li style="margin-bottom:0.25em">${safe(it)}</li>`).join("")}</ul>`;
          }
          if (block.type === "divider") {
            return `<hr style="border:none;border-top:1px solid #ccc;margin:1em 0;"/>`;
          }
          return "";
        })
        .join("");

      return `<div style="page-break-after:always;width:100%;min-height:100vh;box-sizing:border-box;padding:60px;font-family:Georgia,serif;${isCover ? "display:flex;flex-direction:column;justify-content:center;align-items:center;" : ""}">
        ${blockHtml}
      </div>`;
    })
    .join("");

  win.document.write(
    `<!DOCTYPE html><html><head><title>${safe(docName)}</title>` +
      `<style>body{margin:0;padding:0;color:#111;line-height:1.6}@media print{@page{size:A4 landscape;margin:0}}</style>` +
      `</head><body>${slideHtml}</body></html>`,
  );
  win.document.close();
  win.print();
}

// ---------------------------------------------------------------------------
// Block palette
// ---------------------------------------------------------------------------

const BLOCK_OPTIONS: { type: BlockType; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "T" },
  { type: "metric", label: "Metric", icon: "#" },
  { type: "bullets", label: "Bullets", icon: "≡" },
  { type: "divider", label: "Divider", icon: "—" },
];

const LAYOUT_OPTIONS: { layout: SlideLayout; label: string }[] = [
  { layout: "cover", label: "Cover" },
  { layout: "content", label: "Content" },
  { layout: "team", label: "Team" },
  { layout: "metrics", label: "Metrics" },
  { layout: "blank", label: "Blank" },
];

function newBlock(type: BlockType): Block {
  switch (type) {
    case "text":
      return { type: "text", value: "", size: "base" };
    case "metric":
      return { type: "metric", number: "0×", label: "Label" };
    case "bullets":
      return { type: "bullets", items: [""] };
    case "divider":
      return { type: "divider" };
  }
}

// ---------------------------------------------------------------------------
// Main DeckBuilder component
// ---------------------------------------------------------------------------

export function DeckBuilder({
  initialDeck,
  docName,
  onSave,
  saving,
}: {
  initialDeck: DeckData;
  docName: string;
  onSave: (deckJson: string) => void;
  saving: boolean;
}) {
  const [deck, setDeck] = useState<DeckData>(initialDeck);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const activeSlide = deck.slides[activeIdx] ?? deck.slides[0];

  // Slide mutations
  function updateSlide(slide: Slide) {
    setDeck((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slide.id ? slide : s)),
    }));
  }

  function addSlide(layout: SlideLayout) {
    const s = newSlide(layout);
    setDeck((d) => {
      const slides = [...d.slides.slice(0, activeIdx + 1), s, ...d.slides.slice(activeIdx + 1)];
      return { ...d, slides };
    });
    setActiveIdx(activeIdx + 1);
  }

  function duplicateSlide() {
    if (!activeSlide) return;
    const copy: Slide = { ...activeSlide, id: uid(), blocks: activeSlide.blocks.map((b) => ({ ...b })) };
    setDeck((d) => {
      const slides = [...d.slides.slice(0, activeIdx + 1), copy, ...d.slides.slice(activeIdx + 1)];
      return { ...d, slides };
    });
    setActiveIdx(activeIdx + 1);
  }

  function deleteSlide() {
    if (deck.slides.length <= 1) return;
    const slides = deck.slides.filter((_, i) => i !== activeIdx);
    setDeck((d) => ({ ...d, slides }));
    setActiveIdx(Math.max(0, activeIdx - 1));
  }

  function addBlock(type: BlockType) {
    if (!activeSlide) return;
    updateSlide({ ...activeSlide, blocks: [...activeSlide.blocks, newBlock(type)] });
  }

  function deleteBlock(blockIdx: number) {
    if (!activeSlide) return;
    updateSlide({ ...activeSlide, blocks: activeSlide.blocks.filter((_, i) => i !== blockIdx) });
  }

  function changeLayout(layout: SlideLayout) {
    if (!activeSlide) return;
    updateSlide({ ...activeSlide, layout });
  }

  // Drag to reorder
  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      setDragOverIdx(idx);
    },
    [dragIdx],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) {
        setDragIdx(null);
        setDragOverIdx(null);
        return;
      }
      setDeck((d) => {
        const slides = [...d.slides];
        const [moved] = slides.splice(dragIdx, 1);
        slides.splice(idx, 0, moved);
        return { ...d, slides };
      });
      setActiveIdx(idx);
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [dragIdx],
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  function handleSave() {
    onSave(JSON.stringify(deck));
  }

  if (!activeSlide) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Deck Builder</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => printDeck(deck, docName)}
            className="rounded-md border border-line px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary transition hover:text-fg-primary"
          >
            ⤓ PDF
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-[140px_1fr_180px] gap-4 overflow-hidden">
        {/* Left: slide strip */}
        <div
          ref={stripRef}
          className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto rounded-xl border border-line bg-surface-0 p-2"
        >
          {deck.slides.map((slide, idx) => (
            <div
              key={slide.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveIdx(idx)}
              className={`cursor-pointer select-none transition ${
                dragOverIdx === idx ? "opacity-50 ring-2 ring-gold-400" : ""
              } ${dragIdx === idx ? "opacity-30" : ""}`}
            >
              <div className="flex items-center gap-1">
                <span className="w-4 text-center font-mono text-[8px] text-fg-muted">{idx + 1}</span>
                <div className="flex-1">
                  <SlideThumbnail slide={slide} active={idx === activeIdx} />
                </div>
              </div>
            </div>
          ))}

          {/* Add slide */}
          <div className="mt-1 border-t border-line pt-2">
            <p className="mb-1 font-mono text-[8px] uppercase tracking-wider text-fg-muted">Add slide</p>
            <div className="flex flex-col gap-1">
              {LAYOUT_OPTIONS.map(({ layout, label }) => (
                <button
                  key={layout}
                  type="button"
                  onClick={() => addSlide(layout)}
                  className="rounded border border-line bg-surface-1 px-2 py-1 text-left text-[10px] text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center: slide canvas */}
        <div className="flex flex-col gap-2">
          {/* Slide canvas — 16:9 */}
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <div className="absolute inset-0 overflow-hidden rounded-xl border border-line bg-surface-0 shadow-sm">
              <SlideEditor
                slide={activeSlide}
                onChange={updateSlide}
                onDeleteBlock={deleteBlock}
              />
            </div>
          </div>

          {/* Bottom slide controls */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-fg-muted">
              Slide {activeIdx + 1} / {deck.slides.length}
            </span>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                onClick={duplicateSlide}
                className="rounded border border-line px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={deleteSlide}
                disabled={deck.slides.length <= 1}
                className="rounded border border-status-danger/30 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/10 disabled:opacity-30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Right: block palette + layout switcher */}
        <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-0 p-3">
          {/* Layout */}
          <div>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Layout</p>
            <div className="flex flex-col gap-1">
              {LAYOUT_OPTIONS.map(({ layout, label }) => (
                <button
                  key={layout}
                  type="button"
                  onClick={() => changeLayout(layout)}
                  className={`rounded border px-2 py-1 text-left text-xs transition ${
                    activeSlide.layout === layout
                      ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                      : "border-line text-fg-secondary hover:text-fg-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-line" />

          {/* Blocks */}
          <div>
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Add Block</p>
            <div className="flex flex-col gap-1">
              {BLOCK_OPTIONS.map(({ type, label, icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  className="flex items-center gap-2 rounded border border-line px-2 py-1.5 text-left text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
                >
                  <span className="w-4 text-center font-mono text-fg-muted">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-line" />

          {/* Text size (for active text blocks hint) */}
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Tip</p>
            <p className="mt-1 text-[10px] leading-snug text-fg-muted">
              Click any text to edit it inline. Drag slides in the left panel to reorder.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
