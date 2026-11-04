// A signature the account holder chose to keep on this device, so countersigning is one click.
// It lives only in this browser's local storage, under the user's id, and every use of it is
// still validated by the server, which accepts nothing but a small real PNG.
const PREFIX = "data:image/png;base64,";
const MAX_DATA_URL = 195_000;
const keyFor = (userId: string) => `fundexecs:signature:${userId}`;

const valid = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(PREFIX) && v.length > PREFIX.length && v.length <= MAX_DATA_URL;

export function loadRememberedSignature(userId: string): string | null {
  try {
    const v = window.localStorage.getItem(keyFor(userId));
    return valid(v) ? v : null;
  } catch {
    return null; // storage blocked or unavailable: act as if nothing is remembered
  }
}

export function rememberSignature(userId: string, png: string): boolean {
  if (!valid(png)) return false;
  try {
    window.localStorage.setItem(keyFor(userId), png);
    return true;
  } catch {
    return false;
  }
}

export function forgetSignature(userId: string): void {
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    /* nothing to forget */
  }
}
