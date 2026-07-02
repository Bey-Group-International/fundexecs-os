"use client";

import { TOKENS } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Color swatch data — CSS var name + dark-theme approximate hex for display
// ---------------------------------------------------------------------------

const COLOR_SWATCHES: { label: string; token: string; hex: string }[] = [
  { label: "--surface-0",      token: "var(--surface-0)",      hex: "#050912" },
  { label: "--surface-1",      token: "var(--surface-1)",      hex: "#0a111f" },
  { label: "--surface-2",      token: "var(--surface-2)",      hex: "#101b2e" },
  { label: "--surface-3",      token: "var(--surface-3)",      hex: "#182842" },
  { label: "--line",           token: "var(--line)",           hex: "#263d5c" },
  { label: "--fg-primary",     token: "var(--fg-primary)",     hex: "#f1f7ff" },
  { label: "--fg-secondary",   token: "var(--fg-secondary)",   hex: "#afbed3" },
  { label: "--fg-muted",       token: "var(--fg-muted)",       hex: "#71849e" },
  { label: "--gold-300",       token: "var(--gold-300)",       hex: "#7dd3fc" },
  { label: "--gold-400",       token: "var(--gold-400)",       hex: "#38bdf8" },
  { label: "--gold-500",       token: "var(--gold-500)",       hex: "#2563eb" },
  { label: "--status-success", token: "var(--status-success)", hex: "#5FB87A" },
  { label: "--status-warning", token: "var(--status-warning)", hex: "#D6A24A" },
  { label: "--status-danger",  token: "var(--status-danger)",  hex: "#D46A5A" },
  { label: "--status-info",    token: "var(--status-info)",    hex: "#5B9BD5" },
];

// ---------------------------------------------------------------------------
// Status badge config matching envelope statuses
// ---------------------------------------------------------------------------

