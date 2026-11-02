// lib/envelope-fields.ts
//
// Validating the blocks an owner places, and checking an envelope is ready to send.
// Pure: the routes feed it rows and act on what it says.
import { BLOCKS, clampBlock, type BlockType } from "@/lib/signing/blocks";

const TYPES = new Set<string>(BLOCKS.map((b) => b.type));
export const MAX_BLOCKS = 200;

export interface IncomingBlock {
  recipientId: string;
  type: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required?: boolean;
  prefill?: string | null;
  locked?: boolean;
}

export interface CleanBlock {
  recipient_id: string;
  field_type: BlockType;
  page: number;
  x_pct: number;
  y_pct: number;
  width_pct: number;
  height_pct: number;
  label: string;
  required: boolean;
  prefill: string | null;
  locked: boolean;
}

export type CleanResult = { ok: true; blocks: CleanBlock[] } | { ok: false; error: string };

/** Whatever the browser sent, made safe to store: known types, real recipients, on a real page. */
export function cleanBlocks(raw: unknown, recipientIds: string[], pageCount: number): CleanResult {
  if (!Array.isArray(raw)) return { ok: false, error: "blocks must be a list" };
  if (raw.length > MAX_BLOCKS) return { ok: false, error: `At most ${MAX_BLOCKS} blocks per document` };
  const known = new Set(recipientIds);
  const out: CleanBlock[] = [];
  for (const b of raw as IncomingBlock[]) {
    if (!b || typeof b !== "object") return { ok: false, error: "Invalid block" };
    if (!TYPES.has(b.type)) return { ok: false, error: `Unknown block type: ${String(b.type)}` };
    if (!known.has(b.recipientId)) return { ok: false, error: "A block is assigned to someone not on this document" };
    if (!Number.isInteger(b.page) || b.page < 1 || b.page > pageCount) return { ok: false, error: "A block is on a page that does not exist" };
    const c = clampBlock({ xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct, heightPct: b.heightPct });
    const prefill = typeof b.prefill === "string" && b.prefill.trim() ? b.prefill.trim().slice(0, 2000) : null;
    out.push({
      recipient_id: b.recipientId,
      field_type: b.type as BlockType,
      page: b.page,
      x_pct: c.xPct,
      y_pct: c.yPct,
      width_pct: c.widthPct,
      height_pct: c.heightPct,
      label: BLOCKS.find((x) => x.type === b.type)!.label,
      required: b.required !== false,
      prefill,
      // A locked block needs a value to lock.
      locked: Boolean(b.locked) && prefill !== null,
    });
  }
  return { ok: true, blocks: out };
}

/**
 * Who cannot sign yet: every signer and the owner each need a signature block, or
 * the document could be "signed" without anyone's signature on it.
 */
export function recipientsWithoutSignature(
  recipients: { id: string; name: string }[],
  blocks: { recipient_id: string; field_type: string }[],
): string[] {
  const signing = new Set(blocks.filter((b) => b.field_type === "signature" || b.field_type === "initials").map((b) => b.recipient_id));
  return recipients.filter((r) => !signing.has(r.id)).map((r) => r.name);
}
