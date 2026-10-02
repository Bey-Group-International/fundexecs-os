// lib/nda.ts
//
// The data-room NDA: the wording a link uses when it has none of its own, and
// how the signing time reads on the record. Pure, so the public gate (client)
// and the signing action (server) show and record the same text.
export const DEFAULT_NDA_TEXT =
  "By proceeding, you agree to keep all information in this data room strictly confidential. You shall not disclose, reproduce, or distribute any materials herein to any third party without prior written consent from the issuing organization. This obligation survives the termination of any relationship with the organization.";

/** The text a link's readers sign: its own wording, else the default. */
export function ndaTextFor(custom: string | null | undefined): string {
  const t = (custom ?? "").trim();
  return t || DEFAULT_NDA_TEXT;
}

/** "Oct 2, 2026, 21:30:05 UTC": the signing time as it appears on the record. */
export function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
