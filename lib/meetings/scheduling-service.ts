// lib/meetings/scheduling-service.ts
// Database side of scheduling links: resolving a public booking page, working
// out what's actually open, and turning a claimed slot into a real FundExecs
// meeting room.
//
// Two callers with very different trust levels share this module. Host routes
// pass a request-scoped (RLS-enforced) client; the public booking routes pass a
// service-role client, because an invitee has no session at all. Nothing here
// takes the caller's word for what is bookable — `createBooking` and
// `rescheduleBooking` re-derive the open slots from the host's own rules before
// writing, so a stale or hand-crafted request can't claim a time the page never
// offered.
import type { createServerClient } from "@/lib/supabase/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type {
  Database,
  Json,
  SchedulingBooking,
  SchedulingEventType,
  SchedulingPage,
} from "@/lib/supabase/database.types";
import { generateRoomCode } from "@/lib/meetings/service";
import { blocksToBusyIntervals } from "@/lib/meetings/blocks";
import { externalBusyForUser } from "@/lib/calendar/feeds.server";
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_EVENT_TYPES,
  type BusyInterval,
  type SchedulingAvailabilityRule,
  type SlotWindow,
  addCalendarDays,
  bookingWindowRange,
  generateManageToken,
  generateSlots,
  isReservedSlug,
  isSlotAvailable,
  isValidTimezone,
  normalizeSlug,
  parseAvailability,
  suggestSlug,
} from "@/lib/meetings/scheduling";

export type SchedulingClient =
  | Awaited<ReturnType<typeof createServerClient>>
  | ReturnType<typeof createServiceClient>;

const PAGE_COLUMNS =
  "id, user_id, organization_id, slug, display_name, headline, bio, timezone, availability, buffer_minutes, min_notice_minutes, booking_window_days, is_active, created_at, updated_at";
const EVENT_TYPE_COLUMNS =
  "id, page_id, user_id, organization_id, slug, title, description, duration_minutes, slot_interval_minutes, meeting_type, requires_approval, is_active, sort_order, created_at, updated_at";
const BOOKING_COLUMNS =
  "id, page_id, event_type_id, host_user_id, organization_id, meeting_id, invitee_name, invitee_email, invitee_notes, invitee_timezone, starts_at, ends_at, status, cancelled_by, cancellation_reason, manage_token, rescheduled_at, decided_at, calendar_sequence, created_at, updated_at";

/** Longest meeting the platform allows — bounds every "started before" lookback. */
const MAX_MEETING_MINUTES = 480;

/**
 * Ceiling on rows read per busy lookup. Sized well above any plausible number
 * of commitments in one booking window; exceeding it is logged, never silent.
 */
const BUSY_ROW_CAP = 2000;

type TableName = keyof Database["public"]["Tables"];

/**
 * The SSR and service-role clients are structurally identical across our query
 * surface, but the union of the two confuses TS's `.from()` overload
 * resolution. Narrowing once here keeps every call site typed by table name.
 */
function table<T extends TableName>(client: SchedulingClient, name: T) {
  return (client as ReturnType<typeof createServiceClient>).from(name);
}

export interface PageWithEventTypes {
  page: SchedulingPage;
  eventTypes: SchedulingEventType[];
}

/**
 * The signed-in member's scheduling page, creating it (with a suggested handle
 * and two starter event types) the first time they open the Meetings page.
 * Availability defaults to weekdays 9–5 in their browser-reported timezone.
 */
