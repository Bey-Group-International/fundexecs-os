/// <reference lib="webworker" />
// The in-house recogniser's engine: a Whisper-class model run by ONNX
// Runtime's WebAssembly backend, entirely inside this worker. The model, its
// tokenizer and the runtime's .wasm are all served from this site under
// /models/ (see scripts/fetch-whisper-model.mjs). Remote models are switched
// off, so there is no path by which audio or a request reaches a third party.

import { env, pipeline } from "@huggingface/transformers";
import { FALLBACK_MODEL_BASE, FALLBACK_MODEL_ID, FALLBACK_MODEL_PROBE } from "./policy";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse) => scope.postMessage(m);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = FALLBACK_MODEL_BASE;
env.useBrowserCache = true;
 
(env.backends as any).onnx.wasm.wasmPaths = `${FALLBACK_MODEL_BASE}ort/`;

 
let asr: any = null;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  if (asr) return post({ type: "ready" });
  if (!loading) {
    loading = (async () => {
      const probe = await fetch(FALLBACK_MODEL_PROBE, { method: "HEAD" }).catch(() => null);
      if (!probe || !probe.ok) throw Object.assign(new Error("model-missing"), { missing: true });
      const files = new Map<string, { loaded: number; total: number }>();
      asr = await pipeline("automatic-speech-recognition", FALLBACK_MODEL_ID, {
        dtype: "q8",
        device: "wasm",
         
        progress_callback: (p: any) => {
          if (p?.status !== "progress" || !p.file) return;
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          let loaded = 0, total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          post({ type: "progress", loaded, total });
        },
      });
    })();
  }
  try {
    await loading;
    post({ type: "ready" });
  } catch (e) {
    loading = null;
    if ((e as { missing?: boolean }).missing) post({ type: "model-missing" });
    else post({ type: "failed", message: String((e as Error)?.message ?? e) });
  }
}

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  if (m.type === "load") return void load();
  if (m.type === "transcribe") {
    try {
      if (!asr) throw new Error("model not loaded");
      const out = await asr(m.audio, { task: "transcribe", ...(m.language ? { language: m.language } : {}) });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      post({ type: "result", id: m.id, text: String(text ?? "") });
    } catch (e) {
      post({ type: "decode-failed", id: m.id, message: String((e as Error)?.message ?? e) });
    }
  }
};
