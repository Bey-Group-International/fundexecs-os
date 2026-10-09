// lib/meetings/green-room.ts
// What the green room says about a device problem, and how it summarises the
// devices that are working.
//
// The problems themselves come from `readinessProblems`; this decides which one
// is worth covering the preview for, and turns it into steps for the browser the
// person is actually using. "Allow it in the address bar" was the whole of the
// old advice, in 12px type under the name field — and the address bar puts the
// control in a different place in each browser, so the one instruction that
// mattered was the one nobody could follow.
//
// Pure: no DOM. The user agent is passed in.
import type { Device, ReadinessProblem } from "@/lib/meetings/devices";

export type BrowserFamily =
  | "chrome"
  | "edge"
  | "safari"
  | "firefox"
  /** Safari on an iPhone or iPad: no menu bar, the permission lives behind
   *  the "aA" button and in the Settings app. */
  | "ios-safari"
  /** Any other browser on an iPhone or iPad. They are all WebKit, and iOS
   *  keeps their camera and microphone switches in the Settings app. */
  | "ios-other"
  | "other";

/**
 * Which browser's instructions to give. Order matters: Edge says "Chrome" too.
 *
 * `maxTouchPoints` tells an iPad apart from a Mac: iPadOS asks for the desktop
 * site by default and reports a Macintosh user agent, and the Mac steps
 * ("In the menu bar…") describe a menu bar an iPad does not have.
 */
export function browserFamily(userAgent: string | null | undefined, maxTouchPoints = 0): BrowserFamily {
  const ua = userAgent ?? "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (ios) {
    // Only Safari itself carries the bare `Safari/` token without a sibling
    // browser's; CriOS, FxIOS, EdgiOS and the rest name themselves.
    if (/CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\/|OPT\//.test(ua) || !/Safari\//.test(ua)) return "ios-other";
    return "ios-safari";
  }
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/** The problems that cover the preview: the ones that stop a device working at all. */
const LEAD_ORDER: ReadinessProblem["kind"][] = ["mic_blocked", "camera_blocked", "mic_busy", "camera_busy"];

/**
 * The problem shown large, over the preview, or null when there is none.
 *
 * Only a device that cannot be used at all qualifies. A quiet microphone or a
 * missing camera is something to know, not something to stop and fix, and it
 * stays in the list beside the Join button. The microphone outranks the camera:
 * a meeting can be joined without being seen, and not without being heard.
 */
export function leadProblem(problems: readonly ReadinessProblem[]): ReadinessProblem | null {
  for (const kind of LEAD_ORDER) {
    const found = problems.find((p) => p.kind === kind);
    if (found) return found;
  }
  return null;
}

export interface ProblemGuide {
  title: string;
  steps: string[];
  /** What the button under the steps says. Every lead problem has one. */
  actionLabel: string;
}

/** Where the permission lives in each browser, for camera or microphone. */
function permissionSteps(device: "camera" | "microphone", browser: BrowserFamily): string[] {
  switch (browser) {
    case "chrome":
    case "edge":
      return [
        `Click the ${device} icon at the right end of the address bar (or the site settings icon at its left).`,
        `Choose "Always allow", then Done.`,
      ];
    case "safari":
      return [
        `In the menu bar, choose Safari → Settings for This Website.`,
        `Set ${device === "camera" ? "Camera" : "Microphone"} to Allow.`,
      ];
    case "ios-safari":
      return [
        `Tap the "aA" button at the left of the address bar, then Website Settings.`,
        `Set ${device === "camera" ? "Camera" : "Microphone"} to Allow.`,
        `If it is greyed out, open the Settings app → Safari → ${device === "camera" ? "Camera" : "Microphone"} and allow it there.`,
      ];
    case "ios-other":
      return [
        `Open the Settings app and scroll to this browser's name.`,
        `Switch ${device === "camera" ? "Camera" : "Microphone"} on, then come back and reload.`,
      ];
    case "firefox":
      return [
        `Click the crossed-out ${device} icon at the left of the address bar.`,
        `Remove the block, so Firefox asks again.`,
      ];
    default:
      return [`Open this site's settings from the address bar and allow the ${device}.`];
  }
}

/** The large version of a lead problem: a title, what to do, and the retry. */
export function problemGuide(problem: ReadinessProblem, browser: BrowserFamily): ProblemGuide {
  switch (problem.kind) {
    case "mic_blocked":
      return {
        title: "Your microphone is blocked",
        steps: [...permissionSteps("microphone", browser), "Then press Try again."],
        actionLabel: "Try again",
      };
    case "camera_blocked":
      return {
        title: "Your camera is blocked",
        steps: [...permissionSteps("camera", browser), "Then press Try again — or join with your camera off."],
        actionLabel: "Try again",
      };
    case "mic_busy":
      return {
        title: "Another app is using your microphone",
        steps: ["Quit the other call app (Zoom, Teams, FaceTime…) or pick a different microphone.", "Then press Try again."],
        actionLabel: "Try again",
      };
    case "camera_busy":
      return {
        title: "Another app is using your camera",
        steps: ["Quit the other call app (Zoom, Teams, FaceTime…) or pick a different camera.", "Then press Try again."],
        actionLabel: "Try again",
      };
    default:
      return { title: problem.message, steps: [], actionLabel: "Try again" };
  }
}

/**
 * A device's name, short enough for a one-line summary.
 *
 * Drops the USB vendor:product suffix ("(046d:0825)") and a leading "Default - "
 * that Chrome adds to whichever device the system is using.
 */
export function shortDeviceName(label: string | null | undefined): string {
  return (label ?? "")
    .replace(/^Default\s*-\s*/i, "")
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")
    .trim();
}

/**
 * The one line that stands for the device settings while they are folded away:
 * the camera and microphone in use, or what is missing.
 */
export function deviceSummary(
  devices: readonly Device[],
  chosen: { cameraId: string; micId: string; cameraEnabled: boolean },
): string {
  const name = (kind: Device["kind"], id: string) => {
    const of = devices.filter((d) => d.kind === kind);
    const found = of.find((d) => d.deviceId === id) ?? of[0];
    return shortDeviceName(found?.label) || null;
  };
  const cam = chosen.cameraEnabled ? name("videoinput", chosen.cameraId) ?? "No camera" : "Camera off";
  const mic = name("audioinput", chosen.micId) ?? "No microphone";
  return `${cam} · ${mic}`;
}

/** How long someone has been waiting to be let in: "0:42", then "3 min". */
export function waitedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 60)} min`;
}
