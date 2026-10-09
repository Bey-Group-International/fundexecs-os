// Install-path detection for the installable (PWA) app.
//
// Chromium browsers announce installability with a `beforeinstallprompt` event
// and the app calls `prompt()` on it. Safari — on iPhone, iPad and Mac — has
// never fired that event, so for the whole Apple audience the install prompts
// used to render nothing at all, and the only way to get the app onto a Home
// Screen or into the Dock was to already know the gesture. This module reads
// the user agent once and names the manual path, so every install surface can
// show the right steps instead of staying silent.
//
// Pure functions over plain inputs so they can be unit-tested without a DOM.

export type InstallPlatform =
  /** iPhone / iPod touch in Safari — Share › Add to Home Screen. */
  | "ios-safari"
  /** iPad in Safari — same gesture, Share lives in the top toolbar. */
  | "ipados-safari"
  /** iPhone / iPad in Chrome, Firefox, Edge… — their Share menus can add to
   *  Home Screen too, Safari is the dependable fallback. */
  | "ios-other-browser"
  /** iPhone / iPad inside an in-app browser (Instagram, LinkedIn, Mail…) —
   *  there is no Add to Home Screen there; the page must open in Safari. */
  | "ios-in-app"
  /** Safari 17+ on macOS Sonoma or later — File › Add to Dock. */
  | "macos-safari"
  /** Safari 16 or older on macOS — no install path until macOS is updated. */
  | "macos-safari-legacy"
  /** Everything else: Chromium (native prompt), Firefox desktop (no install), … */
  | "other";

export interface DetectInput {
  userAgent: string;
  /** `navigator.maxTouchPoints` — the only signal that separates an iPad
   *  (which reports a Macintosh user agent by default) from a real Mac. */
  maxTouchPoints?: number;
}

const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave|YaBrowser|Vivaldi/i;
const NON_SAFARI_DESKTOP = /Chrome|Chromium|CriOS|Edg\/|EdgA|OPR\/|Opera|Firefox|FxiOS|Brave|Vivaldi|YaBrowser|Electron/i;