export async function getOrCreatePageForUser(
  client: SchedulingClient,
  ctx: { userId: string; orgId: string | null; email?: string | null; displayName?: string | null; timezone?: string | null },
): Promise<PageWithEventTypes> {
  const existing = await table(client, "scheduling_pages")
    .select(PAGE_COLUMNS)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let page = existing.data as SchedulingPage | null;

  if (!page) {
    // The caller rarely knows the member's real name, but their principal row
    // does — and this name is what every invitee sees on the public booking
    // page, so falling back to the email local part ("a.lovelace") is a poor
    // last resort rather than a first choice.
    let displayName = ctx.displayName?.trim() || "";
    if (!displayName) {
      const { data } = await table(client, "principals")
        .select("full_name")
        .eq("id", ctx.userId)
        .maybeSingle();
      displayName = (data as { full_name: string | null } | null)?.full_name?.trim() || "";
    }

    const desired = suggestSlug({ displayName, email: ctx.email, userId: ctx.userId });
    const display = displayName || ctx.email?.split("@")[0] || "FundExecs member";

    // Two members can race for the same handle between the probe and the
    // INSERT, and the probe can be blind entirely without a service role. The
    // UNIQUE index is the real arbiter, so lose gracefully and try again rather
    // than 500ing a member out of ever having a scheduling page.
    let inserted: SchedulingPage | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const slug =
        attempt === 0
          ? await uniqueSlug(client, desired)
          : `${normalizeSlug(desired) || "member"}-${generateManageToken().slice(0, 6)}`;
      const insert = await table(client, "scheduling_pages")
        .insert({
          user_id: ctx.userId,
          organization_id: ctx.orgId,
          slug,
          display_name: display,
          timezone: isValidTimezone(ctx.timezone) ? ctx.timezone!.trim() : "UTC",
          availability: DEFAULT_AVAILABILITY as unknown as Json,
        } as never)
        .select(PAGE_COLUMNS)
        .single();
      if (!insert.error) {
        inserted = insert.data as SchedulingPage;
        break;
      }
      lastError = insert.error.message;
      // 23505 on this table is either the slug clashing (retry with a random
      // suffix) or user_id clashing because a concurrent request already made
      // this member's page — in which case just read theirs.
      if (insert.error.code !== "23505") throw new Error(insert.error.message);
      const existing = await table(client, "scheduling_pages")
        .select(PAGE_COLUMNS)
        .eq("user_id", ctx.userId)
        .maybeSingle();
      if (existing.data) {
        inserted = existing.data as SchedulingPage;
        break;
      }
    }
    if (!inserted) throw new Error(lastError || "Could not create a scheduling page.");
    page = inserted;

    // Starter event types, so a brand-new link is immediately bookable.
    const seed = DEFAULT_EVENT_TYPES.map((t, index) => ({
      page_id: page!.id,
      user_id: ctx.userId,
      organization_id: ctx.orgId,
      slug: t.slug,
      title: t.title,
      description: t.description,
      duration_minutes: t.durationMinutes,
      sort_order: index,
    }));
    const seeded = await table(client, "scheduling_event_types").insert(seed as never);
    if (seeded.error) throw new Error(seeded.error.message);
  }

  const eventTypes = await listEventTypes(client, page.id);
  return { page, eventTypes };
}

export async function listEventTypes(client: SchedulingClient, pageId: string): Promise<SchedulingEventType[]> {
  const { data, error } = await table(client, "scheduling_event_types")
    .select(EVENT_TYPE_COLUMNS)
    .eq("page_id", pageId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SchedulingEventType[];
}

/**
 * A client that can see every scheduling page, for handle-uniqueness checks.
 *
 * `slug` is UNIQUE across the whole table, but the RLS policy is
 * `user_id = auth.uid()` — so a request-scoped client cannot see anyone else's
 * page and would report every handle as free, right up until the INSERT raises
 * a unique violation. Probing needs the service role. It returns nothing but
 * "taken or not" about a handle that is public by construction.
 *
 * Where the service role isn't configured (local dev), this falls back to the
 * caller's client; `slugTaken` callers still handle the unique violation, so
 * the outcome is a clear error rather than a wrong answer.
 */
function slugProbeClient(fallback: SchedulingClient): SchedulingClient {
  return hasSupabaseServiceEnv() ? createServiceClient() : fallback;
}

/** Whether a handle already belongs to a page other than `excludePageId`. */
export async function slugTaken(
  client: SchedulingClient,
  slug: string,
  excludePageId?: string | null,
): Promise<boolean> {
  const { data } = await table(slugProbeClient(client), "scheduling_pages")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const row = data as { id: string } | null;
  return !!row && row.id !== excludePageId;
}

/**
 * A free handle derived from `desired`, suffixed (-2, -3, …) until it doesn't
 * collide with an existing page or a reserved word.
 */
export async function uniqueSlug(client: SchedulingClient, desired: string, excludePageId?: string): Promise<string> {
  const base = normalizeSlug(desired) || "member";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (isReservedSlug(candidate)) continue;
    if (!(await slugTaken(client, candidate, excludePageId))) return candidate;
  }
  // 50 collisions on one handle is implausible; fall back to something unique.
  return `${base}-${generateManageToken().slice(0, 6)}`;
}

