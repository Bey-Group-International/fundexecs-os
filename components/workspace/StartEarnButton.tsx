"use client";

export function StartEarnButton({ prompt }: { prompt: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("earn:set-composer-prompt", {
            detail: { prompt },
          }),
        )
      }
      className="fx-btn-primary"
    >
      Start with Earn
    </button>
  );
}
