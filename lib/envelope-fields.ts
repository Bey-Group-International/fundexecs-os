// lib/envelope-fields.ts
//
// Validating the blocks an owner places, and checking an envelope is ready to send.
// Pure: the routes feed it rows and act on what it says.
import { BLOCKS, blockLabel, clampBlock, type BlockType } from "@/lib/signing/blocks";

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
  /** The name of an Other block. */
  label?: string | null;
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
      label: blockLabel(b.type, b.label),
      required: b.required !== false,
      prefill,
      // A locked block needs a value to lock.
      locked: Boolean(b.locked) && prefill !== null,
    });
  }
  return { ok: true, blocks: out };
}

/**
 * Who cannot sign yet: every signer and the owner each need a signature block they must
 * complete (a required one), or the document could be "signed" without anyone's signature on it.
 * A block with no `required` flag is treated as required, as older documents are.
 */
export function recipientsWithoutSignature(
  recipients: { id: string; name: string }[],
  blocks: { recipient_id: string; field_type: string; required?: boolean | null }[],
): string[] {
  const signing = new Set(
    blocks
      .filter((b) => b.field_type === "signature" && b.required !== false)
      .map((b) => b.recipient_id),
  );
  return recipients.filter((r) => !signing.has(r.id)).map((r) => r.name);
}

/**
 * The rule for a data-room file's blocks, placed once for every reader: the reader and the
 * countersigner (you) each need a required signature block, or a file could be "signed"
 * with no signature on it. Null when the blocks are fine (or there are none).
 */
export function templateSignatureProblem(blocks: { recipient_id: string; field_type: string; required?: boolean | null }[]): string | null {
  if (blocks.length === 0) return null;
  const missing = recipientsWithoutSignature(
    [
      { id: "signer", name: "the reader" },
      { id: "owner", name: "you" },
    ],
    blocks,
  );
  return missing.length ? "Add a required signature block for the reader and one for yourself (you countersign)." : null;
}