/** Classify the browser into the install path it supports. */
export function detectInstallPlatform(input: DetectInput): InstallPlatform {
  const ua = input.userAgent || "";
  const touch = input.maxTouchPoints ?? 0;

  const isIPhone = /iPhone|iPod/.test(ua);
  // iPadOS 13+ asks for the desktop site by default and reports itself as a
  // Mac; the touch-point count is what gives it away.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1);

  if (isIPhone || isIPad) {
    if (IOS_OTHER_BROWSER.test(ua)) return "ios-other-browser";
    // Every browser on iOS is WebKit, but only Safari itself carries the
    // `Safari/` token: a WKWebView inside Instagram, LinkedIn or Mail does not.
    if (!/Safari\//.test(ua)) return "ios-in-app";
    return isIPhone ? "ios-safari" : "ipados-safari";
  }

  const isMac = /Macintosh|Mac OS X/.test(ua);
  if (isMac && /Safari\//.test(ua) && !NON_SAFARI_DESKTOP.test(ua)) {
    // Safari's own version rides on the `Version/` token; "Add to Dock"
    // arrived with Safari 17 (macOS Sonoma).
    const m = /Version\/(\d+)/.exec(ua);
    const major = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(major) && major < 17 ? "macos-safari-legacy" : "macos-safari";
  }

  return "other";
}

/** True when the page is already running as an installed app. */
export function isStandaloneDisplay(win: {
  matchMedia?: (q: string) => { matches: boolean };
  // Typed loosely so the real `window` passes: `standalone` is iOS Safari's
  // non-standard navigator property and absent from the DOM lib's Navigator.
  navigator?: object;
}): boolean {
  try {
    if (win.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    /* matchMedia missing or throwing — fall through */
  }
  // iOS Safari's pre-standard signal, still the one that works on an iPhone.
  return (win.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

export type InstallGlyph = "share" | "add" | "dock" | "safari" | "menu" | "check" | "update";

export interface InstallStep {
  title: string;
  detail?: string;
  glyph: InstallGlyph;
}

export interface InstallGuide {
  /** Which platform the guide is for — lets callers vary chrome. */
  platform: InstallPlatform;
  /** Short heading, e.g. "Add to your Home Screen". */
  title: string;
  /** One line of context under the heading. */
  summary: string;
  /** Label for the button that reveals the steps. */
  cta: string;
  steps: InstallStep[];
}

const APP = "FundExecs OS";

/**
 * The manual install steps for a platform, or null where there is nothing to
 * guide (Chromium gets the native prompt; Firefox desktop cannot install).
 */
export function installGuide(platform: InstallPlatform): InstallGuide | null {
  switch (platform) {
    case "ios-safari":
      return {
        platform,
        title: "Add to your Home Screen",
        summary: "Full-screen, always current — no App Store needed.",
        cta: "Show me how",
        steps: [
          {
            glyph: "share",
            title: "Tap the Share button",
            detail: "The square with an arrow, in Safari's bar at the bottom of the screen.",
          },
          {
            glyph: "add",
            title: "Tap “Add to Home Screen”",
            detail: "Scroll the share sheet a little if you don't see it at first.",
          },
          {
            glyph: "check",
            title: "Tap “Add”",
            detail: `${APP} now opens from your Home Screen like any other app.`,
          },
        ],
      };
    case "ipados-safari":
      return {
        platform,
        title: "Add to your Home Screen",
        summary: "Runs full-screen on your iPad — no App Store needed.",
        cta: "Show me how",
        steps: [
          {
            glyph: "share",
            title: "Tap the Share button",
            detail: "The square with an arrow, at the top-right of Safari's toolbar.",
          },
          {
            glyph: "add",
            title: "Tap “Add to Home Screen”",
            detail: "Scroll the share sheet a little if you don't see it at first.",
          },
          {
            glyph: "check",
            title: "Tap “Add”",
            detail: `${APP} now opens from your Home Screen like any other app.`,
          },
        ],
      };
    case "ios-other-browser":
      return {
        platform,
        title: "Add to your Home Screen",
        summary: "Works from your browser's Share menu, or from Safari.",
        cta: "Show me how",
        steps: [
          {
            glyph: "share",
            title: "Open your browser's Share menu",
            detail: "Or copy this page's address and open it in Safari — Safari always has the option.",
          },
          {
            glyph: "add",
            title: "Choose “Add to Home Screen”",
          },
          {
            glyph: "check",
            title: "Confirm with “Add”",
            detail: `${APP} now opens from your Home Screen like any other app.`,
          },
        ],
      };
    case "ios-in-app":
      return {
        platform,
        title: "Open in Safari to install",
        summary: "In-app browsers can't add to the Home Screen — Safari can.",
        cta: "Show me how",
        steps: [
          {
            glyph: "safari",
            title: "Open this page in Safari",
            detail: "Use the “…” or Share menu of the app you're in and pick “Open in Safari”, or copy the link into Safari.",
          },
          {
            glyph: "share",
            title: "In Safari, tap the Share button",
            detail: "The square with an arrow at the bottom of the screen.",
          },
          {
            glyph: "add",
            title: "Tap “Add to Home Screen”, then “Add”",
          },
        ],
      };
    case "macos-safari":
      return {
        platform,
        title: "Add to your Dock",
        summary: "Runs in its own window with notifications — nothing to download.",
        cta: "Show me how",
        steps: [
          {
            glyph: "menu",
            title: "In Safari's menu bar choose File › Add to Dock…",
            detail: "Or click the Share button in the toolbar and pick “Add to Dock”.",
          },
          {
            glyph: "check",
            title: "Keep the name and click “Add”",
          },
          {
            glyph: "dock",
            title: `Open ${APP} from your Dock or Launchpad`,
            detail: "It launches in its own window, separate from your browser tabs.",
          },
        ],
      };
    case "macos-safari-legacy":
      return {
        platform,
        title: "Update Safari to install",
        summary: "Adding to the Dock needs Safari 17 (macOS Sonoma or later).",
        cta: "What do I need?",
        steps: [
          {
            glyph: "update",
            title: "Update macOS",
            detail: "System Settings › General › Software Update. Safari 17 ships with macOS Sonoma.",
          },
          {
            glyph: "menu",
            title: "Then choose File › Add to Dock… in Safari",
          },
        ],
      };
    case "other":
      return null;
  }
}

/**
 * The Chromium path (Chrome, Edge, Brave, Android). Chromium fires
 * `beforeinstallprompt`, so surfaces usually offer a one-click install; this
 * guide is for the /install page, where someone may be reading on one device
 * about another, or where the event has not fired yet.
 */
export const CHROMIUM_GUIDE: InstallGuide = {
  platform: "other",
  title: "Install from Chrome or Edge",
  summary: "One click from the address bar — on desktop and Android.",
  cta: "Show me how",
  steps: [
    {
      glyph: "add",
      title: "Click the install icon in the address bar",
      detail: "On Android, open the browser menu (⋮) and choose “Add to Home screen” or “Install app”.",
    },
    {
      glyph: "check",
      title: "Confirm “Install”",
      detail: `${APP} opens in its own window and appears with your other apps.`,
    },
  ],
};
