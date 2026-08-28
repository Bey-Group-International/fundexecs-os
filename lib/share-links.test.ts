import { mintShareLink } from "./share-links";

/**
 * A minimal stand-in for the Supabase query builder — just enough of the
 * chain that `mintShareLink` uses, recording what it was asked for.
 */
function makeClient(opts: {
  session?: { id: string } | null;
  upsertToken?: string | null;
  upsertError?: { message: string } | null;
  existingToken?: string | null;
}) {
  const calls: { table: string; op: string; args?: unknown }[] = [];

  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    const self = () => chain;

    chain.select = self;
    chain.eq = self;
    chain.upsert = (row: unknown, options: unknown) => {
      calls.push({ table, op: "upsert", args: options });
      return chain;
    };
    chain.maybeSingle = async () => {
      if (table === "sessions") return { data: opts.session ?? null, error: null };
      // The first session_shares read is the upsert's returning row; any later
      // one is the read-back after ignoreDuplicates swallowed the insert.
      const seen = calls.filter((c) => c.table === "session_shares" && c.op === "read").length;
      calls.push({ table, op: "read" });
      if (seen === 0) {
        if (opts.upsertError) return { data: null, error: opts.upsertError };
        return { data: opts.upsertToken ? { token: opts.upsertToken } : null, error: null };
      }
      return { data: opts.existingToken ? { token: opts.existingToken } : null, error: null };
    };
    return chain;
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    calls,
  };
}

const INPUT = { orgId: "org-1", userId: "user-1", sessionId: "sess-1", scope: "org" as const };

describe("mintShareLink", () => {
  it("returns the token minted for a session that has no share yet", async () => {
    const { client } = makeClient({ session: { id: "sess-1" }, upsertToken: "tok-new" });
    await expect(mintShareLink(client, INPUT)).resolves.toEqual({ ok: true, url: "/s/tok-new" });
  });

  it("returns the existing token when the upsert conflicts, never a rotated one", async () => {
    // ignoreDuplicates means no row comes back; the token already circulating
    // must be handed out again rather than replaced.
    const { client } = makeClient({
      session: { id: "sess-1" },
      upsertToken: null,
      existingToken: "tok-original",
    });
    await expect(mintShareLink(client, INPUT)).resolves.toEqual({ ok: true, url: "/s/tok-original" });
  });

  it("upserts on the (session, org, scope) triple and keeps the existing row", async () => {
    const { client, calls } = makeClient({ session: { id: "sess-1" }, upsertToken: "tok" });
    await mintShareLink(client, INPUT);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.args).toEqual({
      onConflict: "session_id,organization_id,scope",
      ignoreDuplicates: true,
    });
  });

  it("refuses a session outside the caller's org", async () => {
    // RLS would also hide it; this turns a silent empty result into an answer.
    const { client } = makeClient({ session: null });
    const result = await mintShareLink(client, INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("That conversation is no longer available.");
  });

  it("refuses an empty session id without touching the database", async () => {
    const { client, calls } = makeClient({ session: { id: "sess-1" } });
    const result = await mintShareLink(client, { ...INPUT, sessionId: "" });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("reports a failure rather than returning a broken link", async () => {
    const { client } = makeClient({
      session: { id: "sess-1" },
      upsertError: { message: "boom" },
    });
    const result = await mintShareLink(client, INPUT);
    expect(result.ok).toBe(false);
    expect(result.url).toBeUndefined();
  });
});
