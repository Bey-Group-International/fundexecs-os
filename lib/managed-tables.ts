// lib/managed-tables.ts
// Shared, side-effect-free definitions for record management. Kept out of the
// "use server" actions file (which may only export async functions) so the
// allow-list, types, and guard can be imported by both the server actions and
// client components.

// Table-backed module records that support verify / archive / delete. A literal
// allow-list so a caller can never point these mutations at an arbitrary table.
// (Build › Thesis/Track Record use bespoke editors and are excluded.)
export const MANAGED_TABLES = [
  "investors",
  "deals",
  "partners",
  "service_providers",
  "debt_facilities",
  "underwritings",
  "diligence_items",
  "capital_events",
  "assets",
] as const;

export type ManagedTable = (typeof MANAGED_TABLES)[number];

export function isManagedTable(table: string): table is ManagedTable {
  return (MANAGED_TABLES as readonly string[]).includes(table);
}

export interface RecordActionResult {
  ok: boolean;
  error?: string;
}
