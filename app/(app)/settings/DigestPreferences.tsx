"use client";

// app/(app)/settings/DigestPreferences.tsx
// The "Digest preferences" panel for Settings. It reflects the per-org,
// per-channel delivery settings for the Act-now Radar digest + weekly funnel
// rollup (radar_digest_prefs, migration 0062): which of the three channels —
// the in-app Unified Inbox, Slack, and email — are on, where each lands, how
// often, and at what priority bar. Each row saves through the upsertDigestPref
// server action (writer-write RLS is the real gate); we reflect the returned
// row and surface any error inline.
import { useState, useTransition } from "react";
import type { RadarDigestPref } from "@/lib/supabase/database.types";
import {
  DIGEST_CHANNELS,
  recipientRequired,
  type DigestChannel,
} from "@/lib/digest-prefs";
import { upsertDigestPref } from "./digest-actions";

const CHANNEL_META: Record<
  DigestChannel,
  { label: string; blurb: string; recipientLabel: string; placeholder: string }
> = {
  in_app: {
    label: "In-app inbox",
    blurb: "Lands in your Unified Inbox as a recurring brief. No destination to set — it's your own inbox.",
    recipientLabel: "",
    placeholder: "",
  },
  slack: {
    label: "Slack",
    blurb: "Posts the digest to a Slack channel for the whole team to see.",
    recipientLabel: "Slack channel id",
    placeholder: "C0123456789",
  },
  email: {
    label: "Email",
    blurb: "Sends the digest to an inbox on your cadence.",
    recipientLabel: "Email address",
    placeholder: "team@yourfirm.com",
  },
};

// The form state we track per channel — a normalized view of the row, with
// table defaults applied for channels that have no row yet.
type ChannelDraft = {
  enabled: boolean;
  recipient: string;
  cadence: string;
  min_score: number;
};

function draftFrom(pref: RadarDigestPref | undefined): ChannelDraft {
  return {
    enabled: pref?.enabled ?? true,
    recipient: pref?.recipient ?? "",
    cadence: pref?.cadence ?? "daily",
    min_score: pref?.min_score ?? 60,
  };
}

export function DigestPreferences({ prefs }: { prefs: RadarDigestPref[] }) {
  // One row per (org, channel) by the table's unique constraint.
  const byChannel = new Map(prefs.map((p) => [p.channel, p]));

  return (
    <div className="flex flex-col gap-2">
      {DIGEST_CHANNELS.map((channel) => (
        <ChannelRow
          key={channel}
          channel={channel}
          initial={draftFrom(byChannel.get(channel))}
        />
      ))}
    </div>
  );
}

function ChannelRow({ channel, initial }: { channel: DigestChannel; initial: ChannelDraft }) {
  const meta = CHANNEL_META[channel];
  const needsRecipient = recipientRequired(channel);

  const [draft, setDraft] = useState<ChannelDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(next: ChannelDraft) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await upsertDigestPref({
        channel,
        recipient: next.recipient,
        cadence: next.cadence,
        min_score: next.min_score,
        enabled: next.enabled,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save");
        return;
      }
      // Reflect the persisted row so the UI never drifts from the DB.
      if (res.pref) {
        setDraft({
          enabled: res.pref.enabled,
          recipient: res.pref.recipient ?? "",
          cadence: res.pref.cadence,
          min_score: res.pref.min_score,
        });
      }
      setSaved(true);
    });
  }

  // Toggle is optimistic-but-safe: reflect locally, then persist; on failure the
  // inline error shows and the next successful save reconciles from the row.
  function toggleEnabled() {
    const next = { ...draft, enabled: !draft.enabled };
    setDraft(next);
    save(next);
  }

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            draft.enabled ? "bg-status-success" : "bg-fg-muted"
          }`}
          aria-label={draft.enabled ? "enabled" : "disabled"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg-primary">{meta.label}</span>
            {draft.enabled ? (
              <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                On · {draft.cadence}
              </span>
            ) : (
              <span className="rounded-full border border-line bg-surface-0 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                Off
              </span>
            )}
          </div>
          <p className="mt-2 text-xs leading-snug text-fg-secondary">{meta.blurb}</p>

          {/* Controls: recipient (slack/email only), cadence, min-score. */}
          <div className="mt-3 flex flex-col gap-3">
            {needsRecipient ? (
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {meta.recipientLabel}
                </span>
                <input
                  type={channel === "email" ? "email" : "text"}
                  value={draft.recipient}
                  placeholder={meta.placeholder}
                  onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
                  className="w-full max-w-xs rounded-lg border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary outline-none transition focus:border-gold-500/40"
                />
              </label>
            ) : null}

            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Cadence
                </span>
                <select
                  value={draft.cadence}
                  onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}
                  className="rounded-lg border border-line bg-surface-0 px-2.5 py-1.5 text-xs text-fg-primary outline-none transition focus:border-gold-500/40"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Min score · {draft.min_score}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draft.min_score}
                  onChange={(e) => setDraft({ ...draft, min_score: Number(e.target.value) })}
                  className="w-40 accent-gold-400"
                />
              </label>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => save(draft)}
              disabled={pending}
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "…" : "Save"}
            </button>
            {error ? (
              <span className="text-xs text-status-danger">{error}</span>
            ) : saved ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-status-success">
                Saved
              </span>
            ) : null}
          </div>
        </div>

        {/* Enable / disable the channel. */}
        <form className="shrink-0">
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={pending}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              draft.enabled
                ? "border-line bg-surface-2 text-fg-secondary hover:bg-surface-3"
                : "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
            }`}
          >
            {draft.enabled ? "Disable" : "Enable"}
          </button>
        </form>
      </div>
    </div>
  );
}
