"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

interface MeetingInfo {
  title: string;
  status: "waiting" | "active" | "ended";
  /** Null for a meeting with no time yet, and for one still in draft. */
  scheduledAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
}

/**
 * The meeting's time, in the reader's own timezone rather than the host's.
 *
 * The invitee is the one person here who may be nowhere near the organizer, and
 * an unlabelled time is the classic way to miss a meeting by several hours — so
 * the zone is always named. Returns "" when there is nothing to show, which is
 * also what hides the calendar button below.
 */
function formatWhen(info: MeetingInfo | null): string {
  if (!info?.scheduledAt) return "";
  const start = new Date(info.scheduledAt);
  if (Number.isNaN(start.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(start);
  } catch {
    return start.toUTCString();
  }
}

/**
 * The page an invite link opens. One job: get the person holding the link into
 * the meeting in one press.
 *
 * It used to be a chooser whose primary button was "Request access", with
 * "Continue as guest" below a divider, then a name form, and only then the
 * room — three screens between a guest and the meeting they were invited to,
 * and the first of them pointed away from it. The room's own pre-join screen
 * already asks for a name, next to the person's camera preview, so nothing here
 * needs to.
 */
export default function MeetingInvitePage() {
  const params = useParams();
  const roomCode = typeof params.roomCode === "string" ? params.roomCode : "";
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchMeeting() {
      // Public lookup by room code so invitees without an account can see the
      // meeting and join. Only the title, status and time are returned —
      // everything else stays RLS-protected.
      try {
        const res = await fetch(`/api/meetings/public/${encodeURIComponent(roomCode)}`, { cache: "no-store" });
        if (!res.ok) setNotFound(true);
        else {
          const info = (await res.json()) as MeetingInfo;
          setMeeting(info);
          // Someone who is already signed in has nothing to choose here. This
          // page's job is to get a stranger in; the link used to send EVERYONE
          // to the guest door, so a member pressing their own invite joined as
          // a guest — no documents, the sign-up upsell, and the host unable to
          // tell them from a stranger. Straight to the member room instead,
          // with no press at all. The session is read locally, as a hint only:
          // the room checks it for real.
          if (info.status !== "ended") {
            try {
              const { data } = await createClient().auth.getSession();
              if (data.session) {
                router.replace(`/meetings/${encodeURIComponent(roomCode)}`);
                return;
              }
            } catch { /* no readable session: they are a guest, which is the page below */ }
          }
        }
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    }
    if (roomCode) void fetchMeeting();
  }, [roomCode, router]);

  // A real link rather than a button that navigates on click: it works before
  // the page's script has run, it works in a mail client's in-app browser, and
  // it is what "join with one click" has to mean for somebody holding a link.
  //
  // `next`, not `redirect`: it is the parameter the login page, the sign-in
  // actions and /auth/callback all read (lib/safe-next-path.ts).
  const joinHref = `/meeting-room/${encodeURIComponent(roomCode)}?guest=1`;
  const signInHref = `/login?next=${encodeURIComponent(`/meetings/${roomCode}`)}`;

  if (loading) {
    return (
      <div className="fx-blueprint flex min-h-screen items-center justify-center bg-surface-0">
        <div className="w-5 h-5 border-2 border-[var(--gold-400)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const when = formatWhen(meeting);

  if (notFound) {
    return (
      <div className="fx-blueprint flex min-h-screen flex-col items-center justify-center bg-surface-0 gap-4 px-4">
        <Logo />
        <p className="text-[var(--fg-secondary)] text-sm">This meeting link is invalid or has expired.</p>
        <a href="/login" className="text-[var(--gold-400)] text-sm hover:underline">Sign in to FundExecs OS →</a>
      </div>
    );
  }

  const ended = meeting?.status === "ended";

  return (
    <div className="fx-blueprint flex min-h-screen flex-col items-center justify-center bg-surface-0 px-4 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <Logo />
          <div className="text-center">
            <p className="text-xs font-mono uppercase tracking-widest text-[var(--fg-muted)] mb-1">You&apos;re invited to</p>
            <h1 className="text-xl font-semibold text-[var(--fg-primary)]">{meeting?.title ?? "Meeting"}</h1>
            {meeting?.status === "active" && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Live now
              </span>
            )}
            {meeting?.status === "waiting" && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-yellow-400">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> Starting soon
              </span>
            )}
            {ended && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-[var(--fg-muted)]">Meeting has ended</span>
            )}
            {when && (
              <p className="mt-2 text-sm text-[var(--fg-secondary)]">{when}</p>
            )}
          </div>
        </div>

        {!ended && (
          <div className="fx-glass rounded-xl p-5 flex flex-col gap-3">
            <a
              href={joinHref}
              className="flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--gold-400)] text-white text-sm font-semibold py-2.5 hover:opacity-90 transition-opacity"
            >
              Join meeting
            </a>
            <p className="text-[11px] text-[var(--fg-muted)] text-center leading-relaxed">
              No account needed. You&apos;ll add your name and check your camera on the next screen.
            </p>

            {/* Only for a meeting that has a time: the .ics endpoint 404s
                otherwise, and a button leading to a dead download is worse
                than no button. */}
            {when && (
              <a
                href={`/api/meetings/public/${encodeURIComponent(roomCode)}/calendar.ics`}
                className="self-center text-sm text-[var(--gold-400)] hover:underline"
              >
                Save to calendar
              </a>
            )}

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--line)]" />
              <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--fg-muted)]">or</span>
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>

            <a
              href={signInHref}
              className="flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--fg-primary)] text-sm font-medium py-2.5 hover:bg-[var(--surface-3)] transition-colors"
            >
              Already have an account? Sign in
            </a>
            <p className="text-[11px] text-[var(--fg-muted)] text-center leading-relaxed">
              Want AI transcription, notes and action items for your own meetings?{" "}
              <a href="/request-access" className="text-[var(--gold-400)] hover:underline">Request access</a>.
            </p>
          </div>
        )}

        {ended && (
          <div className="fx-glass rounded-xl p-5 flex flex-col gap-3 items-center text-center">
            <p className="text-sm text-[var(--fg-muted)]">This meeting has already ended.</p>
            <a href="/request-access" className="text-[var(--gold-400)] text-sm hover:underline">
              Request FundExecs OS access →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
