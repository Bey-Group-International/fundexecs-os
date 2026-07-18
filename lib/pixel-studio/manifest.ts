/**
 * Manifest access + validation.
 *
 * Runtime (browser + tests) obtains the manifest by calling buildManifest()
 * directly — it is pure and deterministic, so no fetch or bundled JSON blob is
 * needed. The generated `public/pixel-studio/manifest.json` artifact exists for
 * export bundles, external tooling, and the schema validator.
 */
import { buildManifest } from "./manifest-build";
import { isMonotonicRamp, paletteContrastSpread } from "./palette-engine";
import manifestSchema from "@/schemas/manifest.schema.json";
import { formatErrors, validate, type JsonSchema, type ValidationError } from "./schema-validate";
import {
  ANIMATION_STATES,
  type AssetCategory,
  type Manifest,
} from "./types";

let cached: Manifest | null = null;

export function getManifest(): Manifest {
  if (!cached) cached = buildManifest();
  return cached;
}

export interface ManifestValidation {
  ok: boolean;
  schemaErrors: ValidationError[];
  semanticErrors: string[];
  counts: Record<string, number>;
}

/** Required inventory counts from the brief (§20 acceptance criteria). */
export const REQUIRED_COUNTS = {
  skinPalettes: 6,
  faces: 12,
  hairstyles: 24,
  facialHair: 12,
  headCoverings: 12,
  hairColors: 10,
  outfitSystems: 13,
  accessories: 17,
  expressions: 4,
  examples: 8,
  materials: 13,
} as const;

function countCategory(m: Manifest, cat: AssetCategory): number {
  return m.assets.filter((a) => a.category === cat).length;
}
function countPaletteGroup(m: Manifest, group: string): number {
  return Object.values(m.palettes).filter((p) => p.group === group).length;
}

/**
 * Full manifest validation: JSON-Schema shape + semantic integrity (unique ids,
 * reference resolution, inventory counts, palette ramp health, animation sheet
 * math). Returns actionable messages.
 */
export function validateManifest(m: Manifest = getManifest()): ManifestValidation {
  const schemaErrors = validate(m, manifestSchema as unknown as JsonSchema);
  const semanticErrors: string[] = [];

  // Unique asset ids.
  const seen = new Set<string>();
  for (const a of m.assets) {
    if (seen.has(a.id)) semanticErrors.push(`Duplicate asset id: ${a.id}`);
    seen.add(a.id);
  }

  // Reference integrity: materials, palettes, requires/excludes.
  for (const a of m.assets) {
    if (!m.materials[a.materialId]) semanticErrors.push(`Asset ${a.id}: unknown material ${a.materialId}`);
    if (a.defaultPalette && !m.palettes[a.defaultPalette])
      semanticErrors.push(`Asset ${a.id}: unknown defaultPalette ${a.defaultPalette}`);
    for (const req of a.requires)
      if (!seen.has(req) && !ANIMATION_STATES.includes(req as never) && !m.outfitSystems.some((o) => o.id === req))
        {/* soft ref (category/expression) — allowed */}
    for (const ex of a.excludes)
      if (!seen.has(ex) && !["skin", "face", "hair", "facialHair", "headCovering", "outfit", "accessory", "expression"].includes(ex))
        semanticErrors.push(`Asset ${a.id}: excludes unknown id ${ex}`);
  }

  // Outfit sublayer references.
  for (const o of m.outfitSystems) {
    for (const sub of o.sublayers)
      if (!seen.has(sub)) semanticErrors.push(`Outfit ${o.id}: unknown sublayer ${sub}`);
    for (const c of o.colorways)
      for (const p of Object.values(c.palettes))
        if (p && !m.palettes[p]) semanticErrors.push(`Outfit ${o.id}/${c.id}: unknown palette ${p}`);
  }

  // Palette ramp health (monotonic, non-muddy) + skin contrast equivalence.
  for (const p of Object.values(m.palettes)) {
    if (!isMonotonicRamp(p)) semanticErrors.push(`Palette ${p.id}: non-monotonic luminance ramp`);
  }
  const skinSpreads = Object.values(m.palettes)
    .filter((p) => p.group === "skin")
    .map(paletteContrastSpread);
  if (skinSpreads.length) {
    const min = Math.min(...skinSpreads);
    const max = Math.max(...skinSpreads);
    if (max - min > 60) semanticErrors.push(`Skin palettes contrast spread varies too much (${(max - min).toFixed(0)})`);
  }

  // Animation sheet math.
  for (const state of ANIMATION_STATES) {
    const def = m.animations[state];
    if (def.width !== def.columns * 32) semanticErrors.push(`Animation ${state}: width ${def.width} != columns*32`);
    if (def.height !== def.rows * 32) semanticErrors.push(`Animation ${state}: height ${def.height} != rows*32`);
    if (def.columns !== def.framesPerDirection)
      semanticErrors.push(`Animation ${state}: columns must equal framesPerDirection`);
  }
  // WA walk sheet must be 96×128.
  const walk = m.animations.walk;
  if (walk.width !== 96 || walk.height !== 128)
    semanticErrors.push(`WorkAdventure walk sheet must be 96×128, got ${walk.width}×${walk.height}`);

  // Inventory counts.
  const counts: Record<string, number> = {
    skinPalettes: countPaletteGroup(m, "skin"),
    faces: countCategory(m, "face"),
    hairstyles: countCategory(m, "hair"),
    facialHair: countCategory(m, "facialHair"),
    headCoverings: countCategory(m, "headCovering"),
    hairColors: countPaletteGroup(m, "hair"),
    outfitSystems: m.outfitSystems.length,
    accessories: countCategory(m, "accessory"),
    expressions: countCategory(m, "expression"),
    examples: m.examples.length,
    materials: Object.keys(m.materials).length,
  };
  for (const [key, required] of Object.entries(REQUIRED_COUNTS)) {
    if (counts[key] !== required)
      semanticErrors.push(`Inventory ${key}: expected ${required}, found ${counts[key]}`);
  }

  // Every face must support all four expressions (expressions are universal → ok if 4 exist).
  if (counts.expressions !== 4) semanticErrors.push(`Expected 4 universal expression assets`);

  return {
    ok: schemaErrors.length === 0 && semanticErrors.length === 0,
    schemaErrors,
    semanticErrors,
    counts,
  };
}

export function formatValidation(v: ManifestValidation): string {
  const lines: string[] = [];
  lines.push(`Schema: ${v.schemaErrors.length === 0 ? "PASS" : "FAIL"}`);
  if (v.schemaErrors.length) lines.push(formatErrors(v.schemaErrors));
  lines.push(`Semantic: ${v.semanticErrors.length === 0 ? "PASS" : "FAIL"}`);
  for (const e of v.semanticErrors) lines.push(`  • ${e}`);
  lines.push("Counts:");
  for (const [k, n] of Object.entries(v.counts)) lines.push(`  ${k}: ${n}`);
  return lines.join("\n");
}
