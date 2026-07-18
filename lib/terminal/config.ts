// lib/terminal/config.ts
// Feature switch for the Private Markets Intelligence Terminal. Same discipline as
// the inference gateway and skill auto-invocation: an env-string flag, OFF unless
// explicitly "true", so the terminal ships dark until its shell + command surface
// are complete. Nothing in the terminal path runs for a user until this is on.
export const TERMINAL_ENABLED = process.env.TERMINAL_ENABLED === "true";
