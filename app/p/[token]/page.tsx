import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe, Link2, ShieldCheck } from 'lucide-react';
import { getPublicProfile } from '@/lib/queries/public-profile';

export const dynamic = 'force-dynamic';

/**
 * Public, token-gated Profile page (/p/<token>).
 *
 * Server-rendered via the service-role admin client (see getPublicProfile),
 * which validates the share token and returns ONLY the safe subset. No AppShell
 * and no auth — this is a clean, read-only public surface. Sensitive fields are
 * never loaded into the payload, so they can't be exposed here.
 */

export async function generateMetadata({
  params
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const profile = await getPublicProfile(token);
  if (!profile) return { title: 'Profile unavailable · FundExecs', robots: { index: false } };
  return {
    title: `${profile.entityName} · FundExecs`,
    description: profile.headline ?? `${profile.entityName} on FundExecs.`,
    robots: { index: false }
  };
}

export default async function PublicProfilePage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const profile = await getPublicProfile(token);

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-0 px-6">
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-bg-1 p-8 text-center shadow-[var(--shadow-lg)]">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-4">
            Link unavailable
          </p>
          <h1 className="mt-2 text-[18px] font-semibold tracking-[-0.015em] text-fg-1">
            This profile link isn&rsquo;t active
          </h1>
          <p className="mt-2 text-[13px] text-fg-3">
            It may have been revoked or expired. Ask whoever shared it for a fresh link.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-xl bg-[var(--cta-gradient)] px-4 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110"
          >
            Explore FundExecs
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-0 px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        {/* Wordmark */}
        <div className="mb-5 flex items-center justify-between">
          <div className="text-[15px] font-semibold tracking-[-0.02em] text-fg-1">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-1">
            <ShieldCheck size={11} strokeWidth={2} aria-hidden />
            Verified profile
          </span>
        </div>

        <article className="overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]">
          {/* Header */}
          <header className="relative px-6 py-7">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.10), transparent 60%), radial-gradient(60% 100% at 100% 0%, rgba(91,141,239,0.08), transparent 65%)'
              }}
            />
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-gold-1">
              Source of Truth · on the record
            </p>
            <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em] text-fg-1 sm:text-[30px]">
              {profile.entityName}
            </h1>
            {profile.ownerName ? (
              <p className="mt-0.5 text-[13px] text-fg-3">{profile.ownerName}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge>{profile.memberLabel}</Badge>
              {profile.tier ? <Badge>{profile.tier}</Badge> : null}
              {profile.category ? <Badge>{profile.category}</Badge> : null}
            </div>
            {profile.headline ? (
              <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-fg-2">
                {profile.headline}
              </p>
            ) : null}
          </header>

          <div className="flex flex-col gap-5 border-t border-hairline px-6 py-6">
            <ChipSection label="Focus areas" items={profile.focusAreas} />
            <ChipSection label="Sectors" items={profile.sectors} />
            <ChipSection label="Stage focus" items={profile.stageFocus} />

            {(profile.website || profile.linkedin) && (
              <section>
                <SectionLabel>Links</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.website ? (
                    <LinkPill href={profile.website} icon="globe" label="Website" />
                  ) : null}
                  {profile.linkedin ? (
                    <LinkPill href={profile.linkedin} icon="linkedin" label="LinkedIn" />
                  ) : null}
                </div>
              </section>
            )}
          </div>

          {/* Footer CTA */}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-surface-2/40 px-6 py-4">
            <p className="text-[11.5px] text-fg-4">
              Credible details, documented as they form — on FundExecs.
            </p>
            <Link
              href="/"
              className="inline-flex rounded-lg bg-[var(--cta-gradient)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110"
            >
              Build your own
            </Link>
          </footer>
        </article>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * Presentational helpers (server-only, no interactivity)
 * ------------------------------------------------------------------------- */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-hairline bg-surface-1 px-2.5 py-0.5 text-[11px] font-medium text-fg-2">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">{children}</p>
  );
}

function ChipSection({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-hairline bg-surface-1 px-2.5 py-0.5 text-[11.5px] text-fg-2"
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function LinkPill({
  href,
  icon,
  label
}: {
  href: string;
  icon: 'globe' | 'linkedin';
  label: string;
}) {
  const Icon = icon === 'globe' ? Globe : Link2;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-1 px-3 py-1.5 text-[12px] font-medium text-azure-1 transition hover:bg-surface-1"
    >
      <Icon size={13} strokeWidth={2} aria-hidden />
      {label}
    </a>
  );
}
