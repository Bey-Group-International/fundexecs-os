import Link from "next/link";
import type { DealWarRoom as WarRoom } from "@/lib/run-war-room";
import { buildHeatmap, SEVERITY_AXIS } from "@/lib/run-war-room";
import { toPercent } from "@/lib/run-conviction";
import type { DiligenceItem, IcDecision, IcDecisionKind, RiskSeverity } from "@/lib/supabase/database.types";
import {
  addDiligenceItem,
  updateDiligenceItem,
  addUnderwriting,
  recordIcDecision,
} from "@/app/(app)/deal/[id]/actions";

// --- Small primitives ------------------------------------------------------
function Ring({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  const tone = value >= 85 ? "text-emerald-400" : value >= 35 ? "text-gold-400" : "text-fg-muted";
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={tone}
      />
    </svg>
  );
}

// Conviction-over-time sparkline from the snapshot scores.
function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) {
    return <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Trend builds as you work the deal</p>;
  }
  const w = 160;
  const h = 36;
  const max = 100;
  const step = w / (scores.length - 1);
  const pts = scores.map((s, i) => `${(i * step).toFixed(1)},${(h - (s / max) * h).toFixed(1)}`).join(" ");
  const last = scores[scores.length - 1];
  const first = scores[0];
  const delta = last - first;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-40 overflow-visible">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" className="text-gold-400" />
      </svg>
      <span className={`font-mono text-[11px] ${delta >= 0 ? "text-emerald-300" : "text-status-danger"}`}>
        {delta >= 0 ? "+" : ""}
        {delta} since first look
      </span>
    </div>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">{children}</h3>
      {action}
    </div>
  );
}

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const SEVERITY_OPTS: RiskSeverity[] = ["low", "medium", "high", "critical"];
const DILIGENCE_STATUSES = ["open", "in_review", "cleared", "flagged", "waived"];

const SEV_DOT: Record<RiskSeverity, string> = {
  low: "bg-fg-muted",
  medium: "bg-gold-400",
  high: "bg-status-danger/80",
  critical: "bg-status-danger",
};

