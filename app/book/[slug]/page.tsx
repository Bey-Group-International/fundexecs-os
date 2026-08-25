// Public booking page: the meeting types a member offers on their scheduling
// link. Rendered server-side through the service role because visitors are
// anonymous — see app/api/scheduling for the same boundary on the JSON side.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { resolvePublicPage } from "@/lib/meetings/scheduling-service";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

async function loadPage(slug: string) {
  if (!hasSupabaseServiceEnv()) return null;
  try {
    return await resolvePublicPage(createServiceClient(), slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await loadPage(slug);
  if (!resolved) return { title: `Book a meeting — ${SITE_NAME}` };
  return {
    title: `Book with ${resolved.page.display_name} — ${SITE_NAME}`,
    description: resolved.page.headline ?? `Pick a time that works for you with ${resolved.page.display_name}.`,
  };
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolved = await loadPage(slug);
  if (!resolved) notFound();

  const { page, eventTypes } = resolved;

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <Logo />

        <header className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--gold-400)]">
            Schedule a meeting
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-primary)] sm:text-3xl">
            {page.display_name}
          </h1>
          {page.headline ? <p className="text-sm text-[var(--fg-secondary)]">{page.headline}</p> : null}
          {page.bio ? <p className="max-w-prose text-sm text-[var(--fg-muted)]">{page.bio}</p> : null}
        </header>

        {eventTypes.length === 0 ? (
          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-6 text-sm text-[var(--fg-muted)]">
            {page.display_name} isn&rsquo;t taking bookings through this link right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {eventTypes.map((type) => (
              <li key={type.id}>
                <Link
                  href={`/book/${page.slug}/${type.slug}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-4 transition-colors hover:border-[var(--gold-400)]/40 hover:bg-[var(--surface-2)]"
                >
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-[var(--fg-primary)]">{type.title}</span>
                    {type.description ? (
                      <span className="text-xs text-[var(--fg-muted)]">{type.description}</span>
                    ) : null}
                    <span className="flex items-center gap-2 text-xs text-[var(--fg-secondary)]">
                      <ClockIcon />
                      {type.duration_minutes} min
                      {type.requires_approval ? (
                        <span className="text-[var(--fg-muted)]">· confirmed by {page.display_name}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-[var(--gold-400)]">
                    <ArrowIcon />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-[var(--fg-muted)]">
          Times are shown in your own timezone. Powered by {SITE_NAME}.
        </p>
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
