#!/usr/bin/env node
// Installs the in-browser transcription model under public/models/ so that
// Firefox and desktop Safari can transcribe without any third-party call at
// runtime. Run once on a machine with internet access, then deploy the files
// (they are git-ignored; upload them to the host that serves /models/).
//
//   node scripts/fetch-whisper-model.mjs [--model onnx-community/whisper-base]
//
// Output layout (everything is served from this site's own origin):
//   public/models/whisper-base/config.json, tokenizer.json, ... onnx/*_quantized.onnx
//   public/models/ort/ort-wasm-simd-threaded*.{mjs,wasm}   (copied from node_modules)
//
// The weights are fetched from the Hugging Face hub ONCE, here, at install
// time. The browser never talks to it: the worker has remote models disabled.

import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const repo = arg("model", "onnx-community/whisper-base");
const out = join(root, "public", "models", "whisper-base");
const ortOut = join(root, "public", "models", "ort");

const wanted = (path) =>
  (!path.includes("/") && /\.(json|txt)$/.test(path)) || // config, tokenizer, preprocessor, generation config
  /^onnx\/.*_quantized\.onnx$/.test(path); // the q8 encoder and decoder the worker loads

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`  ${dest.replace(root + "/", "")}  ${((await stat(dest)).size / 1e6).toFixed(1)} MB`);
}

console.log(`Model files from ${repo}:`);
const tree = await (await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=1`)).json();
const files = tree.filter((f) => f.type === "file" && wanted(f.path));
if (!files.some((f) => f.path.startsWith("onnx/"))) throw new Error("no quantized .onnx files found; check --model");
for (const f of files) await download(`https://huggingface.co/${repo}/resolve/main/${f.path}`, join(out, f.path));

console.log("ONNX Runtime files (from node_modules):");
const ortSrc = join(root, "node_modules", "onnxruntime-web", "dist");
await mkdir(ortOut, { recursive: true });
for (const name of await readdir(ortSrc)) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(name)) {
    await copyFile(join(ortSrc, name), join(ortOut, name));
    console.log(`  public/models/ort/${name}`);
  }
}
console.log("Done. Serve public/models/ from this site's origin.");
