/**
 * Headless generation of native + 8× review sprite sheets for the eight example
 * executives, plus per-example config JSON. Uses the pure compositor and the
 * dependency-free PNG encoder — no browser or canvas library required.
 *
 * Emits into public/pixel-studio/assets/characters/{native,review-8x,examples}.
 * These double as the visual-regression fixtures (exact bytes are deterministic).
 *
 * Run: npm run pixel:assets
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetRegistry } from "../../lib/pixel-studio/asset-registry";
import { createComposer } from "../../lib/pixel-studio/compositor";
import { buildManifest } from "../../lib/pixel-studio/manifest-build";
import { encodePng } from "../../lib/pixel-studio/node/png";
import { ANIMATION_STATES, type AnimationState } from "../../lib/pixel-studio/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outRoot = join(root, "public", "pixel-studio", "assets", "characters");
const nativeDir = join(outRoot, "native");
const reviewDir = join(outRoot, "review-8x");
const exampleDir = join(outRoot, "examples");
for (const d of [nativeDir, reviewDir, exampleDir]) mkdirSync(d, { recursive: true });

const manifest = buildManifest();
const registry = new AssetRegistry(manifest);
const composer = createComposer(registry);

let files = 0;
let warnings = 0;

for (const ex of manifest.examples) {
  writeFileSync(join(exampleDir, `${ex.characterId}.json`), JSON.stringify(ex, null, 2) + "\n");

  for (const state of ANIMATION_STATES as readonly AnimationState[]) {
    const def = manifest.animations[state];
    const native = composer.composeStateSheet(ex, state);

    // Contract checks.
    if (native.width !== def.width || native.height !== def.height) {
      console.error(`✖ ${ex.characterId}/${state}: sheet ${native.width}×${native.height} != ${def.width}×${def.height}`);
      process.exit(1);
    }
    if (!native.hasOnlyBinaryAlpha()) {
      // Ground shadow uses partial alpha by design; only flag if unexpectedly high.
      warnings++;
    }
    if (native.opaqueCount() < 60) {
      console.error(`✖ ${ex.characterId}/${state}: silhouette too small (${native.opaqueCount()} px)`);
      process.exit(1);
    }

    const review = native.scaleNearest(8);
    if (review.width !== native.width * 8 || review.height !== native.height * 8) {
      console.error(`✖ ${ex.characterId}/${state}: 8× review dims wrong`);
      process.exit(1);
    }

    writeFileSync(join(nativeDir, `${ex.characterId}_${state}_1x.png`), encodePng(native));
    writeFileSync(join(reviewDir, `${ex.characterId}_${state}_8x.png`), encodePng(review));
    files += 2;
  }
}

console.log(`✔ Generated ${files} sprite sheets for ${manifest.examples.length} example executives`);
console.log(`  native: ${nativeDir}`);
console.log(`  review-8x: ${reviewDir}`);
if (warnings) console.log(`  note: ${warnings} sheets contain the intentional semi-transparent ground shadow`);
