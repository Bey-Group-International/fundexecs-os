// lib/data-room-errors.ts
//
// "The database didn't answer" is a different thing from "you may not see this".
//
// The public data room used to fold both into one outcome: any failed read
// came back as an empty or null result, and the page said the link was invalid,
// expired or revoked. A reader with a good link was told to ask for a new one
// during an ordinary database hiccup, and nothing was logged, so nobody on the
// sending side ever learned it had happened.
//
// A read that fails now throws this. It still fails closed, since nothing is
// served, but callers can tell it apart from a denial and say so honestly.
import { logId } from "@/lib/log-safe";

export class DataRoomReadError extends Error {
  /** Which read failed. A constant chosen in code, safe to log. */
  readonly where: string;
  /** The database's error code, when it gave one (e.g. "08006"). */
  readonly code: string | null;

  constructor(where: string, cause: { message?: string; code?: string } | null | undefined) {
    // The cause's message is NOT part of the log line: for a malformed id it
    // echoes the caller's own text back (`invalid input syntax for type uuid: "..."`).
    super(`data room read failed: ${where}`);
    this.name = "DataRoomReadError";
    this.where = where;
    this.code = typeof cause?.code === "string" ? cause.code : null;
  }
}

/** Throw a DataRoomReadError for a failed query result; return the data otherwise. */
export function orThrowRead<T>(
  where: string,
  result: { data: T; error: { message?: string; code?: string } | null },
): T {
  if (result.error) throw new DataRoomReadError(where, result.error);
  return result.data;
}

/**
 * Record that a read failed, without letting the failure write the log line.
 * The message is a constant; `where` is a constant from this codebase; the code
 * goes through the id allowlist.
 */
export function logReadFailure(error: unknown): void {
  if (error instanceof DataRoomReadError) {
    console.error("[data-room] read failed", error.where, logId(error.code ?? "none"));
  } else {
    console.error("[data-room] unexpected failure", logId(error instanceof Error ? error.name : "unknown"));
  }
}
