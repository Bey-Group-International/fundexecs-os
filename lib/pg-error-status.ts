// lib/pg-error-status.ts
// Turning a Postgres error code from a SECURITY DEFINER function into an HTTP
// status.
//
// The CRM has operations RLS correctly forbids from the client — merging two
// contacts, correcting a machine-written entry — so they run as definer
// functions that check authorization themselves and `raise exception` with a
// chosen code. That code is the function's contract with its callers, and more
// than one route now depends on it, so the mapping lives here rather than being
// copied per route and drifting.
//
// Pure: no database, no network.

/**
 * The status for a code a definer function raised, or 500 for anything else.
 *
 * 500 is the deliberate default: an unrecognised code is a fault nobody planned
 * for, and reporting it as a client error would tell the caller to fix something
 * that is not theirs to fix.
 */
export function statusForPgCode(code: unknown): number {
  switch (code) {
    // no_data_found. Also raised when a record exists but is invisible to this
    // caller, so that "forbidden" and "absent" are indistinguishable from
    // outside — telling them apart would confirm the record exists.
    case "P0002":
      return 404;
    case "42501": // insufficient_privilege
      return 403;
    case "22023": // invalid_parameter_value
      return 400;
    default:
      return 500;
  }
}
