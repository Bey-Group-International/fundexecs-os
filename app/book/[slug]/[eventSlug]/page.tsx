// One bookable meeting type on a public scheduling link.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Logo } from "@/components/Logo";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { openSlots, resolvePublicPage } from "@/lib/meetings/scheduling-service";
import type { SlotWindow } from "@/lib/meetings/scheduling";
import { SITE_NAME } from "@/lib/site";
import { BookingFlow } from "./BookingFlow";

export const dynamic = "force-dynamic";

// Shared by generateMetadata and the page within one request (React `cache`),
// so an anonymous visit reads the scheduling page once rather than twice.
const load = cache(async (slug: string, eventSlug: string) => {
  if (!hasSupabaseServiceEnv()) return null;
  try {
    const resolved = await resolvePublicPage(createServiceClient(), slug);
    if (!resolved) return null;
    const eventType = resolved.eventTypes.find((t) => t.slug === eventSlug);
    if (!eventType) return null;
    return { page: resolved.page, eventType };
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { slug, eventSlug } = await params;
  const found = await load(slug, eventSlug);
  if (!found) return { title: `Book a meeting — ${SITE_NAME}` };
  return {
    title: `${found.eventType.title} with ${found.page.display_name} — ${SITE_NAME}`,
    description: found.eventType.description ?? `Book ${found.eventType.duration_minutes} minutes.`,
  };
}

export default async function EventTypeBookingPage({
  params,
}: {
  params: Promise<{ slug: string; eventSlug: string }>;
}) {
  const { slug, eventSlug } = await params;
  const found = await load(slug, eventSlug);
  if (!found) notFound();

  const { page, eventType } = found;

  // The first screen of open times, worked out here rather than by the browser
  // after it hydrates: the page already has the host and the event type in
  // hand, and the default window is exactly what the client would have asked
  // /slots for. A failure falls back to the client fetch, never to an error.
  let initialSlots: SlotWindow[] | undefined;
  try {
    initialSlots = (await openSlots(createServiceClient(), page, eventType, { fromDate: null, toDate: null })).slots;
  } catch (err) {
    console.error("[book/[slug]/[eventSlug]] initial slots", err);
  }

  return (
    <div className="fx-blueprint min-h-screen bg-surface-0 px-4 py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <Logo />

        <header className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--gold-400)]">
            {page.display_name}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-primary)]">{eventType.title}</h1>
          <p className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <ClockIcon />
            {eventType.duration_minutes} minutes
          </p>
          {eventType.description ? (
            <p className="max-w-prose text-sm text-[var(--fg-muted)]">{eventType.description}</p>
          ) : null}
        </header>

        <BookingFlow
          slug={page.slug}
          hostName={page.display_name}
          eventType={{
            id: eventType.id,
            slug: eventType.slug,
            title: eventType.title,
            description: eventType.description,
            durationMinutes: eventType.duration_minutes,
            requiresApproval: eventType.requires_approval,
          }}
          initialSlots={initialSlots}
        />
      </div>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