/** The public page for a handle, with only its active event types. */
export async function resolvePublicPage(
  client: SchedulingClient,
  slug: string,
): Promise<PageWithEventTypes | null> {
  const { data, error } = await table(client, "scheduling_pages")
    .select(PAGE_COLUMNS)
    .eq("slug", slug.trim().toLowerCase())
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const page = data as SchedulingPage | null;
  if (!page) return null;

  const eventTypes = (await listEventTypes(client, page.id)).filter((t) => t.is_active);
  return { page, eventTypes };
}

/**
 * Everything blocking the host in a window: their real meetings, plus slots
 * held by bookings that are confirmed or still awaiting their approval. A
 * pending request holds its slot — otherwise two people could request the same
 * time and only one could ever be accepted.
 */
export async function busyIntervals(
  client: SchedulingClient,
  opts: { hostUserId: string; fromIso: string; toIso: string; excludeBookingId?: string | null },
): Promise<BusyInterval[]> {
  // Anything that *overlaps* the window can start before it. Meetings are capped
  // at MAX_MEETING_MINUTES, so looking back that far is sufficient and keeps the
  // scan bounded instead of reading the host's whole history.
  const lookback = new Date(new Date(opts.fromIso).getTime() - MAX_MEETING_MINUTES * 60_000).toISOString();

  const [meetings, bookings, blocks] = await Promise.all([
    table(client, "live_meetings")
      .select("scheduled_at, duration_minutes")
      .eq("host_id", opts.hostUserId)
      .is("deleted_at", null)
      .eq("is_draft", false)
      .neq("status", "ended")
      .gte("scheduled_at", lookback)
      .lt("scheduled_at", opts.toIso)
      .order("scheduled_at", { ascending: true })
      .limit(BUSY_ROW_CAP),
    table(client, "scheduling_bookings")
      .select("id, starts_at, ends_at")
      .eq("host_user_id", opts.hostUserId)
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", lookback)
      .lt("starts_at", opts.toIso)
      .order("starts_at", { ascending: true })
      .limit(BUSY_ROW_CAP),
    // Time the host marked unavailable by hand. Same lookback as the others:
    // a block can start before the window and run into it.
    table(client, "scheduling_blocks")
      .select("starts_at, ends_at")
      .eq("user_id", opts.hostUserId)
      .gte("starts_at", lookback)
      .lt("starts_at", opts.toIso)
      .order("starts_at", { ascending: true })
      .limit(BUSY_ROW_CAP),
  ]);

  // Truncation here would silently stop blocking real commitments, so it is
  // loud rather than invisible. Hitting this means a host has more than
  // BUSY_ROW_CAP items in one window and the cap needs raising or the busy
  // lookup needs paging.
  for (const [label, res] of [
    ["live_meetings", meetings],
    ["scheduling_bookings", bookings],
    ["scheduling_blocks", blocks],
  ] as const) {
    if ((res.data?.length ?? 0) >= BUSY_ROW_CAP) {
      console.warn(
        `[scheduling] busyIntervals hit the ${BUSY_ROW_CAP}-row cap on ${label} for host ${opts.hostUserId}; ` +
          "some commitments may not be blocking slots.",
      );
    }
  }

  const out: BusyInterval[] = [];

  for (const row of (meetings.data ?? []) as Array<{ scheduled_at: string | null; duration_minutes: number | null }>) {
    if (!row.scheduled_at) continue;
    const start = new Date(row.scheduled_at);
    if (isNaN(start.getTime())) continue;
    out.push({
      start: start.toISOString(),
      end: new Date(start.getTime() + (row.duration_minutes ?? 60) * 60_000).toISOString(),
    });
  }

  for (const row of (bookings.data ?? []) as Array<{ id: string; starts_at: string; ends_at: string }>) {
    // When rescheduling, the booking's own slot must not block its new time.
    if (opts.excludeBookingId && row.id === opts.excludeBookingId) continue;
    out.push({ start: row.starts_at, end: row.ends_at });
  }

  out.push(
    ...blocksToBusyIntervals(
      (blocks.data ?? []) as Array<{ starts_at: string; ends_at: string }>,
    ),
  );

  // Time already taken in a subscribed external calendar (Google, Outlook,
  // Apple, Calendly). Served from each feed's cache — never fetched here,
  // because this runs inside a public slot lookup and must not wait on a third
  // party. externalBusyForUser resolves to an empty list rather than throwing,
  // so a feed problem narrows availability accuracy without failing the page.
  out.push(...(await externalBusyForUser(client as never, opts.hostUserId)));

  return out;
}

