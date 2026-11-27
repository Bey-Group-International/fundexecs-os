// lib/meetings/invite-note.ts
// Kept apart from invite.ts on purpose: that module sends email and so pulls in
// server-only code, and the schedule screen (a client component) needs this
// limit too.

/** Longest personal message an invitation carries. */
export const INVITE_NOTE_MAX = 1000;
