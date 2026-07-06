// components/execute/ShareholderCommsModule.tsx
// Execute › Shareholder Comms — LP/shareholder communication templates tracked
// through a draft → scheduled → sent lifecycle. Reads the shareholder_comms
// table (best-effort, RLS-enforced) and renders the presentational board plus a
// quick "new template" form. Mirrors the ClosingLive server-component pattern.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { ShareholderComms, type CommTemplate } from "@/components/execute/ShareholderComms";
import { addShareholderComm } from "@/components/execute/comms-actions";

interface CommRow {
  id: string;
  title: string;
  type: CommTemplate["type"];
  status: CommTemplate["status"];
  last_sent_date: string | null;
  recipient_count: number | null;
}

const TYPE_OPTIONS: { value: CommTemplate["type"]; label: string }[] = [
  { value: "quarterly_update", label: "Quarterly Update" },
  { value: "capital_call", label: "Capital Call" },
  { value: "distribution_notice", label: "Distribution Notice" },
  { value: "annual_report", label: "Annual Report" },
  { value: "ad_hoc", label: "Ad Hoc" },
];

async function loadTemplates(): Promise<CommTemplate[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const supabase = await createServerClient();
    // shareholder_comms isn't in the generated types yet (migration
    // 20260707140000) — read via an untyped client, like SigningModule/envelopes.
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => { limit: (n: number) => Promise<{ data: unknown }> };
          };
        };
      };
    })
      .from("shareholder_comms")
      .select("id, title, type, status, last_sent_date, recipient_count")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    return ((data ?? []) as unknown as CommRow[]).map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      lastSentDate: r.last_sent_date,
      recipientCount: r.recipient_count,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

export async function ShareholderCommsModule() {
  const templates = await loadTemplates();

  return (
    <div>
      <ModuleHeader
        title="Shareholder Comms"
        blurb="Draft, schedule, and track LP communications — quarterly updates, capital calls, distribution notices, and more."
      />

      <form
        action={addShareholderComm}
        className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1 p-3"
      >
        <input
          name="title"
          required
          placeholder="New communication title…"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <select
          name="type"
          defaultValue="quarterly_update"
          className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/60 focus:outline-none"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
          + Draft
        </button>
      </form>

      <ShareholderComms templates={templates} />
    </div>
  );
}
