/**
 * Generates public/pixel-studio/manifest.json from the pure builder and runs
 * full validation. Exit non-zero on any critical error so CI/build can gate.
 *
 * Run: npm run pixel:manifest
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest } from "../../lib/pixel-studio/manifest-build";
import { formatValidation, validateManifest } from "../../lib/pixel-studio/manifest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outPath = join(root, "public", "pixel-studio", "manifest.json");

const manifest = buildManifest();
const result = validateManifest(manifest);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Wrote ${outPath}`);
console.log(`  assets: ${manifest.assets.length}`);
console.log(`  palettes: ${Object.keys(manifest.palettes).length}`);
console.log(`  outfit systems: ${manifest.outfitSystems.length}`);
console.log("");
console.log(formatValidation(result));

if (!result.ok) {
  console.error("\n✖ Manifest validation FAILED");
  process.exit(1);
}
console.log("\n✔ Manifest validation passed");
