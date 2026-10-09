"use client";

import { useEffect, useState } from "react";
import { EarnIcon, CloseIcon } from "./icons";
import { MobileSheet } from "./MobileSheet";
import { InstallSteps } from "@/components/pwa/InstallSteps";
import {
  detectInstallPlatform,
  installGuide,
  isStandaloneDisplay,
  type InstallGuide,
} from "@/lib/pwa/install-platform";

const DISMISS_KEY = "fx:install-prompt-dismissed-at";
const RESURFACE_MS = 21 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// A native "Add to Home Screen" nudge. On Android/Chromium it captures the
// browser's beforeinstallprompt event and triggers the real install dialog.
// Safari on iPhone never fires that event, so there the card opens a short
// illustrated guide to the Share › Add to Home Screen gesture instead — the
// one install path iOS has, and previously the one nobody was told about.
// Mobile-only, and never shown once the app is already running standalone.
// Fully isolated from desktop/web.
export function MobileInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guide, setGuide] = useState<InstallGuide | null>(null);
  const [show, setShow] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    // Already installed / running as an app — nothing to prompt.
    if (isStandaloneDisplay(window)) return;

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

    // iOS: no event will ever come, so decide from the user agent. The Mac
    // paths are excluded here only for clarity — this card is md:hidden and a
    // Mac never renders it; the desktop surfaces carry their own guide.
    const platform = detectInstallPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    const manual = platform.startsWith("ios") || platform.startsWith("ipados") ? installGuide(platform) : null;
    if (manual) {
      setGuide(manual);
      setShow(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setShow(false);
    setGuideOpen(false);
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

  const title = guide ? guide.title : "Install FundExecs OS";
  const summary = guide ? guide.summary : "Add to your home screen — full-screen, always current.";
  const cta = evt ? "Add to Home Screen" : guide?.cta ?? "Show me how";

  return (
    <>
      <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-40 md:hidden print:hidden">
        <div className="fx-sheet-enter relative overflow-hidden rounded-2xl border border-gold-500/30 bg-surface-1/95 p-3.5 shadow-2xl backdrop-blur-xl">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/50 to-transparent" />
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10 text-gold-300">
              <EarnIcon width={22} height={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-fg-primary">{title}</p>
              <p className="text-[11.5px] text-fg-secondary">{summary}</p>
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
            onClick={evt ? install : () => setGuideOpen(true)}
            className="fx-tap mt-3 w-full rounded-xl bg-gradient-to-br from-gold-300 to-gold-500 px-4 py-2.5 text-[13px] font-semibold text-surface-0 transition active:scale-[0.99]"
          >
            {cta}
          </button>
        </div>
      </div>

      {guide && (
        <MobileSheet
          open={guideOpen}
          onClose={() => setGuideOpen(false)}
          title={guide.title}
          subtitle={guide.summary}
          labelledBy="fx-install-guide-title"
        >
          <div className="rounded-2xl border border-line/60 bg-surface-0/60 px-3.5 py-3.5">
            <InstallSteps steps={guide.steps} />
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="fx-tap mt-3 w-full rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-fg-secondary transition active:bg-surface-2"
          >
            Got it
          </button>
          <p className="mt-3 pb-1 text-center text-[11px] text-fg-muted">
            Already installed? Open FundExecs OS from your Home Screen to skip this.
          </p>
        </MobileSheet>
      )}
    </>
  );
}
