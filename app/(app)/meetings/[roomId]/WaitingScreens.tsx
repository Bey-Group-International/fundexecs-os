"use client";

// The screens a joiner sees when they are not in the meeting: turned away, and
// shown out at the end. Knocking is no longer among them — the pre-join screen
// holds the wait itself now (see lib/meetings/admission-ui.ts), so a guest never
// changes screens between asking and being let in.
//
// They live here rather than inline in MeetingRoom for the reason the waiting
// room keeps earning — this is the part of the product where somebody is stuck
// on the other side of a door, and every bug in it is invisible to the person
// who could fix it. Pulled out, each screen is a plain function of its props and
// can be rendered and pressed in a test; inline, they were reachable only by
// standing up a WebRTC stack and could only be checked by reading.
//
// They are deliberately dumb: no fetching, no timers, no navigation of their
// own. Every decision stays in MeetingRoom, which is where the state that drives
// them lives.

/** A waiting person as the host's bar shows them. `id` is the admissions row id. */
export interface WaitingPeer {
  id: string;
  from: string;
  displayName: string;
}

/**
 * The host's waiting room, where the host can actually see it.
 *
 * Admissions used to live only in the Copilot sidebar's People tab. That tab is
 * not the default one, and the sidebar closes entirely — so a host could sit in
 * a meeting with no indication at all that someone was knocking, and the guest
 * waited until they gave up. A waiting room nobody notices is the same as no
 * waiting room, except the guest is stuck outside.
 *
 * So this sits above the control bar, in the main column, for as long as
 * anybody is waiting: visible whatever tab is open and whether or not the
 * sidebar is. Admit and Deny are here rather than behind a "review" link,
 * because letting someone in is one decision and should cost one click.
 */
export function WaitingRoomBar({
  waitingPeers, onAdmit, onDeny, onAdmitAll,
}: {
  waitingPeers: WaitingPeer[];
  onAdmit: (id: string) => void;
  onDeny: (id: string) => void;
  onAdmitAll: () => void;
}) {
  const count = waitingPeers.length;
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label={`${count} ${count === 1 ? "person" : "people"} waiting to join`}
      className="shrink-0 border-t border-gold-400/40 bg-gold-400/10 px-3 sm:px-6 py-2"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--gold-400)] uppercase tracking-wide">
          <span className="w-2 h-2 rounded-full bg-[var(--gold-400)] animate-pulse" />
          {count === 1 ? "Waiting to join" : `${count} waiting to join`}
        </span>

        {/* Each waiting person, admittable without opening anything. The list
            scrolls rather than growing the bar, so a rush of guests can never
            push the meeting controls off screen. */}
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
          {waitingPeers.map((wp) => (
            <div
              key={wp.id}
              className="flex items-center gap-1.5 shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface-1)] pl-3 pr-1.5 py-1"
            >
              <span className="text-sm text-[var(--fg-primary)] truncate max-w-[10rem]">{wp.displayName}</span>
              <button
                onClick={() => onAdmit(wp.id)}
                title={`Admit ${wp.displayName}`}
                aria-label={`Admit ${wp.displayName}`}
                className="rounded-full bg-[var(--status-success)] px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Admit
              </button>
              <button
                onClick={() => onDeny(wp.id)}
                title={`Deny ${wp.displayName}`}
                aria-label={`Deny ${wp.displayName}`}
                className="rounded-full border border-[var(--line)] px-2 py-1 text-xs font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--status-danger)]"
              >
                Deny
              </button>
            </div>
          ))}
        </div>

        {count > 1 && (
          <button
            onClick={onAdmitAll}
            className="shrink-0 rounded-full bg-[var(--status-success)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            Admit all
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The host said no.
 *
 * Its own screen because the old answer to a deny was to push the joiner at
 * /meetings, which lives behind the app's auth wall — so an invite-link guest
 * was answered with a login page. Being turned away and being asked to sign in
 * are not the same message, and only one of them is true. The way back is the
 * invitation, which is public; a guest has nowhere else to be sent.
 */
export function NotAdmittedScreen({
  meetingTitle, roomCode, onLeave,
}: {
  meetingTitle: string;
  roomCode: string;
  onLeave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        <div className="w-14 h-14 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-2xl">🚪</div>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-[var(--fg-primary)]">You weren&apos;t admitted</h2>
          <p className="text-sm text-[var(--fg-secondary)]">
            The host didn&apos;t let you into {meetingTitle}. If this was a mistake, ask them to send you back in.
          </p>
        </div>
        <div className="w-full flex flex-col gap-3">
          <a
            href={`/meeting-invite/${roomCode}`}
            className="w-full rounded-lg border border-[var(--line)] text-[var(--fg-secondary)] text-sm py-2.5 text-center hover:bg-[var(--surface-2)] transition-colors"
          >
            Back to the invitation
          </a>
          <button
            onClick={onLeave}
            className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A guest on their way out.
 *
 * Also the landing place when the host ends the meeting or removes them, for the
 * same reason as above: everywhere else this could send a guest is signed-in.
 */
export function GuestThanksScreen({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface-0)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm flex flex-col gap-6 text-center">
        <div className="flex flex-col gap-2">
          <span className="text-3xl">✦</span>
          <h2 className="text-xl font-semibold text-[var(--fg-primary)]">Thanks for joining!</h2>
          <p className="text-sm text-[var(--fg-secondary)]">
            Create an account to get AI-generated meeting notes, transcripts, and action items — automatically.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href="/login?mode=signup"
            className="w-full rounded-lg bg-[var(--gold-400)] text-white text-sm font-semibold py-2.5 text-center hover:opacity-90 transition-opacity"
          >
            Get started →
          </a>
          <a
            href="/login"
            className="w-full rounded-lg border border-[var(--line)] text-[var(--fg-secondary)] text-sm py-2.5 text-center hover:bg-[var(--surface-2)] transition-colors"
          >
            I already have an account
          </a>
          <button
            onClick={onLeave}
            className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
          >
            No thanks, leave
          </button>
        </div>
      </div>
    </div>
  );
}