export interface OpenSlotsResult {
  slots: SlotWindow[];
  fromDate: string;
  toDate: string;
  timezone: string;
}

/**
 * Open slots for one event type over a date range, clamped to the page's
 * booking window.
 */
export async function openSlots(
  client: SchedulingClient,
  page: SchedulingPage,
  eventType: SchedulingEventType,
  opts: { now?: Date; fromDate?: string | null; toDate?: string | null; excludeBookingId?: string | null } = {},
): Promise<OpenSlotsResult> {
  const now = opts.now ?? new Date();
  const availability = parseAvailability(page.availability);
  const { fromDate, toDate } = bookingWindowRange({
    now,
    timezone: page.timezone,
    bookingWindowDays: page.booking_window_days,
    fromDate: opts.fromDate,
    toDate: opts.toDate,
  });

  if (availability.length === 0) {
    return { slots: [], fromDate, toDate, timezone: page.timezone };
  }

  // fromDate/toDate are host-*local* calendar dates, so the instants they cover
  // can sit up to a zone offset (±14h) either side of the same dates read as
  // UTC. Widening the busy lookup by two days each way keeps a meeting near the
  // range edge blocking its slots for hosts well east or west of UTC.
  const busy = await busyIntervals(client, {
    hostUserId: page.user_id,
    fromIso: new Date(new Date(`${fromDate}T00:00:00.000Z`).getTime() - 48 * 3600_000).toISOString(),
    toIso: new Date(new Date(`${toDate}T00:00:00.000Z`).getTime() + 48 * 3600_000).toISOString(),
    excludeBookingId: opts.excludeBookingId,
  });

  const slots = generateSlots({
    timezone: page.timezone,
    availability,
    durationMinutes: eventType.duration_minutes,
    slotIntervalMinutes: eventType.slot_interval_minutes,
    bufferMinutes: page.buffer_minutes,
    minNoticeMinutes: page.min_notice_minutes,
    busy,
    fromDate,
    toDate,
    now,
  });

  return { slots, fromDate, toDate, timezone: page.timezone };
}

/**
 * Re-check one instant against the host's live rules. This is the gate every
 * write goes through: the public page's slot list is only a suggestion, and by
 * the time a request lands the slot may already be gone.
 */
async function assertSlotOpen(
  client: SchedulingClient,
  page: SchedulingPage,
  eventType: SchedulingEventType,
  startIso: string,
  opts: { now?: Date; excludeBookingId?: string | null } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const availability = parseAvailability(page.availability);
  if (availability.length === 0) throw new SlotUnavailableError("This host has no available hours.");

  const start = new Date(startIso);
  if (isNaN(start.getTime())) throw new SlotUnavailableError("That time isn't valid.");

  // The window's last host-local day can end after the same date read as UTC
  // (a host at UTC-11 is still on `toDate` well into the next UTC day), so the
  // ceiling gets a day of slack. Without it this would reject times the public
  // page had just offered.
  const { toDate } = bookingWindowRange({ now, timezone: page.timezone, bookingWindowDays: page.booking_window_days });
  if (start.getTime() > new Date(`${addCalendarDays(toDate, 1)}T23:59:59.999Z`).getTime()) {
    throw new SlotUnavailableError("That time is beyond how far ahead this link accepts bookings.");
  }

  const busy = await busyIntervals(client, {
    hostUserId: page.user_id,
    fromIso: new Date(start.getTime() - 24 * 3600_000).toISOString(),
    toIso: new Date(start.getTime() + 24 * 3600_000).toISOString(),
    excludeBookingId: opts.excludeBookingId,
  });

  const open = isSlotAvailable(startIso, {
    timezone: page.timezone,
    availability,
    durationMinutes: eventType.duration_minutes,
    slotIntervalMinutes: eventType.slot_interval_minutes,
    bufferMinutes: page.buffer_minutes,
    minNoticeMinutes: page.min_notice_minutes,
    busy,
    now,
  });
  if (!open) throw new SlotUnavailableError("That time is no longer available. Please pick another.");
}

