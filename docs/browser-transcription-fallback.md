# Transcription on Firefox and desktop Safari

Chrome and Edge transcribe each person's microphone with the browser's own
speech recogniser. Firefox has none, and desktop Safari's ignores the call's
microphone, so those two run a Whisper-class model (`whisper-base`, quantised,
about 75 MB) inside a Web Worker instead.

- **No third party at runtime.** The model, tokenizer and ONNX Runtime `.wasm`
  are served from this site under `/models/`. The worker turns remote models
  off, and audio never leaves the device.
- **Same pipeline.** `lib/meetings/fallback/recognition.ts` is shaped like
  `SpeechRecognition`, so speaker attribution, the mute guard, the glossary and
  the host's pause apply to it unchanged.
- **Behaviour differences.** Lines arrive whole after a pause (no interim
  words), with no engine confidence. Phantom phrases Whisper invents over
  silence ("Thank you.") are dropped (`cleanDecode`).
- **Who runs it.** Phones and tablets, devices under 4 cores or 4 GB, and
  browsers without Workers/WebAssembly/Web Audio are skipped with a notice; they
  still see everyone else's lines. Desktop Safari keeps its own engine if the
  model is not installed.

## Installing the model

```bash
node scripts/fetch-whisper-model.mjs
```

Needs internet once. It writes `public/models/` (git-ignored). Deploy those
files so `/models/whisper-base/config.json` returns 200; until it does, the
fallback is simply off and nothing else changes. Serve `/models/` with
`Cache-Control: public, max-age=31536000, immutable`.
