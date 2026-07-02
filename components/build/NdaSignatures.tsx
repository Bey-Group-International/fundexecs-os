import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { NdaSignature, DataRoomShare } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// NdaSignatures — server component
// ---------------------------------------------------------------------------

/**
 * Renders a table of NDA signatures for all data room shares belonging to
 * the current user's organisation.  Intended to sit alongside ViewerAnalytics
 * inside the Materials module.
 */
export async function NdaSignatures() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;

  const supabase = createServerClient();

  // Fetch signatures for this org, joining the share label for display.
  const { data: rows } = await supabase
    .from("nda_signatures")
    .select(
      `
      id,
      share_id,
      organization_id,
      signer_name,
      signer_email,
      signed_at,
      ip_hint,
      data_room_shares ( label, token )
    `
    )
    .eq("organization_id", ctx.orgId)
    .order("signed_at", { ascending: false })
    .limit(200);

  type Row = NdaSignature & {
    data_room_shares: Pick<DataRoomShare, "label" | "token"> | null;
  };

  const signatures = (rows ?? []) as Row[];

  if (signatures.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-1 px-6 py-10 text-center">
        <p className="text-sm text-fg-muted">No NDA signatures recorded yet.</p>
        <p className="mt-1 text-xs text-fg-muted">
          Signatures appear here once viewers sign the NDA gate on a shared data room.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="border-b border-line px-5 py-4">
        <h3 className="font-display text-sm font-semibold text-fg-primary">NDA Signatures</h3>
        <p className="mt-0.5 text-xs text-fg-muted">
          {signatures.length} signature{signatures.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-fg-muted">
              <th className="px-5 py-3 font-medium">Share</th>
              <th className="px-5 py-3 font-medium">Signer Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Signed At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {signatures.map((sig) => {
              const shareLabel =
                sig.data_room_shares?.label ?? sig.data_room_shares?.token ?? sig.share_id;

              return (
                <tr key={sig.id} className="hover:bg-surface-0/40">
                  <td className="px-5 py-3 font-mono text-xs text-fg-secondary">{shareLabel}</td>
                  <td className="px-5 py-3 font-medium text-fg-primary">{sig.signer_name}</td>
                  <td className="px-5 py-3 text-fg-secondary">
                    {sig.signer_email ? (
                      <a
                        href={`mailto:${sig.signer_email}`}
                        className="hover:text-gold-400 hover:underline"
                      >
                        {sig.signer_email}
                      </a>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-fg-muted">
                    {fmtDate(sig.signed_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