const STATUS_BADGES: { label: string; bg: string; color: string }[] = [
  { label: "Draft",     bg: "rgba(113,132,158,0.15)", color: "var(--fg-muted)" },
  { label: "Sent",      bg: "rgba(91,155,213,0.15)",  color: "var(--status-info)" },
  { label: "Completed", bg: "rgba(95,184,122,0.15)",  color: "var(--status-success)" },
  { label: "Voided",    bg: "rgba(212,106,90,0.15)",  color: "var(--status-danger)" },
];

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        style={{
          color: TOKENS.fg.primary,
          fontWeight: 700,
          fontSize: "1rem",
          marginBottom: "1rem",
          paddingBottom: "0.5rem",
          borderBottom: `1px solid var(--line)`,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main gallery component
// ---------------------------------------------------------------------------

export function ComponentGallery() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "3rem",
        padding: "2rem",
        maxWidth: "960px",
        margin: "0 auto",
      }}
    >
      {/* 1. Color Tokens */}
      <Section title="Color Tokens">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {COLOR_SWATCHES.map((s) => (
            <div
              key={s.label}
              style={{
                borderRadius: "0.5rem",
                overflow: "hidden",
                border: `1px solid var(--line)`,
                background: TOKENS.surface[1],
              }}
            >
              <div
                style={{
                  height: "56px",
                  background: s.token,
                  borderBottom: `1px solid var(--line)`,
                }}
              />
              <div style={{ padding: "0.5rem 0.625rem" }}>
                <p
                  style={{
                    fontSize: "11px",
                    color: TOKENS.fg.primary,
                    fontFamily: "monospace",
                    marginBottom: "2px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.label}
                </p>
                <p
                  style={{
                    fontSize: "10px",
                    color: TOKENS.fg.muted,
                    fontFamily: "monospace",
                  }}
                >
                  {s.hex}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 2. Typography */}
      <Section title="Typography">
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {(
            [
              { label: "fg-primary — 2xl / 700", size: "1.5rem",   weight: 700, color: TOKENS.fg.primary,   sample: "Deal Execution Platform" },
              { label: "fg-primary — xl / 600",  size: "1.25rem",  weight: 600, color: TOKENS.fg.primary,   sample: "Capital Raise Pipeline" },
              { label: "fg-primary — base / 400",size: "1rem",     weight: 400, color: TOKENS.fg.primary,   sample: "Commitment tracking across all funds" },
              { label: "fg-secondary — sm / 400",size: "0.875rem", weight: 400, color: TOKENS.fg.secondary, sample: "Investor name, close date, allocation amount" },
              { label: "fg-muted — xs / 400",    size: "0.75rem",  weight: 400, color: TOKENS.fg.muted,     sample: "Last updated 3 minutes ago • Auto-saved" },
              { label: "mono — xs uppercase",     size: "0.6875rem",weight: 500, color: TOKENS.fg.muted,     sample: "PIPELINE  •  Q3 2025  •  SERIES B" },
            ] as const
          ).map((row) => (
            <div key={row.label} style={{ display: "flex", alignItems: "baseline", gap: "1.5rem" }}>
              <span
                style={{
                  minWidth: "220px",
                  fontSize: "10px",
                  color: TOKENS.fg.muted,
                  fontFamily: "monospace",
                  flexShrink: 0,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontSize: row.size,
                  fontWeight: row.weight,
                  color: row.color,
                  fontFamily: row.label.startsWith("mono") ? "monospace" : "inherit",
                  letterSpacing: row.label.startsWith("mono") ? "0.08em" : undefined,
                  textTransform: row.label.startsWith("mono") ? "uppercase" : undefined,
                }}
              >
                {row.sample}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Status Colors */}
      <Section title="Status Colors">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {(
            [
              { label: "Success",  bg: "rgba(95,184,122,0.15)",  border: "rgba(95,184,122,0.3)",  color: TOKENS.status.success },
              { label: "Warning",  bg: "rgba(214,162,74,0.15)",  border: "rgba(214,162,74,0.3)",  color: TOKENS.status.warning },
              { label: "Danger",   bg: "rgba(212,106,90,0.15)",  border: "rgba(212,106,90,0.3)",  color: TOKENS.status.danger },
              { label: "Info",     bg: "rgba(91,155,213,0.15)",  border: "rgba(91,155,213,0.3)",  color: TOKENS.status.info },
            ] as const
          ).map((chip) => (
            <div
              key={chip.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.375rem 0.75rem",
                borderRadius: "9999px",
                background: chip.bg,
                border: `1px solid ${chip.border}`,
                color: chip.color,
                fontSize: "0.8125rem",
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: chip.color,
                  flexShrink: 0,
                }}
              />
              {chip.label}
            </div>
          ))}
        </div>
      </Section>

      {/* 4. Surfaces */}
      <Section title="Surfaces">
        <div
          style={{
            background: TOKENS.surface[0],
            border: `1px solid var(--line)`,
            borderRadius: "0.75rem",
            padding: "1.25rem",
          }}
        >
          <p style={{ fontSize: "11px", color: TOKENS.fg.muted, fontFamily: "monospace", marginBottom: "1rem" }}>
            surface-0
          </p>
          <div
            style={{
              background: TOKENS.surface[1],
              border: `1px solid var(--line)`,
              borderRadius: "0.625rem",
              padding: "1rem",
            }}
          >
            <p style={{ fontSize: "11px", color: TOKENS.fg.muted, fontFamily: "monospace", marginBottom: "0.75rem" }}>
              surface-1
            </p>
            <div
              style={{
                background: TOKENS.surface[2],
                border: `1px solid var(--line)`,
                borderRadius: "0.5rem",
                padding: "0.875rem",
              }}
            >
              <p style={{ fontSize: "11px", color: TOKENS.fg.muted, fontFamily: "monospace", marginBottom: "0.5rem" }}>
                surface-2
              </p>
              <div
                style={{
                  background: TOKENS.surface[3],
                  border: `1px solid var(--line)`,
                  borderRadius: "0.375rem",
                  padding: "0.75rem",
                }}
              >
                <p style={{ fontSize: "11px", color: TOKENS.fg.muted, fontFamily: "monospace" }}>
                  surface-3
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* 5. Buttons */}
      <Section title="Buttons">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          {/* Primary */}
          <button
            type="button"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: TOKENS.gold[400],
              color: TOKENS.surface[0],
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Primary
          </button>

          {/* Secondary */}
          <button
            type="button"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: `1px solid var(--line)`,
              background: TOKENS.surface[2],
              color: TOKENS.fg.primary,
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Secondary
          </button>

          {/* Ghost */}
          <button
            type="button"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: `1px solid var(--line)`,
              background: "transparent",
              color: TOKENS.fg.secondary,
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Ghost
          </button>

          {/* Destructive */}
          <button
            type="button"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: `1px solid rgba(212,106,90,0.4)`,
              background: "rgba(212,106,90,0.1)",
              color: TOKENS.status.danger,
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Destructive
          </button>

          {/* Disabled */}
          <button
            type="button"
            disabled
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: `1px solid var(--line)`,
              background: TOKENS.surface[1],
              color: TOKENS.fg.muted,
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "not-allowed",
              opacity: 0.5,
            }}
          >
            Disabled
          </button>
        </div>
      </Section>

      {/* 6. Status Badges */}
      <Section title="Status Badges">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          {STATUS_BADGES.map((badge) => (
            <span
              key={badge.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.25rem 0.625rem",
                borderRadius: "0.375rem",
                background: badge.bg,
                color: badge.color,
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.02em",
                fontFamily: "monospace",
                textTransform: "uppercase",
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </Section>

      {/* 7. Cards */}
      <Section title="Cards">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* CopilotCard sample */}
          <div
            style={{
              background: TOKENS.surface[1],
              border: `1px solid var(--line)`,
              borderLeft: `3px solid ${TOKENS.status.success}`,
              borderRadius: "0.625rem",
              padding: "1rem 1.125rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: TOKENS.fg.muted,
                    fontFamily: "monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Earn Agent
                </span>
                <span
                  style={{
                    padding: "0.125rem 0.375rem",
                    borderRadius: "0.25rem",
                    background: "rgba(95,184,122,0.15)",
                    color: TOKENS.status.success,
                    fontSize: "10px",
                    fontWeight: 600,
                  }}
                >
                  Complete
                </span>
              </div>
              <span
                style={{
                  padding: "0.125rem 0.5rem",
                  borderRadius: "9999px",
                  background: "rgba(95,184,122,0.1)",
                  color: TOKENS.status.success,
                  fontSize: "10px",
                  fontWeight: 500,
                }}
              >
                High confidence
              </span>
            </div>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, color: TOKENS.fg.primary, marginBottom: "0.375rem" }}>
              Investor Outreach Summary
            </p>
            <p style={{ fontSize: "0.8125rem", color: TOKENS.fg.secondary, lineHeight: 1.5, marginBottom: "0.75rem" }}>
              Analyzed 47 LP relationships. Identified 12 high-probability re-up candidates for Fund IV based on commitment history and engagement signals.
            </p>
            <ul style={{ paddingLeft: "1.125rem", margin: 0, color: TOKENS.fg.secondary, fontSize: "0.8125rem", lineHeight: 1.6 }}>
              <li>3 investors with &gt;$10M historical commitment show strong re-up signals</li>
              <li>Average time-to-commit in prior funds: 18 days</li>
            </ul>
            <div style={{ marginTop: "0.875rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  background: TOKENS.gold[400],
                  color: TOKENS.surface[0],
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Open report
              </button>
              <button
                type="button"
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  background: "transparent",
                  color: TOKENS.fg.secondary,
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  border: `1px solid var(--line)`,
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Empty state card */}
          <div
            style={{
              background: TOKENS.surface[1],
              border: `1px dashed var(--line)`,
              borderRadius: "0.625rem",
              padding: "2.5rem 1.5rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.625rem",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "0.5rem",
                background: TOKENS.surface[2],
                border: `1px solid var(--line)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.125rem",
                marginBottom: "0.25rem",
              }}
            >
              ◈
            </div>
            <p style={{ fontSize: "0.875rem", fontWeight: 600, color: TOKENS.fg.primary }}>
              No commitments yet
            </p>
            <p style={{ fontSize: "0.8125rem", color: TOKENS.fg.muted, maxWidth: "280px", lineHeight: 1.5 }}>
              Start tracking LP commitments for this fund. The Earn agent can help you import and organize investor data.
            </p>
            <button
              type="button"
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                background: TOKENS.surface[2],
                border: `1px solid var(--line)`,
                color: TOKENS.fg.primary,
                fontSize: "0.8125rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Add first commitment
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
