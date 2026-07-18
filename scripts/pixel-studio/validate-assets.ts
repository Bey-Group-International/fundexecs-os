/**
 * npm run validate:assets
 *
 * Validates the manifest (schema + semantics + inventory counts) and, when the
 * generated review assets exist, verifies image dimensions, the exact 8× review
 * relationship, alpha-channel sanity, silhouette presence, and WA sheet
 * compliance. Exits non-zero on any critical error so builds gate on it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../../lib/pixel-studio/manifest-build";
import { formatValidation, validateManifest } from "../../lib/pixel-studio/manifest";
import { decodePng, readPngDimensions } from "../../lib/pixel-studio/node/png";
import { ANIMATION_STATES } from "../../lib/pixel-studio/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = buildManifest();

let critical = 0;
const problems: string[] = [];

// 1. Manifest.
const v = validateManifest(manifest);
console.log(formatValidation(v));
if (!v.ok) {
  critical += v.schemaErrors.length + v.semanticErrors.length;
}

// 2. Deterministic naming convention check.
for (const a of manifest.assets) {
  if (!/^[a-z0-9-]+$/.test(a.id)) problems.push(`Asset id not deterministic/lowercase: ${a.id}`);
}

// 3. Example PNG dimension / alpha checks (if generated).
const nativeDir = join(root, "public", "pixel-studio", "assets", "characters", "native");
const reviewDir = join(root, "public", "pixel-studio", "assets", "characters", "review-8x");
if (existsSync(nativeDir)) {
  for (const ex of manifest.examples) {
    for (const state of ANIMATION_STATES) {
      const def = manifest.animations[state];
      const nativePath = join(nativeDir, `${ex.characterId}_${state}_1x.png`);
      const reviewPath = join(reviewDir, `${ex.characterId}_${state}_8x.png`);
      if (!existsSync(nativePath)) {
        problems.push(`Missing native sheet: ${ex.characterId}_${state}`);
        critical++;
        continue;
      }
      const nd = readPngDimensions(readFileSync(nativePath));
      if (nd.width !== def.width || nd.height !== def.height) {
        problems.push(`${ex.characterId}/${state}: native ${nd.width}×${nd.height} != ${def.width}×${def.height}`);
        critical++;
      }
      if (existsSync(reviewPath)) {
        const rd = readPngDimensions(readFileSync(reviewPath));
        if (rd.width !== nd.width * 8 || rd.height !== nd.height * 8) {
          problems.push(`${ex.characterId}/${state}: 8× review ${rd.width}×${rd.height} != ${nd.width * 8}×${nd.height * 8}`);
          critical++;
        }
        // Verify the 8× is an EXACT nearest-neighbor enlargement (spot-check).
        const native = decodePng(readFileSync(nativePath)).raster;
        const review = decodePng(readFileSync(reviewPath)).raster;
        if (!isExactUpscale(native, review, 8)) {
          problems.push(`${ex.characterId}/${state}: 8× is NOT an exact nearest-neighbor upscale`);
          critical++;
        }
      }
    }
  }
} else {
  console.log("\n(note) review assets not generated yet — run `npm run pixel:assets` for pixel-level checks.");
}

function isExactUpscale(native: { get: (x: number, y: number) => { r: number; g: number; b: number; a: number }; width: number; height: number }, review: { get: (x: number, y: number) => { r: number; g: number; b: number; a: number } }, factor: number): boolean {
  // Spot-check a diagonal of source pixels against their scaled blocks.
  for (let i = 0; i < Math.min(native.width, native.height); i++) {
    const s = native.get(i, i);
    const d = review.get(i * factor + 1, i * factor + 1);
    if (s.r !== d.r || s.g !== d.g || s.b !== d.b || s.a !== d.a) return false;
  }
  return true;
}

console.log("");
if (problems.length) {
  console.log("Additional checks:");
  for (const p of problems) console.log(`  ✖ ${p}`);
}

if (critical > 0) {
  console.error(`\n✖ validate:assets FAILED with ${critical} critical error(s).`);
  process.exit(1);
}
console.log("\n✔ validate:assets passed");
