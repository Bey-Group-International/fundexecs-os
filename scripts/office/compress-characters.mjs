// scripts/office/compress-characters.mjs
// Re-encode the ready-made character atlases as palette (indexed) PNGs. These
// are 16-bit pixel-art sprites with a limited palette, so quantization is
// visually lossless while cutting file size dramatically. Rewrites in place.
import sharp from "sharp";
import fs from "fs";
import path from "path";

const ROOT = path.resolve("public/assets/fundexecs/user-characters");
const DRY = process.env.DRY === "1";
let before = 0, after = 0;

for (const slug of fs.readdirSync(ROOT).sort()) {
  const dir = path.join(ROOT, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of ["walk.png", "portrait.png"]) {
    const p = path.join(dir, file);
    // Read directly (no existsSync check-then-use, which trips a TOCTOU race
    // warning); skip the file if it isn't there.
    let src;
    try {
      src = fs.readFileSync(p);
    } catch {
      continue;
    }
    const out = await sharp(src)
      .png({ palette: true, colours: 256, dither: 0, effort: 10, compressionLevel: 9 })
      .toBuffer();
    before += src.length;
    // Only keep the re-encode if it actually helps.
    const use = out.length < src.length ? out : src;
    after += use.length;
    if (!DRY && use === out) fs.writeFileSync(p, out);
    console.log(
      `${slug}/${file}: ${(src.length / 1024).toFixed(0)}KB -> ${(use.length / 1024).toFixed(0)}KB` +
        (use === out ? "" : " (kept original)"),
    );
  }
}
console.log(`\nTOTAL: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB (${DRY ? "dry-run" : "written"})`);