const DECISION_META: Record<IcDecisionKind, { label: string; tone: string }> = {
  go: { label: "Go", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  conditional: { label: "Conditional", tone: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  hold: { label: "Hold", tone: "border-status-info/40 bg-status-info/10 text-status-info" },
  no_go: { label: "No-Go", tone: "border-status-danger/40 bg-status-danger/10 text-status-danger" },
};

// --- Sections --------------------------------------------------------------
function Header({ data }: { data: WarRoom }) {
  const { conviction, snapshots } = data;
  const { deal, score, stage, projectedIrr, projectedMoic } = conviction;
  return (
    <div className="rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <Ring value={score} />
          <span className="absolute inset-0 flex items-center justify-center font-display text-base font-semibold text-fg-primary">
            {score}%
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">{deal.name}</h1>
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stage.tone}`}>
              {stage.label}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {deal.stage.replace("_", " ")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
            {deal.asset_class ? <span>{deal.asset_class}</span> : null}
            {deal.geography ? <span>{deal.geography}</span> : null}
            <span className="font-mono text-fg-primary">
              {projectedIrr != null ? `${projectedIrr}% IRR` : "— IRR"}
              {projectedMoic != null ? ` · ${projectedMoic}x` : ""}
            </span>
          </div>
          <div className="mt-2.5">
            <Sparkline scores={snapshots.map((s) => s.score)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Checks({ data }: { data: WarRoom }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Conviction checklist</SectionTitle>
      <ul className="flex flex-col gap-1.5">
        {data.conviction.checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2.5 text-sm">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] ${
                c.done ? "bg-emerald-400/20 text-emerald-300" : "border border-line text-fg-muted"
              }`}
            >
              {c.done ? "✓" : ""}
            </span>
            <span className={c.done ? "text-fg-secondary" : "text-fg-primary"}>
              {c.done ? c.label : c.action}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Underwriting({ data }: { data: WarRoom }) {
  const { cases, deal } = data.conviction;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Underwriting</SectionTitle>
      {cases.length === 0 ? (
        <p className="mb-3 text-sm text-fg-muted">No cases yet — add a base case to start the conviction clock.</p>
      ) : (
        <div className="mb-3 flex flex-col gap-1.5">
          {cases.map((u) => {
            const irr = toPercent(u.projected_irr);
            return (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-line/60 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="capitalize text-fg-primary">{u.scenario.replace("_", " ")}</span>
                  <span className="truncate text-fg-muted">{u.name}</span>
                </span>
                <span className="font-mono text-fg-secondary">
                  {irr != null ? `${irr}% IRR` : "—"}
                  {u.projected_moic != null ? ` · ${u.projected_moic}x` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <form action={addUnderwriting} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="deal_id" value={deal.id} />
        <select name="scenario" className={fieldClass} defaultValue="base" aria-label="Scenario">
          <option value="base">Base</option>
          <option value="upside">Upside</option>
          <option value="downside">Downside</option>
          <option value="stress">Stress</option>
        </select>
        <input name="projected_irr" placeholder="IRR %" className={`${fieldClass} w-20`} inputMode="decimal" />
        <input name="projected_moic" placeholder="MOIC" className={`${fieldClass} w-20`} inputMode="decimal" />
        <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
          Add case
        </button>
      </form>
    </div>
  );
}

function DiligenceRow({ item }: { item: DiligenceItem }) {
  const resolved = item.status === "cleared" || item.status === "waived";
  return (
    <div className={`flex flex-col gap-2 px-3 py-2.5 ${resolved ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {item.risk_severity ? (
          <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[item.risk_severity]}`} aria-hidden />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-line" aria-hidden />
        )}
        <span className={`min-w-0 flex-1 truncate text-sm ${resolved ? "text-fg-muted" : "text-fg-primary"}`}>
          {item.title}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{item.category}</span>
        <form action={updateDiligenceItem} className="flex items-center">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="deal_id" value={item.deal_id} />
          <select
            name="status"
            defaultValue={item.status}
            className="rounded-md border border-line bg-surface-0 px-1.5 py-1 text-[11px] text-fg-secondary focus:border-gold-500/60 focus:outline-none"
            aria-label="Status"
          >
            {DILIGENCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <button className="ml-1 rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/50 hover:text-gold-300">
            Save
          </button>
        </form>
      </div>
      {/* Mitigation: only meaningful for severe, unresolved findings */}
      {!resolved && item.risk_severity && (item.risk_severity === "high" || item.risk_severity === "critical") ? (
        <form action={updateDiligenceItem} className="flex flex-wrap items-center gap-2 pl-5">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="deal_id" value={item.deal_id} />
          <input
            name="mitigation"
            defaultValue={item.mitigation ?? ""}
            placeholder="Mitigation plan…"
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <select name="residual_severity" defaultValue={item.residual_severity ?? ""} className={fieldClass} aria-label="Residual severity">
            <option value="">residual…</option>
            {SEVERITY_OPTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-gold-300">
            Mitigate
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Diligence({ data }: { data: WarRoom }) {
  const { diligence, deal, coverage } = data.conviction;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle
        action={
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {Math.round(coverage * 100)}% cleared
          </span>
        }
      >
        Diligence
      </SectionTitle>
      {diligence.length > 0 ? (
        <div className="mb-3 divide-y divide-line/50 overflow-hidden rounded-lg border border-line/60">
          {diligence.map((i) => (
            <DiligenceRow key={i.id} item={i} />
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-fg-muted">No diligence items yet.</p>
      )}
      <form action={addDiligenceItem} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="deal_id" value={deal.id} />
        <input name="title" placeholder="New diligence item…" className={`${fieldClass} min-w-0 flex-1`} required />
        <input name="category" placeholder="Category" className={`${fieldClass} w-28`} />
        <select name="risk_severity" className={fieldClass} defaultValue="" aria-label="Severity">
          <option value="">severity…</option>
          {SEVERITY_OPTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="likelihood" className={fieldClass} defaultValue="" aria-label="Likelihood">
          <option value="">likelihood…</option>
          {SEVERITY_OPTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
          Add
        </button>
      </form>
    </div>
  );
}

function Heatmap({ data }: { data: WarRoom }) {
  const grid = buildHeatmap(data.conviction.diligence);
  const hot = (sev: RiskSeverity, lik: RiskSeverity) => {
    const rank = (s: RiskSeverity) => SEVERITY_AXIS.indexOf(s);
    return rank(sev) + rank(lik); // 0..6
  };
  const cellTone = (n: number) =>
    n >= 5
      ? "bg-status-danger/30 border-status-danger/40"
      : n >= 3
        ? "bg-gold-500/20 border-gold-500/30"
        : "bg-surface-2/40 border-line";
  // Render severity high → low (top → bottom).
  const rows = [...grid].reverse();
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Risk heatmap</SectionTitle>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          <span>Impact ↑</span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-4 gap-1">
            {rows.map((row) =>
              row.map((cell) => {
                const n = hot(cell.severity, cell.likelihood);
                return (
                  <div
                    key={`${cell.severity}-${cell.likelihood}`}
                    title={`${cell.severity} impact × ${cell.likelihood} likelihood`}
                    className={`flex h-12 items-center justify-center rounded-md border text-sm font-medium ${cellTone(n)} ${
                      cell.items.length ? "text-fg-primary" : "text-fg-muted"
                    }`}
                  >
                    {cell.items.length || ""}
                  </div>
                );
              }),
            )}
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            {SEVERITY_AXIS.map((l) => (
              <span key={l} className="text-center">
                {l}
              </span>
            ))}
          </div>
          <p className="mt-1 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">Likelihood →</p>
        </div>
      </div>
    </div>
  );
}

function DecisionHistory({ decisions }: { decisions: IcDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {decisions.map((d) => {
        const meta = DECISION_META[d.decision];
        return (
          <div key={d.id} className="flex items-start gap-2 text-sm">
            <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${meta.tone}`}>
              {meta.label}
            </span>
            <span className="min-w-0 flex-1">
              {d.rationale ? <span className="text-fg-secondary">{d.rationale}</span> : <span className="text-fg-muted">—</span>}
              <span className="ml-2 font-mono text-[10px] text-fg-muted">
                {d.conviction != null ? `@ ${d.conviction}%` : ""} · {new Date(d.created_at).toLocaleDateString()}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Decision({ data }: { data: WarRoom }) {
  const { deal } = data.conviction;
  const latest = data.decisions[0];
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle
        action={
          latest ? (
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${DECISION_META[latest.decision].tone}`}>
              Last: {DECISION_META[latest.decision].label}
            </span>
          ) : undefined
        }
      >
        IC decision
      </SectionTitle>
      <form action={recordIcDecision} className="flex flex-col gap-2">
        <input type="hidden" name="deal_id" value={deal.id} />
        <textarea
          name="rationale"
          rows={2}
          placeholder="Rationale for the record…"
          className={`${fieldClass} resize-none`}
        />
        <div className="flex flex-wrap gap-2">
          {(["go", "conditional", "hold", "no_go"] as IcDecisionKind[]).map((k) => (
            <button
              key={k}
              name="decision"
              value={k}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition hover:brightness-110 ${DECISION_META[k].tone}`}
            >
              {DECISION_META[k].label}
            </button>
          ))}
        </div>
      </form>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        Go → advances to closing · No-Go → passes the deal
      </p>
      <DecisionHistory decisions={data.decisions} />
    </div>
  );
}

// --- War room --------------------------------------------------------------
export function DealWarRoom({ data }: { data: WarRoom }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link href="/run/strategy" className="font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-400">
        ← Run hub
      </Link>
      <Header data={data} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Checks data={data} />
        <Decision data={data} />
        <Underwriting data={data} />
        <Heatmap data={data} />
      </div>
      <Diligence data={data} />
    </div>
  );
}
