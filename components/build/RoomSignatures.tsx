import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { createServerClient } from "@/lib/supabase/server";
import { CountersignForm } from "@/components/build/CountersignForm";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

interface Row {
  id: string;
  file_name: string;
  signer_name: string;
  signer_email: string;
  signed_at: string;
  countersigner_name: string | null;
  countersigned_at: string | null;
}

/**
 * Files signed in this room, with the fund's side of each. A signature with no
 * counter-signature is an open item; counter-signing it resolves the item.
 */
export async function RoomSignatures({ roomId }: { roomId: string }) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("data_room_document_signatures")
    .select("id, file_name, signer_name, signer_email, signed_at, countersigner_name, countersigned_at")
    .eq("organization_id", ctx.orgId)
    .eq("room_id", roomId)
    .order("signed_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;

  const canCountersign = canAdminOrg(ctx.role) && ctx.emailConfirmed && !!ctx.email;
  const awaiting = rows.filter((r) => !r.countersigned_at).length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      <div className="border-b border-line px-5 py-4">
        <h3 className="font-display text-sm font-semibold text-fg-primary">Document signatures</h3>
        <p className="mt-0.5 text-xs text-fg-muted">
          {awaiting > 0 ? `${awaiting} awaiting your counter-signature` : "All counter-signed"}
        </p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg-primary">{r.file_name}</p>
                <p className="text-xs text-fg-muted">
                  Signed by {r.signer_name} · {day(r.signed_at)}
                </p>
                <p className="text-xs text-fg-secondary">
                  {r.countersigned_at
                    ? `Counter-signed ${day(r.countersigned_at)} by ${r.countersigner_name ?? "the fund"}`
                    : "Awaiting counter-signature"}
                </p>
              </div>
              <a
                href={`/api/dataroom/doc-signature/${r.id}`}
                className="font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
              >
                {r.countersigned_at ? "Executed PDF →" : "Signed-so-far PDF →"}
              </a>
            </div>
            {!r.countersigned_at && canCountersign ? <CountersignForm signatureId={r.id} fileName={r.file_name} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
