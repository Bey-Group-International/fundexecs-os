// The messages between the room and the transcription worker.

export type WorkerRequest =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array; language?: string };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  /** The model files are not on this site. Nothing was downloaded from anywhere else. */
  | { type: "model-missing" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; text: string }
  | { type: "decode-failed"; id: number; message: string };
