"use client";

// The mic affordance for the mobile "Message Earn" composer. It's the hands-free
// path: tap once to dictate an ask to Earn while on the move, tap again to stop.
// Presentation only — it drives `useSpeechInput` and forwards recognised text
// up to the composer, which owns the input value and any error layout.
//
// On browsers without the Web Speech API (and during SSR/headless renders) the
// hook reports `supported: false` and this component renders nothing, so the
// composer simply shows no mic rather than a button that can't work.

import { useSpeechInput } from "./useSpeechInput";
import { haptic } from "./haptics";

interface MicButtonProps {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

function MicGlyph() {
  // Inline glyph — the shared icon set has no microphone mark.
  return (
    <svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
    </svg>
  );
}

export function MicButton({
  onFinal,
  onInterim,
  className,
  disabled,
}: MicButtonProps): React.ReactElement | null {
  const { supported, listening, start, stop } = useSpeechInput({ onFinal, onInterim });

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      stop();
      haptic("tap");
    } else {
      start();
      haptic("select");
    }
  };

  const tone = listening
    ? "border-status-danger/50 bg-status-danger/[0.12] text-status-danger animate-pulse"
    : "border-line bg-surface-0/80 text-fg-muted";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate to Earn"}
      className={`fx-tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-40 ${tone}${className ? ` ${className}` : ""}`}
    >
      <MicGlyph />
    </button>
  );
}
