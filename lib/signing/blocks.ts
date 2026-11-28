// lib/signing/blocks.ts
//
// The signature blocks an owner can place on a document, and how each behaves.
// Pure, so the placement screen, the signing screen and the server agree.

export type BlockType = "name" | "signature" | "initials" | "datetime" | "company" | "title" | "address" | "email" | "phone" | "other";

export interface BlockSpec {
  type: BlockType;
  label: string;
  /** How the signer fills it. `auto` blocks fill themselves at signing time. */
  input: "signature" | "initials" | "text" | "multiline" | "auto";
  /** The keyboard a text block asks for on a phone. */
  inputType?: "email" | "tel";
  /** Default size on the page, as a percentage of page width and height. */
  widthPct: number;
  heightPct: number;
}

/** Every block is the same size on the page, so a placed set looks even and lines up. */
export const BLOCK_WIDTH_PCT = 28;
export const BLOCK_HEIGHT_PCT = 4;

export const BLOCKS: BlockSpec[] = [
  { type: "name", label: "Name", input: "text", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "signature", label: "Signature", input: "signature", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "initials", label: "Initials", input: "initials", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "datetime", label: "Date and time", input: "auto", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "company", label: "Company", input: "text", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "title", label: "Title", input: "text", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "address", label: "Address", input: "multiline", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "email", label: "Email", input: "text", inputType: "email", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  { type: "phone", label: "Phone", input: "text", inputType: "tel", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
  // Anything the others do not cover: the sender names it ("Tax ID", "Witness name") and the signer types an answer.
  { type: "other", label: "Other", input: "text", widthPct: BLOCK_WIDTH_PCT, heightPct: BLOCK_HEIGHT_PCT },
];

/** The longest name a sender may give an Other block. */
export const MAX_OTHER_LABEL = 60;

/** What a block is called on screen: an Other block carries the sender's own name for it. */
export function blockLabel(type: string, label?: string | null): string {
  if (type === "other") return (label ?? "").trim().slice(0, MAX_OTHER_LABEL) || "Other";
  return blockSpec(type)?.label ?? type;
}

/** A reason a typed value is not acceptable for its block, or null. Browsers can be bypassed; the server asks too. */
export function blockValueProblem(fieldType: string, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter a valid email address.";
  if (fieldType === "phone" && (!/^[+()\d][\d\s().+-]*$/.test(v) || v.replace(/\D/g, "").length < 7 || v.replace(/\D/g, "").length > 15)) return "Enter a valid phone number.";
  return null;
}

/**
 * What a new block starts as. The signature, the name and the date and time are what a signing
 * needs; the rest (company, title, address, email, phone) are often not, so they start optional
 * and the sender turns on the ones that matter. Either way, one click flips it.
 */
export function defaultRequired(type: string): boolean {
  return type === "signature" || type === "initials" || type === "name" || type === "datetime";
}

/** Blocks the signer marks by hand (a drawn, typed or uploaded mark) rather than by typing a value. */
export const isInkInput = (input: string | undefined | null): boolean => input === "signature" || input === "initials";

/** "Jane Q. Smith" becomes "JQS": the starting point for typed initials, which the signer can change. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map((w) => Array.from(w)[0]?.toUpperCase() ?? "").join("");
}

/** The two colours a block wears: red when the signer must complete it, blue when they may skip it. */
export const REQUIRED_COLOR = "#dc2626";
export const OPTIONAL_COLOR = "#2563eb";
export const blockColor = (required: boolean) => (required ? REQUIRED_COLOR : OPTIONAL_COLOR);

const BY_TYPE = new Map<string, BlockSpec>(BLOCKS.map((b) => [b.type, b]));

/** Older envelopes use the earlier types; they behave like their nearest block. */
const LEGACY: Record<string, BlockType> = { text: "title", date: "datetime", checkbox: "name" };

export function blockSpec(fieldType: string): BlockSpec | null {
  return BY_TYPE.get(fieldType) ?? BY_TYPE.get(LEGACY[fieldType] ?? "") ?? null;
}

/** A block on a page, as the database and the screens hold it. */
export interface PlacedBlock {
  id: string;
  recipientId: string;
  type: BlockType;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  prefill: string | null;
  locked: boolean;
  /** Only an Other block has its own name. */
  label?: string | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * How small and how large a block may be made by dragging its corner: never so small it cannot be
 * clicked, never more than most of a page, and always inside the page.
 */
export const MIN_BLOCK_WIDTH_PCT = 8;
export const MIN_BLOCK_HEIGHT_PCT = 2.5;
export const MAX_BLOCK_WIDTH_PCT = 90;
export const MAX_BLOCK_HEIGHT_PCT = 25;

/** Keep a block wholly on its page; positions arrive from the browser. */
export function clampBlock<T extends { xPct: number; yPct: number; widthPct: number; heightPct: number }>(b: T): T {
  const widthPct = clamp(Number.isFinite(b.widthPct) ? b.widthPct : 20, 3, MAX_BLOCK_WIDTH_PCT);
  const heightPct = clamp(Number.isFinite(b.heightPct) ? b.heightPct : 4, 1.5, MAX_BLOCK_HEIGHT_PCT);
  return {
    ...b,
    widthPct,
    heightPct,
    xPct: clamp(Number.isFinite(b.xPct) ? b.xPct : 0, 0, 100 - widthPct),
    yPct: clamp(Number.isFinite(b.yPct) ? b.yPct : 0, 0, 100 - heightPct),
  };
}

/**
 * A new block anchored at a click at (xPct, yPct) of a page: the block starts at the click and is
 * centred on it vertically, so the × drawn at its left-middle sits exactly where the click was and
 * what the signer enters starts right there. Near the right or bottom edge the block is kept on the
 * page, which can move it left or up.
 */
export function newBlockAt(type: BlockType, xPct: number, yPct: number): Pick<PlacedBlock, "xPct" | "yPct" | "widthPct" | "heightPct"> {
  const spec = BY_TYPE.get(type)!;
  return clampBlock({
    xPct,
    yPct: yPct - spec.heightPct / 2,
    widthPct: spec.widthPct,
    heightPct: spec.heightPct,
  });
}

const OFFSET_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A moment as the signer's own wall clock with its UTC offset: "2026-11-04T14:03:00-08:00". */
export function toOffsetIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * What a date-and-time block shows. A time the signer chose keeps their own clock and
 * offset ("Nov 4, 2026, 14:03 UTC-08:00"); a server stamp shows in UTC with seconds.
 */
export function formatBlockDateTime(iso: string): string {
  const m = OFFSET_ISO.exec(iso);
  if (m && m[7] !== "Z") {
    return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}, ${m[4]}:${m[5]} UTC${m[7]}`;
  }
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

/** A signer may set the printed date and time within this window of the real signing moment. */
export const DATETIME_PAST_MS = 30 * 24 * 60 * 60 * 1000;
export const DATETIME_FUTURE_MS = 24 * 60 * 60 * 1000;
/** Beyond this gap from the real time, the signing event records both the chosen and the true time. */
const DATETIME_ADJUSTED_MS = 2 * 60 * 1000;

export interface DateTimeResolution {
  /** What is stored and printed on the page. */
  value: string;
  /** The signer's choice, or null if they chose nothing. */
  chosen: string | null;
  /** The choice differs enough from the real time to be noted in the audit trail. */
  adjusted: boolean;
  problem: string | null;
}

/**
 * The date and time a signer's block ends up with. The wheels start at now and the signer
 * may change them; the server decides what is acceptable and always knows the true time
 * (`nowIso`), which stays in the signing record whatever is printed on the page.
 */
export function resolveDateTimeResponse(chosen: unknown, nowIso: string): DateTimeResolution {
  const raw = typeof chosen === "string" ? chosen.trim() : "";
  if (!raw) return { value: nowIso, chosen: null, adjusted: false, problem: null };
  const t = Date.parse(raw);
  if (!OFFSET_ISO.test(raw) || Number.isNaN(t)) return { value: nowIso, chosen: raw, adjusted: false, problem: "Choose a valid date and time." };
  const now = Date.parse(nowIso);
  if (t < now - DATETIME_PAST_MS || t > now + DATETIME_FUTURE_MS) {
    return { value: nowIso, chosen: raw, adjusted: false, problem: "Choose a date and time within the last 30 days." };
  }
  return { value: raw, chosen: raw, adjusted: Math.abs(t - now) > DATETIME_ADJUSTED_MS, problem: null };
}

/**
 * A block copied to every other page of the document, in the same spot: how initials get onto
 * each page in one click. A page that already has the same kind of block for the same person
 * in about that spot is left alone, so doing it twice adds nothing.
 */
export function copyToEveryPage<T extends { recipientId: string; type: string; page: number; xPct: number; yPct: number }>(
  block: T,
  pageCount: number,
  existing: readonly T[],
): T[] {
  const out: T[] = [];
  for (let page = 1; page <= pageCount; page++) {
    if (page === block.page) continue;
    const there = existing.some(
      (b) => b.page === page && b.recipientId === block.recipientId && b.type === block.type && Math.abs(b.xPct - block.xPct) < 2 && Math.abs(b.yPct - block.yPct) < 2,
    );
    if (!there) out.push({ ...block, page });
  }
  return out;
}

/**
 * A block resized by its bottom-right corner: the top-left stays put and the corner moves by
 * (dxPct, dyPct) of the page, held between the smallest and largest sizes and inside the page.
 */
export function resizeBlock<T extends { xPct: number; yPct: number; widthPct: number; heightPct: number }>(b: T, dxPct: number, dyPct: number): T {
  const dx = Number.isFinite(dxPct) ? dxPct : 0;
  const dy = Number.isFinite(dyPct) ? dyPct : 0;
  const widthPct = clamp(b.widthPct + dx, MIN_BLOCK_WIDTH_PCT, Math.min(MAX_BLOCK_WIDTH_PCT, 100 - b.xPct));
  const heightPct = clamp(b.heightPct + dy, MIN_BLOCK_HEIGHT_PCT, Math.min(MAX_BLOCK_HEIGHT_PCT, 100 - b.yPct));
  return { ...b, widthPct, heightPct };
}
