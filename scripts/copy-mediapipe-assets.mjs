// scripts/copy-mediapipe-assets.mjs
// Put MediaPipe's WebAssembly where the browser can fetch it.
//
// The segmenter that draws camera backgrounds needs its runtime served from our
// own origin. Loading it from a public CDN would be smaller here and worse in
// practice: the people in these calls sit behind fund and LP-side IT, and a
// blocked CDN would not surface as a missing dependency — it would surface as a
// background that silently refuses to turn on, mid-call.
//
// The .wasm is ~12MB, which is not something to carry in git. It is already
// pinned in package.json, so this copies it out of node_modules at build time
// and public/mediapipe/ is ignored except for the model file, which is small
// enough to commit and does not ship with the package.
//
// Only the SIMD build is copied. Every browser that can hold a WebRTC video
// call has had WebAssembly SIMD for years, and shipping the fallback would
// double the deployed size to serve browsers that cannot make the call anyway.

import { copyFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe");

const FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

async function main() {
  try {
    await access(from);
  } catch {
    // A dependency install that skipped optional packages, or a lint-only CI
    // job. Backgrounds are the only thing affected, and they degrade to off.
    console.warn("[mediapipe] @mediapipe/tasks-vision not installed — skipping asset copy.");
    return;
  }

  await mkdir(to, { recursive: true });
  for (const file of FILES) {
    await copyFile(join(from, file), join(to, file));
  }
  console.log(`[mediapipe] copied ${FILES.length} runtime files to public/mediapipe/`);
}

await main();
