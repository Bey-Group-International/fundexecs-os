"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallSteps } from "./InstallSteps";
import {
  CHROMIUM_GUIDE,
  detectInstallPlatform,
  installGuide,
  isStandaloneDisplay,
  type InstallGuide as Guide,
  type InstallPlatform,
} from "@/lib/pwa/install-platform";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

type TabKey = "iphone" | "ipad" | "mac" | "chromium";

const TABS: { key: TabKey; label: string; guide: Guide }[] = [
  { key: "iphone", label: "iPhone", guide: installGuide("ios-safari")! },
  { key: "ipad", label: "iPad", guide: installGuide("ipados-safari")! },
  { key: "mac", label: "Mac · Safari", guide: installGuide("macos-safari")! },
  { key: "chromium", label: "Chrome · Edge · Android", guide: CHROMIUM_GUIDE },
];

function tabFor(platform: InstallPlatform): TabKey {
  switch (platform) {
    case "ios-safari":
    case "ios-other-browser":
    case "ios-in-app":
      return "iphone";
    case "ipados-safari":
      return "ipad";
    case "macos-safari":
    case "macos-safari-legacy":
      return "mac";
    default:
      return "chromium";
  }
}

// The /install page body. Detects the visitor's browser and opens on its
// steps, but keeps every platform one tap away: an operator often reads this
// on a laptop about their phone, or forwards it to a colleague. Where the
// detected browser needs a special note (in-app browsers, old Safari) the
// detected guide replaces the generic tab copy.
export function InstallGuide() {
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  const [tab, setTab] = useState<TabKey>("chromium");
  const [standalone, setStandalone] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    setStandalone(isStandaloneDisplay(window));
    const p = detectInstallPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    setPlatform(p);
    setTab(tabFor(p));
    setDetected(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // The detected guide wins on its own tab, so an in-app browser on iPhone
  // reads "open in Safari first" rather than the plain Safari steps.
  const detectedGuide = installGuide(platform);
  const active = TABS.find((t) => t.key === tab)!;
  const guide = detectedGuide && tabFor(platform) === tab ? detectedGuide : active.guide;
  const isDetectedTab = detected && tabFor(platform) === tab;

  if (standalone) {
    return (
      <div className="rounded-2xl border border-gold-500/30 bg-gold-500/[0.06] px-5 py-5">
        <p className="font-display text-lg font-semibold tracking-tight text-fg-primary">You&apos;re already in the app</p>
        <p className="mt-1.5 text-sm text-fg-secondary">
          This window is the installed FundExecs OS. Nothing more to set up — open it from your Home Screen or Dock
          whenever you need it.
        </p>
        <Link
          href="/home"
          className="mt-4 inline-flex items-center rounded-xl border border-gold-500/40 bg-gold-500/[0.08] px-4 py-2 text-sm font-semibold text-gold-300 transition hover:border-gold-500/60"
        >
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div role="tablist" aria-label="Choose your device" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="fx-install-guide-panel"
              onClick={() => setTab(t.key)}
              className={`fx-tap rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                selected
                  ? "border-gold-500 bg-gold-500 text-on-gold"
                  : "border-line bg-surface-1 text-fg-secondary hover:border-gold-500/40 hover:text-fg-primary"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <section
        id="fx-install-guide-panel"
        role="tabpanel"
        className="mt-4 rounded-2xl border border-line/80 bg-surface-1 px-5 py-5 shadow-[0_1px_2px_rgb(15_23_42/0.10)]"
      >
        {isDetectedTab && (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-gold-300">Detected: this device</p>
        )}
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">{guide.title}</h2>
        <p className="mt-1 text-sm text-fg-secondary">{guide.summary}</p>

        {tab === "chromium" && installEvent && (
          <button
            type="button"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice.catch(() => undefined);
              setInstallEvent(null);
            }}
            className="fx-btn-primary mt-4"
          >
            Install now
          </button>
        )}

        <InstallSteps steps={guide.steps} size="md" className="mt-5" />

        {tab === "mac" && platform !== "macos-safari-legacy" && (
          <p className="mt-5 text-[12.5px] leading-relaxed text-fg-muted">
            Add to Dock needs Safari 17, which ships with macOS Sonoma (14) or later. On an older Mac, install from
            Chrome or Edge instead.
          </p>
        )}
        {tab === "iphone" && (
          <p className="mt-5 text-[12.5px] leading-relaxed text-fg-muted">
            Installed from the Home Screen, FundExecs OS runs full-screen, keeps you signed in, and can send
            notifications once you allow them in Settings.
          </p>
        )}
      </section>
    </div>
  );
}
