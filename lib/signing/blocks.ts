// lib/signing/blocks.ts
//
// The signature blocks an owner can place on a document, and how each behaves.
// Pure, so the placement screen, the signing screen and the server agree.

export type BlockType = "name" | "signature" | "datetime" | "company" | "title" | "address" | "email" | "phone";

export interface BlockSpec {
  type: BlockType;
  label: string;
  /** How the signer fills it. `auto` blocks fill themselves at signing time. */
  input: "signature" | "text" | "multiline" | "auto";
  /** The keyboard a text block asks for on a phone. */
  inputType?: "email" | "tel";
  /** Default size on the page, as a percentage of page width and height. */
  widthPct: number;
  heightPct: number;
}

export const BLOCKS: BlockSpec[] = [
  { type: "name", label: "Name", input: "text", widthPct: 24, heightPct: 3.5 },
  { type: "signature", label: "Signature", input: "signature", widthPct: 26, heightPct: 7 },
  { type: "datetime", label: "Date and time", input: "auto", widthPct: 24, heightPct: 3.5 },
  { type: "company", label: "Company", input: "text", widthPct: 28, heightPct: 3.5 },
  { type: "title", label: "Title", input: "text", widthPct: 22, heightPct: 3.5 },
  { type: "address", label: "Address", input: "multiline", widthPct: 34, heightPct: 8 },
  { type: "email", label: "Email", input: "text", inputType: "email", widthPct: 30, heightPct: 3.5 },
  { type: "phone", label: "Phone", input: "text", inputType: "tel", widthPct: 22, heightPct: 3.5 },
];

/** A reason a typed value is not acceptable for its block, or null. Browsers can be bypassed; the server asks too. */
export function blockValueProblem(fieldType: string, value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (fieldType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Enter a valid email address.";
  if (fieldType === "phone" && (!/^[+()\d][\d\s().+-]*$/.test(v) || v.replace(/\D/g, "").length < 7 || v.replace(/\D/g, "").length > 15)) return "Enter a valid phone number.";
  return null;
}

const BY_TYPE = new Map<string, BlockSpec>(BLOCKS.map((b) => [b.type, b]));

/** Older envelopes use the earlier types; they behave like their nearest block. */
const LEGACY: Record<string, BlockType> = { initials: "signature", text: "title", date: "datetime", checkbox: "name" };

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
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Keep a block wholly on its page; positions arrive from the browser. */
export function clampBlock<T extends { xPct: number; yPct: number; widthPct: number; heightPct: number }>(b: T): T {
  const widthPct = clamp(Number.isFinite(b.widthPct) ? b.widthPct : 20, 3, 100);
  const heightPct = clamp(Number.isFinite(b.heightPct) ? b.heightPct : 4, 1.5, 100);
  return {
    ...b,
    widthPct,
    heightPct,
    xPct: clamp(Number.isFinite(b.xPct) ? b.xPct : 0, 0, 100 - widthPct),
    yPct: clamp(Number.isFinite(b.yPct) ? b.yPct : 0, 0, 100 - heightPct),
  };
}

/** A new block centred on a click at (xPct, yPct) of a page. */
export function newBlockAt(type: BlockType, xPct: number, yPct: number): Pick<PlacedBlock, "xPct" | "yPct" | "widthPct" | "heightPct"> {
  const spec = BY_TYPE.get(type)!;
  return clampBlock({
    xPct: xPct - spec.widthPct / 2,
    yPct: yPct - spec.heightPct / 2,
    widthPct: spec.widthPct,
    heightPct: spec.heightPct,
  });
}

/** "Nov 2, 2026, 14:03:09 UTC": what a date-and-time block shows once stamped. */
export function formatBlockDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
