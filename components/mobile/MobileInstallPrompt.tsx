"use client";

import { useEffect, useState } from "react";
import { EarnIcon, CloseIcon } from "./icons";

const DISMISS_KEY = "fx:install-prompt-dismissed-at";
const RESURFACE_MS = 21 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// A native "Add to Home Screen" nudge. Uses the browser's beforeinstallprompt
// event where available (Android/Chromium) so the installed app opens straight
// into the standalone command center. Mobile-only, and never shown once the
// app is already running standalone. Fully isolated from desktop/web.
export function MobileInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Already installed / running as an app — nothing to prompt.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw && Date.now() - parseInt(raw, 10) < RESURFACE_MS) return;
    } catch {
      /* private mode — continue */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* non-fatal */
    }
  }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice.catch(() => undefined);
    dismiss();
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-40 md:hidden print:hidden">
      <div className="fx-sheet-enter relative overflow-hidden rounded-2xl border border-gold-500/30 bg-surface-1/95 p-3.5 shadow-2xl backdrop-blur-xl">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent" />
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 text-gold-300">
            <EarnIcon width={22} height={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-fg-primary">Install FundExecs OS</p>
            <p className="text-[11.5px] text-fg-secondary">Add to your home screen — full-screen, always current.</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="fx-tap -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition active:bg-surface-2"
          >
            <CloseIcon width={15} height={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={install}
          className="fx-tap mt-3 w-full rounded-xl bg-gradient-to-br from-gold-300 to-gold-500 px-4 py-2.5 text-[13px] font-semibold text-surface-0 transition active:scale-[0.99]"
        >
          Add to Home Screen
        </button>
      </div>
    </div>
  );
}
