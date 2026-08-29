"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

// The dashboard's inline install card. Desktop-only on purpose: `/dashboard`
// sits inside the (app) layout, which already mounts MobileInstallPrompt as a
// fixed bottom sheet, and both listen for the same `beforeinstallprompt`. Left
// unscoped, a mobile visitor to the dashboard gets two competing install UIs
// for one install. The copy below ("focused desktop access") was always the
// desktop half of that pair.
export function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as InstallEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (dismissed || !installEvent) return null;

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
            Add the workspace to this device for focused desktop access.
          </p>
        </div>
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
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
