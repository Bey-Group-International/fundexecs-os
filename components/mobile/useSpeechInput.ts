"use client";

// Hands-free voice dictation for the mobile app — the on-the-go counterpart to
// typing at the "Message Earn" composer. An exec walking between meetings can
// tap the mic, speak an ask, and have it land in the composer without thumbs.
// This hook is a thin, SSR-safe wrapper around the Web Speech API's
// SpeechRecognition (still vendor-prefixed as `webkitSpeechRecognition` on
// Chromium/Safari).
//
// Graceful degradation is the whole point: the API is absent server-side and in
// headless renders, and it's missing on some browsers (notably Firefox and
// several in-app webviews). In every one of those cases `supported` resolves to
// false and `start()`/`stop()` become quiet no-ops — callers render nothing
// rather than a dead button. We never touch `window`/`navigator` at module
// scope so this file is safe to import from a Server Component boundary.

import { useCallback, useEffect, useRef, useState } from "react";

// --- Minimal typings for the Web Speech API (not in the standard DOM lib) ----
interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

interface SpeechInputOptions {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  lang?: string;
}

interface SpeechInputApi {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

function describeError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission denied";
    case "no-speech":
      return "Didn't catch that";
    default:
      return code;
  }
}

export function useSpeechInput(opts: SpeechInputOptions): SpeechInputApi {
  const { onFinal, onInterim, lang } = opts;

  // Resolve support lazily (client-only) so SSR/headless renders read false.
  const [supported] = useState<boolean>(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Keep the latest callbacks in refs so the recognition instance's handlers
  // never go stale without our having to recreate it.
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  const ensureRecognition = useCallback((): SpeechRecognitionInstance | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.lang = lang ?? "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (interimText) onInterimRef.current?.(interimText);
      const trimmed = finalText.trim();
      if (trimmed) onFinalRef.current(trimmed);
    };

    recognition.onerror = (event) => {
      setError(describeError(event.error));
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [lang]);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const recognition = ensureRecognition();
    if (!recognition) return;
    setError(null);
    try {
      recognition.start();
      setListening(true);
    } catch {
      // `.start()` throws if invoked while already running — treat as a no-op.
    }
  }, [supported, listening, ensureRecognition]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, start, stop, error };
}