/** Raised when a requested time isn't (or is no longer) bookable — maps to 409. */
export class SlotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlotUnavailableError";
  }
}

/**
 * Postgres exclusion-constraint violation. The database rejected a booking that
 * overlaps one the host already holds — the race the pre-flight slot check
 * cannot close on its own (see migration 20260724120000). To the invitee this
 * is the same outcome as a slot that filled a moment earlier.
 */
const EXCLUSION_VIOLATION = "23P01";

function isOverlapViolation(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === EXCLUSION_VIOLATION;
}

const SLOT_TAKEN_MESSAGE = "That time was just taken. Please pick another.";

/**
 * Create the meeting room a confirmed booking gets. Written directly rather
 * than through `saveScheduledMeeting` because the invitee is anonymous: there
 * is no acting org member to attribute an audit entry to, and the host — not
 * the booker — owns the resulting room.
 */
export async function createMeetingForBooking(
  client: SchedulingClient,
  args: {
    page: SchedulingPage;
    eventType: SchedulingEventType;
    booking: Pick<SchedulingBooking, "invitee_name" | "invitee_email" | "invitee_notes" | "starts_at">;
  },
): Promise<{ id: string; roomCode: string }> {
  const { page, eventType, booking } = args;
  const title = `${eventType.title} — ${booking.invitee_name}`;
  const description = booking.invitee_notes?.trim()
    ? `Booked via scheduling link.\n\nNote from ${booking.invitee_name}: ${booking.invitee_notes.trim()}`
    : "Booked via scheduling link.";

  const { data, error } = await table(client, "live_meetings")
    .insert({
      room_code: generateRoomCode(),
      title,
      host_id: page.user_id,
      organization_id: page.organization_id,
      status: "waiting",
      description,
      attendees: [
        { name: booking.invitee_name, email: booking.invitee_email, type: "external" },
      ] as unknown as Json,
      source: "fundexecs",
      sync_status: "local_only",
      priority: "normal",
      tags: ["scheduling-link"],
      scheduled_at: booking.starts_at,
      duration_minutes: eventType.duration_minutes,
      timezone: page.timezone,
      meeting_type: eventType.meeting_type,
      preparation_status: "prep_needed",
      followup_status: "not_started",
      is_draft: false,
      locked_at: new Date().toISOString(),
    } as never)
    .select("id, room_code")
    .single();

  if (error) throw new Error(error.message);
  const row = data as unknown as { id: string; room_code: string };
  return { id: row.id, roomCode: row.room_code };
}

export interface BookingResult {
  booking: SchedulingBooking;
  roomCode: string | null;
}

/**
 * Claim a slot. Event types marked `requires_approval` land as 'pending' and
 * create no meeting until the host accepts; everything else is confirmed on the
 * spot with a room ready to join.
 */
