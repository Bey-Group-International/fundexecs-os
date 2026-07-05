// Tests for the backend-connector sync layer. Pure: connector availability
// shape, and runProviderSync against an injected fake supabase (no real DB).

import { PROFESSIONAL_NETWORK_CONNECTORS } from "./connectors";
import { runProviderSync } from "./sync.server";
import type { ProfessionalNetworkSyncJob } from "@/lib/supabase/database.types";

describe("connector availability", () => {
  it("every connector reports a well-formed availability result", () => {
    for (const connector of PROFESSIONAL_NETWORK_CONNECTORS) {
      const availability = connector.availability();
      if (availability.available) {
        expect(availability).toEqual({ available: true });
      } else {
        // Pending → honest, user-facing guidance (never an empty reason).
        expect(availability.available).toBe(false);
        expect(typeof availability.reason).toBe("string");
        expect(availability.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("connectors with no credentials stay listed and pending, never throw", () => {
    // In this env no provider creds are set, so both connectors are pending.
    for (const connector of PROFESSIONAL_NETWORK_CONNECTORS) {
      expect(() => connector.availability()).not.toThrow();
    }
  });
});

// A minimal fake supabase that records the rows it was asked to write and
// replays a canned row back through the insert/update → select → single chain.
// Kept tiny and pure — it never touches a real database.
function fakeSupabase() {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let seq = 0;

  const makeRow = (patch: Record<string, unknown>): ProfessionalNetworkSyncJob => ({
    id: `job-${++seq}`,
    organization_id: (patch.organization_id as string) ?? "org-1",
    connection_id: null,
    provider: (patch.provider as string) ?? "contacts",
    status: (patch.status as string) ?? "running",
    sync_type: (patch.sync_type as string) ?? "manual_refresh",
    records_seen: (patch.records_seen as number) ?? 0,
    records_created: (patch.records_created as number) ?? 0,
    records_updated: (patch.records_updated as number) ?? 0,
    records_deduped: (patch.records_deduped as number) ?? 0,
    error_message: (patch.error_message as string | null) ?? null,
    started_at: (patch.started_at as string | null) ?? null,
    completed_at: (patch.completed_at as string | null) ?? null,
    created_by: (patch.created_by as string | null) ?? null,
    created_at: new Date().toISOString(),
  });

  let lastRow: ProfessionalNetworkSyncJob | null = null;

  const client = {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          lastRow = makeRow(row);
          return {
            select() {
              return {
                single: async () => ({ data: lastRow, error: null }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          updated.push(patch);
          lastRow = makeRow({ ...(lastRow ?? {}), ...patch });
          return {
            eq() {
              return {
                select() {
                  return {
                    single: async () => ({ data: lastRow, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, inserted, updated };
}

describe("runProviderSync", () => {
  it("marks the job 'paused' when the connector is unavailable (pending auth)", async () => {
    const { client, inserted, updated } = fakeSupabase();
    // No creds in this env → connector is unavailable → job pauses.
    const result = await runProviderSync(client as never, {
      orgId: "org-1",
      userId: "user-1",
      provider: "contacts",
    });

    expect(result.ok).toBe(false);
    if (result.ok || !result.pending) throw new Error("expected pending result");
    expect(result.pending).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);

    // A job row was inserted 'running' then patched to 'paused' with the reason.
    expect(inserted[0]).toMatchObject({ provider: "contacts", status: "running", created_by: "user-1" });
    expect(updated[0]).toMatchObject({ status: "paused" });
    expect(result.job?.status).toBe("paused");
  });

  it("returns an error (no job) for an unknown provider", async () => {
    const { client, inserted } = fakeSupabase();
    const result = await runProviderSync(client as never, {
      orgId: "org-1",
      userId: "user-1",
      provider: "not_a_provider" as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error result");
    expect(result.job).toBeNull();
    // Never touched the DB for an unknown connector.
    expect(inserted).toHaveLength(0);
  });
});
