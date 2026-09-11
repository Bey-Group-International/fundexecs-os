import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type {
  Organization,
  InvestmentThesis,
  TrackRecord,
  Entity,
  OrganizationMember,
  Principal,
  Document,
  DataRoomShare,
} from "@/lib/supabase/database.types";
import { blendTrackRecord } from "@/lib/track-record";
import { computeBuildReadiness } from "@/lib/build-readiness";
import {
  sectionLabel,
  groupRoomDocuments,
  summarizeRoom,
  unfinishedPublications,
  emptyPublications,
} from "@/lib/data-rooms";
import { listRooms, pickRoom, loadRoomDocuments } from "@/lib/data-rooms.server";
import { PrintButton } from "./PrintButton";
import { ShareControls } from "./ShareControls";
import { ViewerAnalytics } from "./ViewerAnalytics";
import { NdaSignatures } from "./NdaSignatures";
import { RoomSwitcher } from "./RoomSwitcher";
import { RoomContents, type RoomContentSection, type AvailableDoc } from "./RoomContents";

function compactUsd(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-0 px-4 py-3 text-center print:border-neutral-300 print:bg-white" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }}>
      <p className="font-display text-2xl font-semibold leading-none text-fg-primary print:text-black">
        {value}
      </p>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
        {label}
      </p>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string | null; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="h-4 w-0.5 rounded-full" style={{ backgroundColor: accent ?? "#D4AF6A" }} />
        <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted print:text-neutral-500">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

// Coverage arc SVG — shows weighted % as a thin arc on a circle
function CoverageArc({ percent }: { percent: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  return (
    <svg width={60} height={60} viewBox="0 0 60 60" className="shrink-0" aria-hidden>
      <circle cx={30} cy={30} r={r} fill="none" stroke="currentColor" strokeWidth={4} className="text-line" />
      <circle
        cx={30} cy={30} r={r}
        fill="none"
        stroke="#D4AF6A"
        strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
        className="transition-all duration-700"
      />
      <text x={30} y={35} textAnchor="middle" className="fill-fg-primary font-display text-[13px] font-semibold">
        {percent}%
      </text>
    </svg>
  );
}

// Materials & Data Room — the firm's institutional sharing surface. A room is a
// named, curated set of documents plus the links, gates, and analytics that
// govern who reads them; a firm runs several at once. Documents themselves are
// held and created in Documents (/build/documents) and reach a room only by an
// explicit publish, which is what keeps a half-finished draft out of an LP's
// hands. Nothing on this page creates or edits a document.
export async function MaterialsModule({ roomId }: { roomId?: string } = {}) {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const orgId = ctx.orgId;
  const supabase = await createServerClient();

  const rooms = await listRooms(orgId);
  const room = pickRoom(rooms, roomId);

  const [orgRes, thesesRes, recordsRes, entitiesRes, membersRes, allDocsRes] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).maybeSingle(),
    supabase
      .from("investment_theses")
      .select("*")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("track_records")
      .select("*")
      .eq("organization_id", orgId)
      .order("vintage_year", { ascending: false }),
    supabase.from("entities").select("*").eq("organization_id", orgId),
    supabase.from("organization_members").select("*").eq("organization_id", orgId),
    supabase
      .from("documents")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const org = orgRes.data as Organization | null;
  const theses = (thesesRes.data ?? []) as InvestmentThesis[];
  const thesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;
  const records = (recordsRes.data ?? []) as TrackRecord[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const libraryDocs = (allDocsRes.data ?? []) as Document[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }
  const byId = new Map(principals.map((p) => [p.id, p]));

  const blended = blendTrackRecord(records);
  const accent = org?.brand_color && /^#[0-9a-fA-F]{3,8}$/.test(org.brand_color) ? org.brand_color : null;
  const checkSize = [compactUsd(thesis?.check_size_min ?? null), compactUsd(thesis?.check_size_max ?? null)].filter(Boolean);

  if (!room) {
    return (
      <div>
        <Header />
        <p className="text-sm text-fg-secondary">
          Couldn&apos;t load your data rooms. Refresh, or{" "}
          <Link href="/build/documents" className="text-gold-300 hover:underline">
            start in Documents
          </Link>
          .
        </p>
      </div>
    );
  }

  // Only what is published here — not the whole library.
  const published = await loadRoomDocuments(orgId, room.id);
  const publishedIds = new Set(published.map((d) => d.id));
  const roomSections = groupRoomDocuments(published);

  const shares = (
    (
      await supabase
        .from("data_room_shares")
        .select("*")
        .eq("organization_id", orgId)
        .eq("room_id", room.id)
        .order("created_at", { ascending: false })
    ).data ?? []
  ) as DataRoomShare[];

  // Coverage is scored against this room's published set, so an unpublished
  // draft can never make a room look complete.
  const docCounts: Record<string, number> = {};
  for (const d of libraryDocs) {
    const k = d.doc_type ?? "other";
    docCounts[k] = (docCounts[k] ?? 0) + 1;
  }
  const readiness = computeBuildReadiness({ org, theses, entities, records, members, principals, docCounts });
  const summary = summarizeRoom(readiness.statuses, published);

  const unfinished = unfinishedPublications(published);
  const empty = emptyPublications(published);

  const contentSections: RoomContentSection[] = roomSections.map((s) => ({
    key: s.key,
    label: s.label,
    docs: s.docs.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      hasBody: Boolean(d.storageKey) || d.hasContent,
      isLink: Boolean(d.storageKey),
    })),
  }));

  const available: AvailableDoc[] = libraryDocs
    .filter((d) => !publishedIds.has(d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      sectionLabel: sectionLabel(d.doc_type),
      status: d.status ?? "ready",
    }));

  const activeShareCount = shares.filter(
    (s) => !s.revoked_at && !(s.expires_at && new Date(s.expires_at).getTime() < Date.now()),
  ).length;

  const nextSuggestion = summary.suggestions[0] ?? null;

  return (
    <div>
      <Header />

      <RoomSwitcher
        rooms={rooms.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isDefault: r.is_default,
        }))}
        current={{
          id: room.id,
          name: room.name,
          description: room.description,
          isDefault: room.is_default,
        }}
      />

      {/* Room status: coverage of what is actually published, plus the two
          things worth catching before a link goes out. */}
      <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface-1 print:hidden" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div className="flex items-center gap-4 border-b border-line px-5 py-4">
          <div className="flex-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
              Institutional Coverage
            </p>
            <p className="mt-0.5 text-sm text-fg-secondary">
              {summary.readyCount} of {summary.total} sections covered in{" "}
              <span className="text-fg-primary">{room.name}</span> · {published.length} document
              {published.length === 1 ? "" : "s"} published · {activeShareCount} live link
              {activeShareCount === 1 ? "" : "s"}
            </p>
            {room.description ? (
              <p className="mt-1 text-xs text-fg-muted">{room.description}</p>
            ) : null}
          </div>
          <CoverageArc percent={summary.weightedPercent} />
        </div>

        <div className="flex flex-col gap-2 p-4">
          {unfinished.length > 0 ? (
            <Warning tone="amber">
              {`${unfinished.length} published document${unfinished.length > 1 ? "s are" : " is"} still marked draft or in review — ${unfinished
                .slice(0, 3)
                .map((d) => d.name)
                .join(", ")}${unfinished.length > 3 ? "…" : ""}. Viewers can read ${unfinished.length > 1 ? "them" : "it"} now.`}
            </Warning>
          ) : null}
          {empty.length > 0 ? (
            <Warning tone="muted">
              {`${empty.length} published document${empty.length > 1 ? "s have" : " has"} no file link and no content — ${empty.length > 1 ? "they render" : "it renders"} as an empty entry.`}
            </Warning>
          ) : null}
          {nextSuggestion ? (
            <Link
              href="/build/documents"
              className="flex items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-2.5 transition hover:bg-gold-500/10"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
                Gap in this room
              </span>
              <span className="truncate text-sm text-fg-primary">{nextSuggestion.suggestion}</span>
              <span className="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                Documents →
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm text-emerald-400">
                Every section is covered — institutional-grade coverage.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* What this room exposes */}
      <div className="mb-8 rounded-2xl border border-line bg-surface-1 p-5 print:hidden" style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
            Room Contents
          </h3>
          <Link
            href="/build/documents"
            className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300"
          >
            Create &amp; edit in Documents →
          </Link>
        </div>
        <RoomContents roomId={room.id} sections={contentSections} available={available} />
      </div>

      {/* The branded sheet — the cover an allocator sees first */}
      <article
        className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface-1 print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-black"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}
      >
        <div className="h-1 w-full" style={{ backgroundColor: accent ?? "#D4AF6A" }} />

        <div className="p-8 print:p-0">
          <header className="flex items-start gap-5 border-b pb-6" style={{ borderColor: accent ? `${accent}44` : "rgba(255,255,255,0.08)" }}>
            {org?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-contain" />
            ) : (
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-display text-2xl font-semibold text-surface-0"
                style={{ backgroundColor: accent ?? "#D4AF6A" }}
              >
                {(org?.name ?? "F").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary print:text-black">
                {org?.name ?? "Your Firm"}
              </h1>
              {org?.tagline ? (
                <p className="mt-1 text-sm text-fg-secondary print:text-neutral-700">{org.tagline}</p>
              ) : null}
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                {[org?.entity_type, org?.jurisdiction, org?.website].filter(Boolean).join("  ·  ") || "—"}
              </p>
            </div>
          </header>

          <Section title="Track Record" accent={accent}>
            {blended.dealCount > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric
                  value={blended.weightedGrossIrr != null ? `${blended.weightedGrossIrr.toFixed(0)}%` : "—"}
                  label="Gross IRR"
                />
                <Metric value={blended.pooledMoic != null ? `${blended.pooledMoic.toFixed(1)}x` : "—"} label="MOIC" />
                <Metric value={blended.dpi != null ? `${blended.dpi.toFixed(2)}x` : "—"} label="DPI" />
                <Metric value={compactUsd(blended.totalInvested) ?? "—"} label="Invested" />
              </div>
            ) : (
              <p className="text-sm text-fg-muted print:text-neutral-500">No track record captured yet.</p>
            )}
            {blended.dealCount > 0 ? (
              <p className="mt-2.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                {blended.dealCount} deals · {blended.realizedCount} realized
                {blended.vintageRange ? ` · vintages ${blended.vintageRange.from}–${blended.vintageRange.to}` : ""}
              </p>
            ) : null}
          </Section>

          {thesis ? (
            <Section title="Investment Thesis" accent={accent}>
              <p className="text-sm font-semibold text-fg-primary print:text-black">{thesis.title}</p>
              {thesis.summary ? (
                <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary print:text-neutral-700">
                  {thesis.summary}
                </p>
              ) : null}
              <p className="mt-2.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                {[
                  thesis.asset_classes?.join(", "),
                  thesis.geographies?.join(", "),
                  checkSize.length ? checkSize.join("–") : null,
                  thesis.target_irr != null ? `${thesis.target_irr}% target IRR` : null,
                  thesis.target_moic != null ? `${thesis.target_moic}x target MOIC` : null,
                ]
                  .filter(Boolean)
                  .join("  ·  ") || "—"}
              </p>
            </Section>
          ) : null}

          {members.length > 0 ? (
            <Section title="Team" accent={accent}>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const p = byId.get(m.principal_id);
                  const name = p?.full_name || p?.email || "Member";
                  return (
                    <span
                      key={m.id}
                      className="rounded-full border border-line bg-surface-0 px-3 py-1.5 text-xs text-fg-secondary print:border-neutral-300 print:bg-white print:text-neutral-700"
                    >
                      <span className="font-medium text-fg-primary print:text-black">{name}</span>
                      {p?.title ? <span className="text-fg-muted print:text-neutral-500"> · {p.title}</span> : null}
                    </span>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {entities.length > 0 ? (
            <Section title="Structure" accent={accent}>
              <p className="text-sm text-fg-secondary print:text-neutral-700">
                {entities.map((e) => e.name).join("  ·  ")}
              </p>
            </Section>
          ) : null}

          {/* Index of what this room publishes — not the whole library. */}
          {roomSections.length > 0 ? (
            <Section title="Materials Index" accent={accent}>
              <div className="flex flex-col gap-3">
                {roomSections.map((s) => (
                  <div key={s.key}>
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-500">
                      {s.label}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {s.docs.map((d) => (
                        <li key={d.id} className="text-sm text-fg-primary print:text-black">
                          {d.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <footer className="mt-8 border-t border-line pt-4 print:border-neutral-300">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted print:text-neutral-400">
              {org?.legal_name ?? ""}
              {org?.description ? `  ·  ${org.description}` : ""}
            </p>
          </footer>
        </div>
      </article>

      {/* Access */}
      <div className="mx-auto mt-8 max-w-2xl space-y-8 print:hidden">
        <ShareControls
          roomId={room.id}
          roomName={room.name}
          publishedSections={roomSections.map((s) => ({ key: s.key, label: s.label, count: s.docs.length }))}
          shares={shares.map((s) => ({
            id: s.id,
            token: s.token,
            label: s.label,
            expires_at: s.expires_at,
            revoked_at: s.revoked_at,
            created_at: s.created_at,
            allowed_sections: s.allowed_sections ?? null,
          }))}
          activeCount={activeShareCount}
        />

        <ViewerAnalytics roomId={room.id} />
        <NdaSignatures roomId={room.id} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">
          Materials &amp; Data Room
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Curated rooms you share with LPs, lenders, and partners. Documents are created in{" "}
          <Link href="/build/documents" className="text-gold-300 hover:underline">
            Documents
          </Link>{" "}
          and appear here only when you publish them.
        </p>
      </div>
      <PrintButton />
    </div>
  );
}

function Warning({ tone, children }: { tone: "amber" | "muted"; children: string }) {
  const cls =
    tone === "amber"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
      : "border-line bg-surface-0 text-fg-muted";
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${cls}`}>
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span>{children}</span>
    </div>
  );
}