export async function createBooking(
  client: SchedulingClient,
  args: {
    page: SchedulingPage;
    eventType: SchedulingEventType;
    startIso: string;
    inviteeName: string;
    inviteeEmail: string;
    inviteeNotes?: string | null;
    inviteeTimezone?: string | null;
    now?: Date;
  },
): Promise<BookingResult> {
  const { page, eventType } = args;
  await assertSlotOpen(client, page, eventType, args.startIso, { now: args.now });

  const start = new Date(args.startIso);
  const endIso = new Date(start.getTime() + eventType.duration_minutes * 60_000).toISOString();
  const pending = eventType.requires_approval;

  // Normalize once, so the meeting's attendee record and the booking row can
  // never disagree about who booked — the attendee email is what later invite
  // and follow-up sends key off.
  const invitee = {
    invitee_name: args.inviteeName.trim(),
    invitee_email: args.inviteeEmail.trim().toLowerCase(),
    invitee_notes: args.inviteeNotes?.trim() || null,
  };

  let meeting: { id: string; roomCode: string } | null = null;
  if (!pending) {
    meeting = await createMeetingForBooking(client, {
      page,
      eventType,
      booking: { ...invitee, starts_at: start.toISOString() },
    });
  }

  const { data, error } = await table(client, "scheduling_bookings")
    .insert({
      page_id: page.id,
      event_type_id: eventType.id,
      host_user_id: page.user_id,
      organization_id: page.organization_id,
      meeting_id: meeting?.id ?? null,
      ...invitee,
      invitee_timezone: args.inviteeTimezone?.trim() || page.timezone,
      starts_at: start.toISOString(),
      ends_at: endIso,
      status: pending ? "pending" : "confirmed",
      manage_token: generateManageToken(),
    } as never)
    .select(BOOKING_COLUMNS)
    .single();

  if (error) {
    // The booking row is the record of truth; a room without one would be an
    // orphan on the host's calendar.
    if (meeting) await table(client, "live_meetings").delete().eq("id", meeting.id);
    if (isOverlapViolation(error)) throw new SlotUnavailableError(SLOT_TAKEN_MESSAGE);
    throw new Error(error.message);
  }

  return { booking: data as unknown as SchedulingBooking, roomCode: meeting?.roomCode ?? null };
}

export interface BookingContext {
  booking: SchedulingBooking;
  page: SchedulingPage;
  eventType: SchedulingEventType;
  roomCode: string | null;
}

/** Resolve a booking from the invitee's manage token, with everything it needs. */
export async function loadBookingByToken(
  client: SchedulingClient,
  token: string,
): Promise<BookingContext | null> {
  const { data, error } = await table(client, "scheduling_bookings")
    .select(BOOKING_COLUMNS)
    .eq("manage_token", token.trim())
    .maybeSingle();
  if (error) throw new Error(error.message);
  const booking = data as SchedulingBooking | null;
  if (!booking) return null;
  return withBookingRelations(client, booking);
}

