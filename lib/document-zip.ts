// lib/document-zip.ts
//
// Turning one uploaded .zip into a filing proposal for the library.
//
// An operator's diligence pack almost never arrives as loose files. It arrives
// as an archive whose folder names already are a filing — `03 Fund Terms/`,
// `Financials/`, `Legal & Structure/` — because whoever assembled it was doing
// the same job this module does. Throwing that structure away and dumping
// eighty files into one section would make the import worse than useless.
//
// So the folders are read as the filing they are, mapped onto the data-room
// sections, and proposed back to the operator to confirm or override. Nothing
// is imported until they say so: a zip is somebody else's organisation, and
// guessing silently is how a PPM ends up filed under Marketing.
//
// Pure and dependency-free — no bytes are inflated here. This works entirely
// from the ZIP central directory, which is what lets a 200 MB archive be
// reviewed before any of it is decompressed.
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import {
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  documentNameFromFile,
  fileExtension,
} from "@/lib/document-files";

/** Ceiling on the archive itself. It is read in memory and never stored. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/** Refuse absurd archives outright rather than rendering a 5,000-row review. */
export const MAX_ZIP_ENTRIES = 300;

export const ZIP_EXTENSION = ".zip";

/**
 * Whether a dropped file should go down the import path rather than be stored.
 *
 * The extension decides, and a recognised document extension wins outright.
 * .xlsx, .docx and .pptx are all ZIP archives underneath, and browsers do report
 * them as `application/zip` — trusting the MIME type would send a spreadsheet
 * into the importer to be torn into its XML parts instead of being filed.
 */
export function isZipFile(file: { name: string; type?: string }): boolean {
  if (fileExtension(file.name) === ZIP_EXTENSION) return true;
  if (checkUploadCandidate({ name: file.name, size: 1 }).ok) return false;
  return file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

// ─── Folder → section ─────────────────────────────────────────────────────────

/**
 * Normalise a folder name for matching: case, separators, ampersands, and the
 * ordering prefixes every assembled pack carries (`01 - `, `3. `, `04_`).
 */
export function normalizeFolder(raw: string): string {
  return raw
    .replace(/^[\s\-_.]*\d+[\s\-_.)]+/, "") // leading "01 - ", "3. ", "04_"
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Folder names people actually use, beyond each section's own key and label.
// Matching is exact against this table rather than fuzzy: a wrong-but-confident
// guess costs more than an unmatched folder, which simply falls back.
const SECTION_ALIASES: Record<string, string[]> = {
  overview: ["about", "firm", "firm overview", "introduction", "summary"],
  marketing: ["materials", "deck", "decks", "presentation", "presentations", "pitch", "pitchbook", "teaser", "one pager"],
  thesis: ["strategy", "investment strategy", "investment thesis", "mandate"],
  track_record: ["performance", "returns", "track record performance", "attribution"],
  portfolio: ["holdings", "investments", "case studies", "portfolio companies", "assets"],
  team: ["people", "bios", "governance", "org chart", "management"],
  fund_terms: ["terms", "ppm", "lpa", "fees", "fee schedule", "side letters", "offering documents", "offering"],
  legal: ["structure", "entities", "formation", "agreements", "corporate"],
  financials: ["audits", "audited financials", "accounts", "nav", "financial statements", "statements"],
  compliance: ["regulatory", "adv", "form adv", "aml", "kyc", "policies", "compliance manual"],
  operations: ["ops", "odd", "service providers", "operational due diligence", "administration", "fund admin"],
  esg: ["responsible investing", "sustainability", "impact"],
  risk: ["risk management", "valuation", "valuation policy", "controls"],
  diligence: ["ddq", "due diligence", "questionnaire", "ilpa", "ilpa ddq"],
  references: ["referrals", "referees"],
  other: ["misc", "miscellaneous", "appendix", "supporting"],
};

/** Normalised folder name → section key. Built once from keys, labels, aliases. */
const FOLDER_TO_SECTION: Map<string, string> = (() => {
  const map = new Map<string, string>();
  const add = (name: string, key: string) => {
    const n = normalizeFolder(name);
    // First writer wins: a section's own key and label outrank another's alias.
    if (n && !map.has(n)) map.set(n, key);
  };
  for (const s of DATA_ROOM_SECTIONS) {
    add(s.key, s.key);
    add(s.label, s.key);
  }
  for (const s of DATA_ROOM_SECTIONS) {
    for (const alias of SECTION_ALIASES[s.key] ?? []) add(alias, s.key);
  }
  return map;
})();

/**
 * Section a path's folders imply, or null when none of them match.
 *
 * Searched deepest-first: in `Diligence/DDQ/ILPA 2026.pdf` the nearer folder is
 * the more specific claim about what the file is.
 */
export function sectionFromPath(path: string): string | null {
  const folders = path.split("/").slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) {
    const hit = FOLDER_TO_SECTION.get(normalizeFolder(folders[i]));
    if (hit) return hit;
  }
  return null;
}

