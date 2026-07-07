// Copies the MediaPipe Selfie Segmentation runtime assets out of node_modules
// into public/ so they are served from our own origin (no third-party CDN — a
// privacy requirement for a private-markets app, and it keeps the assets under
// our CSP). The copied files are gitignored and regenerated on install/build,
// so the ~12MB of model/wasm binaries never bloat the repo.
//
// Runs from `prebuild` and `predev`. Idempotent and best-effort: if the package
// isn't present the office simply reports background blur as unavailable.

import { mkdir, copyFile, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules", "@mediapipe", "selfie_segmentation");
const destDir = join(root, "public", "mediapipe", "selfie_segmentation");

// Only the runtime files the browser fetches — skip README / types / package.json.
const WANTED = /\.(js|wasm|data|tflite|binarypb)$/;

async function main() {
  try {
    await access(srcDir);
  } catch {
    console.warn("[copy-mediapipe] @mediapipe/selfie_segmentation not installed — skipping (background blur will be unavailable).");
    return;
  }
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir);
  let copied = 0;
  for (const name of entries) {
    if (!WANTED.test(name)) continue;
    await copyFile(join(srcDir, name), join(destDir, name));
    copied += 1;
  }
  console.log(`[copy-mediapipe] copied ${copied} asset(s) to public/mediapipe/selfie_segmentation/`);
}

main().catch((e) => {
  // Never fail the build over an optional visual effect.
  console.warn("[copy-mediapipe] skipped:", e?.message ?? e);
});