/** Same, addressed by id — the host's approve / decline / cancel path. */
export async function loadBookingById(
  client: SchedulingClient,
  bookingId: string,
): Promise<BookingContext | null> {
  const { data, error } = await table(client, "scheduling_bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const booking = data as SchedulingBooking | null;
  if (!booking) return null;
  return withBookingRelations(client, booking);
}

/**
 * Same, addressed by the meeting room it created — the path a host takes when
 * they edit a link-booked meeting from their own calendar rather than from the
 * booking card. Only a live booking is returned: a cancelled or declined one
 * left its meeting behind and has nothing left to keep in step.
 */
export async function loadLiveBookingByMeetingId(
  client: SchedulingClient,
  meetingId: string,
): Promise<BookingContext | null> {
  const { data, error } = await table(client, "scheduling_bookings")
    .select(BOOKING_COLUMNS)
    .eq("meeting_id", meetingId)
    .in("status", ["pending", "confirmed"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  const booking = data as SchedulingBooking | null;
  if (!booking) return null;
  return withBookingRelations(client, booking);
}

async function withBookingRelations(
  client: SchedulingClient,
  booking: SchedulingBooking,
): Promise<BookingContext | null> {
  const [pageRes, typeRes] = await Promise.all([
    table(client, "scheduling_pages").select(PAGE_COLUMNS).eq("id", booking.page_id).maybeSingle(),
    table(client, "scheduling_event_types").select(EVENT_TYPE_COLUMNS).eq("id", booking.event_type_id).maybeSingle(),
  ]);
  const page = pageRes.data as SchedulingPage | null;
  const eventType = typeRes.data as SchedulingEventType | null;
  if (!page || !eventType) return null;

  let roomCode: string | null = null;
  if (booking.meeting_id) {
    const { data } = await table(client, "live_meetings").select("room_code").eq("id", booking.meeting_id).maybeSingle();
    roomCode = (data as { room_code: string } | null)?.room_code ?? null;
  }

  return { booking, page, eventType, roomCode };
}

/** Approve a pending request: create the room and confirm the booking. */
export async function approveBooking(client: SchedulingClient, ctx: BookingContext): Promise<BookingContext> {
  if (ctx.booking.status !== "pending") throw new Error("Only a pending request can be approved.");

  // The host may have booked over the slot while the request sat in the queue.
  await assertSlotOpen(client, ctx.page, ctx.eventType, ctx.booking.starts_at, { excludeBookingId: ctx.booking.id });

  const meeting = await createMeetingForBooking(client, {
    page: ctx.page,
    eventType: ctx.eventType,
    booking: ctx.booking,
  });

  // Same cleanup contract as createBooking: if the booking can't be confirmed,
  // the room must not survive. Left behind it would sit on the host's calendar
  // attached to nothing, block the slot a second time, and be duplicated by the
  // next approve attempt.
  let updated: SchedulingBooking;
  try {
    updated = await updateBookingRow(client, ctx.booking.id, {
      status: "confirmed",
      meeting_id: meeting.id,
      decided_at: new Date().toISOString(),
    });
  } catch (err) {
    await table(client, "live_meetings").delete().eq("id", meeting.id);
    throw err;
  }

  return { ...ctx, booking: updated, roomCode: meeting.roomCode };
}

/** Decline a pending request. No room was ever created, so nothing to clean up. */
export async function declineBooking(
  client: SchedulingClient,
  ctx: BookingContext,
  reason?: string | null,
): Promise<BookingContext> {
  if (ctx.booking.status !== "pending") throw new Error("Only a pending request can be declined.");
  const updated = await updateBookingRow(client, ctx.booking.id, {
    status: "declined",
    cancellation_reason: reason?.trim() || null,
    decided_at: new Date().toISOString(),
  });
  return { ...ctx, booking: updated };
}

/** Cancel a booking from either side, releasing the slot and the room. */
export async function cancelBooking(
  client: SchedulingClient,
  ctx: BookingContext,
  by: "host" | "invitee",
  reason?: string | null,
): Promise<BookingContext> {
  if (ctx.booking.status === "cancelled" || ctx.booking.status === "declined") return ctx;

  if (ctx.booking.meeting_id) {
    // Soft-delete, matching how the app removes meetings elsewhere — the room's
    // history stays, it just leaves the calendar.
    await table(client, "live_meetings")
      .update({ deleted_at: new Date().toISOString(), status: "ended" } as never)
      .eq("id", ctx.booking.meeting_id);
  }

  const updated = await updateBookingRow(client, ctx.booking.id, {
    status: "cancelled",
    cancelled_by: by,
    cancellation_reason: reason?.trim() || null,
    decided_at: new Date().toISOString(),
  });
  return { ...ctx, booking: updated };
}

/**
 * Move a booking to a new slot, keeping its identity (and the invitee's manage
 * link) intact. A confirmed booking's room moves with it; a pending request
 * stays pending.
 *
 * `enforceAvailability` distinguishes the two callers. An invitee picking a new
 * time may only land on a slot the link actually offers, so it defaults on.
 * A host editing the meeting in their own calendar has already chosen the time
 * deliberately — holding them to their own published office hours would block
 * legitimate moves — so that path turns it off. The database's overlap
 * constraint still forbids double-booking either way.
 */
export async function rescheduleBooking(
  client: SchedulingClient,
  ctx: BookingContext,
  startIso: string,
  opts: { now?: Date; durationMinutes?: number; enforceAvailability?: boolean } = {},
): Promise<BookingContext> {
  if (ctx.booking.status !== "confirmed" && ctx.booking.status !== "pending") {
    throw new Error("This booking can no longer be changed.");
  }
  if (opts.enforceAvailability !== false) {
    await assertSlotOpen(client, ctx.page, ctx.eventType, startIso, {
      now: opts.now,
      excludeBookingId: ctx.booking.id,
    });
  }

  const start = new Date(startIso);
  const duration = opts.durationMinutes ?? ctx.eventType.duration_minutes;
  const endIso = new Date(start.getTime() + duration * 60_000).toISOString();

  if (ctx.booking.meeting_id) {
    const { error } = await table(client, "live_meetings")
      .update({ scheduled_at: start.toISOString(), updated_at: new Date().toISOString() } as never)
      .eq("id", ctx.booking.meeting_id);
    if (error) throw new Error(error.message);
  }

  const updated = await updateBookingRow(client, ctx.booking.id, {
    starts_at: start.toISOString(),
    ends_at: endIso,
    rescheduled_at: new Date().toISOString(),
  });
  return { ...ctx, booking: updated };
}

async function updateBookingRow(
  client: SchedulingClient,
  bookingId: string,
  patch: Record<string, unknown>,
): Promise<SchedulingBooking> {
  const { data, error } = await table(client, "scheduling_bookings")
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("id", bookingId)
    .select(BOOKING_COLUMNS)
    .single();
  if (error) {
    if (isOverlapViolation(error)) throw new SlotUnavailableError(SLOT_TAKEN_MESSAGE);
    throw new Error(error.message);
  }
  return data as unknown as SchedulingBooking;
}

/** The host's booking list for their Meetings card: pending first, then upcoming. */
export async function listBookingsForHost(
  client: SchedulingClient,
  hostUserId: string,
  opts: { limit?: number } = {},
): Promise<Array<SchedulingBooking & { event_title: string | null }>> {
  const { data, error } = await table(client, "scheduling_bookings")
    .select(BOOKING_COLUMNS)
    .eq("host_user_id", hostUserId)
    .in("status", ["pending", "confirmed"])
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(opts.limit ?? 25);
  if (error) throw new Error(error.message);

  const bookings = (data ?? []) as unknown as SchedulingBooking[];
  if (bookings.length === 0) return [];

  // One lookup for the titles rather than a join, keeping the column list above
  // as the single description of a booking row.
  const typeIds = [...new Set(bookings.map((b) => b.event_type_id))];
  const { data: types } = await table(client, "scheduling_event_types").select("id, title").in("id", typeIds);
  const titles = new Map(((types ?? []) as Array<{ id: string; title: string }>).map((t) => [t.id, t.title]));

  return bookings.map((b) => ({ ...b, event_title: titles.get(b.event_type_id) ?? null }));
}

/** Normalized availability for API responses, so clients never see raw Json. */
export function pageAvailability(page: SchedulingPage): SchedulingAvailabilityRule[] {
  return parseAvailability(page.availability);
}

// ── Serialization ────────────────────────────────────────────────────────────
// API responses are camelCase and deliberately narrower than the rows. The
// public shapes in particular expose only what a booking page renders: an
// anonymous visitor never learns the host's user id, org, or internal flags.

export interface SerializedEventType {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  slotIntervalMinutes: number;
  meetingType: string;
  requiresApproval: boolean;
  isActive: boolean;
  sortOrder: number;
}

export function serializeEventType(eventType: SchedulingEventType): SerializedEventType {
  return {
    id: eventType.id,
    slug: eventType.slug,
    title: eventType.title,
    description: eventType.description,
    durationMinutes: eventType.duration_minutes,
    slotIntervalMinutes: eventType.slot_interval_minutes,
    meetingType: eventType.meeting_type,
    requiresApproval: eventType.requires_approval,
    isActive: eventType.is_active,
    sortOrder: eventType.sort_order,
  };
}

export function serializeHostPage(page: SchedulingPage) {
  return {
    id: page.id,
    slug: page.slug,
    displayName: page.display_name,
    headline: page.headline,
    bio: page.bio,
    timezone: page.timezone,
    availability: pageAvailability(page),
    bufferMinutes: page.buffer_minutes,
    minNoticeMinutes: page.min_notice_minutes,
    bookingWindowDays: page.booking_window_days,
    isActive: page.is_active,
  };
}

/** What an anonymous visitor is allowed to see about the host. */
export function serializePublicPage(page: SchedulingPage) {
  return {
    slug: page.slug,
    displayName: page.display_name,
    headline: page.headline,
    bio: page.bio,
    timezone: page.timezone,
  };
}

export function serializeBooking(booking: SchedulingBooking & { event_title?: string | null }) {
  return {
    id: booking.id,
    eventTypeId: booking.event_type_id,
    eventTitle: booking.event_title ?? null,
    inviteeName: booking.invitee_name,
    inviteeEmail: booking.invitee_email,
    inviteeNotes: booking.invitee_notes,
    inviteeTimezone: booking.invitee_timezone,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    status: booking.status,
    cancelledBy: booking.cancelled_by,
    cancellationReason: booking.cancellation_reason,
    meetingId: booking.meeting_id,
    createdAt: booking.created_at,
  };
}
