"use client";

// The calendar layers rail: which calendars exist, what colour each is, and
// whether it is currently shown.
//
// The point of this panel is that a member can see WHAT a conflict is, not
// merely that they are unavailable. Before it, a subscribed calendar suppressed
// booking slots invisibly.
import { useCallback, useMemo, useState } from "react";
import {
  type CalendarLayer,
  colorForLayer,
  groupLayers,
  layerNeedsAttention,
} from "@/lib/calendar/layers";

interface Props {
  layers: CalendarLayer[];
  connectedAs: string | null;
  googleConfigured: boolean;
  onToggle: (layer: CalendarLayer, isVisible: boolean) => void;
  onToggleAvailability: (layer: CalendarLayer, blocks: boolean) => void;
}

export default function CalendarLayers({
  layers,
  connectedAs,
  googleConfigured,
  onToggle,
  onToggleAvailability,
}: Props) {
  const groups = useMemo(() => groupLayers(layers), [layers]);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <aside className="w-56 shrink-0 space-y-4" aria-label="Calendars">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.layers.map((layer) => (
              <LayerRow
                key={`${layer.source}:${layer.id}`}
                layer={layer}
                isExpanded={expanded === layer.id}
                onExpand={() => setExpanded(expanded === layer.id ? null : layer.id)}
                onToggle={onToggle}
                onToggleAvailability={onToggleAvailability}
              />
            ))}
          </ul>
        </div>
      ))}

      {layers.length === 0 ? (
        <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
          No calendars connected yet. Connecting one shows its events here, stops this
          app offering times you are already busy, and lets meeting email go out
          from your own address.
        </p>
      ) : null}

      {googleConfigured ? (
        <a
          href="/api/oauth/google/calendar/start"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--fg-secondary)] transition hover:border-[var(--gold-400)]/50 hover:text-[var(--gold-400)]"
        >
          {connectedAs ? "Reconnect Google" : "Connect Google"}
        </a>
      ) : null}

      {/* The grant covers sending as well as the calendar, so the button cannot
          be labelled for the calendar alone — a member should know what they
          are authorizing before the consent screen, not after.

          The second line matters because meeting email already works without
          this: the organization's Google integration can send. Connecting here
          changes whose address guests see, not whether email goes out. */}
      {googleConfigured ? (
        <p className="text-[11px] leading-relaxed text-[var(--fg-muted)]">
          Grants calendar access and permission to send meeting email as you.
          Without it, meeting email sends from your organization&rsquo;s connected
          Google account instead of your address.
        </p>
      ) : null}

      {connectedAs ? (
        <p className="text-[11px] text-[var(--fg-muted)]">Connected as {connectedAs}</p>
      ) : null}
    </aside>
  );
}

function LayerRow({
  layer,
  isExpanded,
  onExpand,
  onToggle,
  onToggleAvailability,
}: {
  layer: CalendarLayer;
  isExpanded: boolean;
  onExpand: () => void;
  onToggle: Props["onToggle"];
  onToggleAvailability: Props["onToggleAvailability"];
}) {
  const color = colorForLayer(layer);
  const attention = layerNeedsAttention(layer);

  const toggle = useCallback(() => onToggle(layer, !layer.isVisible), [layer, onToggle]);

  return (
    <li>
      <div className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-[var(--surface-2)]/60">
        <input
          type="checkbox"
          checked={layer.isVisible}
          onChange={toggle}
          aria-label={`Show ${layer.name}`}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-sm border"
          // The checkbox carries the calendar's own colour, exactly as it does
          // in the product this is modelled on: the colour is the identity.
          style={{ accentColor: color, borderColor: color }}
        />
        <button
          onClick={onExpand}
          className="min-w-0 flex-1 truncate text-left text-xs text-[var(--fg-secondary)]"
          title={layer.name}
        >
          {layer.name}
        </button>
        {attention ? (
          <span
            className="shrink-0 text-[var(--danger-400)]"
            title={layer.health.message ?? "This calendar is not syncing."}
            aria-label="Not syncing"
          >
            ⚠
          </span>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="ml-6 mb-1 space-y-1.5 rounded-md border border-[var(--line)] bg-[var(--surface-1)] p-2">
          {/* Visibility and availability are separate on purpose: a birthdays
              calendar is worth seeing and worth ignoring when deciding whether
              someone is free. */}
          <label className="flex items-center gap-2 text-[11px] text-[var(--fg-secondary)]">
            <input
              type="checkbox"
              checked={layer.blocksAvailability}
              disabled={layer.source === "ics"}
              onChange={(e) => onToggleAvailability(layer, e.target.checked)}
            />
            Counts as busy
          </label>
          {layer.source === "ics" ? (
            <p className="text-[11px] leading-relaxed text-[var(--fg-muted)]">
              Subscribed feed — read-only, and always counts as busy while it is shown.
            </p>
          ) : !layer.canWrite ? (
            <p className="text-[11px] leading-relaxed text-[var(--fg-muted)]">
              You have read access to this calendar, so meetings booked here stay here.
            </p>
          ) : null}
          {layer.health.message ? (
            <p
              className={`text-[11px] leading-relaxed ${attention ? "text-[var(--danger-400)]" : "text-[var(--fg-muted)]"}`}
            >
              {layer.health.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
