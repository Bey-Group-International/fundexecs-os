"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallSteps } from "@/components/pwa/InstallSteps";
import {
  detectInstallPlatform,
  installGuide,
  isStandaloneDisplay,
  type InstallGuide,
} from "@/lib/pwa/install-platform";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "fx:install-card-dismissed-at";
const RESURFACE_MS = 30 * 24 * 60 * 60 * 1000;

// The dashboard's inline install card. Desktop-only on purpose: `/dashboard`
// sits inside the (app) layout, which already mounts MobileInstallPrompt as a
// fixed bottom sheet, and both listen for the same `beforeinstallprompt`. Left
// unscoped, a mobile visitor to the dashboard gets two competing install UIs
// for one install. The copy below ("focused desktop access") was always the
// desktop half of that pair.
//
// Chromium fires `beforeinstallprompt` and the card calls `prompt()`. Safari
// on a Mac or iPad never fires it, so the card used to stay invisible for
// every Safari user. It now detects Safari and reveals the manual path instead
// (File › Add to Dock on macOS Sonoma+, Share › Add to Home Screen on iPad).
export function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [guide, setGuide] = useState<InstallGuide | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay(window)) return;
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw && Date.now() - parseInt(raw, 10) < RESURFACE_MS) {
        setDismissed(true);
        return;
      }
    } catch {
      /* private mode — show anyway */
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    const platform = detectInstallPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    // Only the paths that actually end in an installed app earn a card here;
    // an out-of-date Safari gets the explanation on /install, not a nag.
    if (platform === "macos-safari" || platform === "ipados-safari") {
      setGuide(installGuide(platform));
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function hide() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* non-fatal */
    }
  }

  if (dismissed || (!installEvent && !guide)) return null;

  const isMac = guide?.platform === "macos-safari";

  return (
    <div className="hidden rounded-2xl border border-line bg-surface-1/80 p-3 text-xs text-fg-secondary md:block">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gold-300" aria-hidden>
          ★
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
            Install FundExecs
          </p>
          <p className="mt-1 leading-5">
            {guide
              ? isMac
                ? "Add the workspace to your Dock from Safari — its own window, no download."
                : "Add the workspace to your Home Screen from Safari — full-screen, no App Store."
              : "Add the workspace to this device for focused desktop access."}
          </p>
        </div>
        {installEvent ? (
          <button
            type="button"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice;
              setInstallEvent(null);
              setDismissed(true);
            }}
            className="rounded-lg bg-gold-500 px-2.5 py-1.5 text-[11px] font-medium text-on-gold transition hover:bg-gold-400"
          >
            Install
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={stepsOpen}
            aria-controls="fx-install-card-steps"
            onClick={() => setStepsOpen((o) => !o)}
            className="rounded-lg bg-gold-500 px-2.5 py-1.5 text-[11px] font-medium text-on-gold transition hover:bg-gold-400"
          >
            {stepsOpen ? "Hide steps" : guide?.cta ?? "Show me how"}
          </button>
        )}
        <button
          type="button"
          onClick={hide}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
        >
          Hide
        </button>
      </div>
      {guide && stepsOpen && (
        <div id="fx-install-card-steps" className="mt-3 border-t border-line/60 pt-3">
          <InstallSteps steps={guide.steps} />
          <p className="mt-2.5 text-[11px] text-fg-muted">
            Need the full guide for another device?{" "}
            <Link href="/install" className="text-gold-300 underline-offset-2 hover:underline">
              Open the install page
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