// ─── Planning ─────────────────────────────────────────────────────────────────

export interface ZipPlanItem {
  /** Full path inside the archive — the stable identity of the row. */
  path: string;
  /** Proposed document name. */
  name: string;
  /** Proposed section key. */
  section: string;
  /** True when a folder in the path named the section, rather than the fallback. */
  matchedFolder: boolean;
  /** Declared inflated size, from the central directory. */
  sizeBytes: number;
}

export interface ZipSkipped {
  path: string;
  reason: string;
}

export interface ZipPlan {
  items: ZipPlanItem[];
  skipped: ZipSkipped[];
  /** True when the archive held more entries than MAX_ZIP_ENTRIES. */
  truncated: boolean;
}

// Archive bookkeeping no operator wants filed as a document.
function isNoise(path: string): boolean {
  const segments = path.split("/");
  const base = segments[segments.length - 1];
  if (!base) return true;
  // macOS resource forks, Finder/Explorer metadata, and any dotfile.
  if (segments.some((s) => s === "__MACOSX")) return true;
  if (base.startsWith(".")) return true;
  if (base === "Thumbs.db" || base === "desktop.ini") return true;
  return false;
}

/**
 * Propose what an archive should become in the library.
 *
 * Every entry lands in exactly one of two lists. `items` is what will be
 * imported; `skipped` is everything else WITH a reason, because an import that
 * silently drops eleven of sixty files is indistinguishable from one that
 * worked.
 */
export function planZipImport(
  entries: Array<{ name: string; uncompressedSize: number; isDirectory: boolean }>,
  opts: { defaultSection: string },
): ZipPlan {
  const items: ZipPlanItem[] = [];
  const skipped: ZipSkipped[] = [];
  let seen = 0;
  let truncated = false;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (isNoise(entry.name)) continue;

    seen += 1;
    if (seen > MAX_ZIP_ENTRIES) {
      truncated = true;
      break;
    }

    const base = entry.name.split("/").pop() ?? entry.name;
    const check = checkUploadCandidate({ name: base, size: entry.uncompressedSize || 1 });
    if (!check.ok) {
      skipped.push({ path: entry.name, reason: check.reason });
      continue;
    }
    if (entry.uncompressedSize > MAX_UPLOAD_BYTES) {
      skipped.push({ path: entry.name, reason: "Larger than the 100 MB file limit." });
      continue;
    }

    const matched = sectionFromPath(entry.name);
    items.push({
      path: entry.name,
      name: documentNameFromFile(base),
      section: matched ?? opts.defaultSection,
      matchedFolder: matched !== null,
      sizeBytes: entry.uncompressedSize,
    });
  }

  // Group by section, and alphabetically within it, so the review reads as the
  // filing it is proposing rather than as the archive's arbitrary entry order.
  const order = new Map(DATA_ROOM_SECTIONS.map((s, i) => [s.key, i]));
  items.sort(
    (a, b) =>
      (order.get(a.section) ?? 99) - (order.get(b.section) ?? 99) ||
      a.name.localeCompare(b.name),
  );

  return { items, skipped, truncated };
}

/** One-line summary of a plan, for the dialog's header. */
export function describePlan(plan: ZipPlan): string {
  const n = plan.items.length;
  const sections = new Set(plan.items.map((i) => i.section)).size;
  if (n === 0) return "Nothing in this archive can be filed.";
  return `${n} document${n === 1 ? "" : "s"} across ${sections} section${sections === 1 ? "" : "s"}`;
}
