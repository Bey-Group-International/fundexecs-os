import { ShieldCheck, Lightbulb, ListChecks, Package, type LucideIcon } from 'lucide-react';
import type { TrustLayer } from './emit-trust';

export type { TrustLayer } from './emit-trust';
export type { TrustEvent } from './emit-trust';

/** Badge tone the toast/drawer maps each layer onto (see `components/ui/Badge`). */
export type TrustTone = 'info' | 'violet' | 'warning' | 'success';

/** Static presentation metadata for one Chain-of-Trust proof layer. */
export interface TrustLayerMeta {
  layer: TrustLayer;
  /** Title-case product noun, e.g. "Proof of Truth". */
  name: string;
  /** Short label used in compact pipeline pills. */
  short: string;
  /** One-line description of what the layer proves. */
  desc: string;
  icon: LucideIcon;
  /** Token-driven CSS color for the layer hue. */
  color: string;
  /** Soft (alpha) fill for chips/cards of this layer. */
  soft: string;
  /** Hairline border for chips/cards of this layer. */
  line: string;
  /** Presentational completion % for the pipeline view. */
  pct: number;
}

/**
 * The four-layer proof pipeline, in order. Hues come straight from the design
 * tokens: Truth=sky/info, Concept=violet, Execution=amber/warning, Work=emerald.
 */
export const TRUST_LAYERS: TrustLayerMeta[] = [
  {
    layer: 'truth',
    name: 'Proof of Truth',
    short: 'Truth',
    desc: 'Source data, citations, verified facts',
    icon: ShieldCheck,
    color: 'var(--proof-truth)',
    soft: 'rgba(56,189,248,0.12)',
    line: 'rgba(56,189,248,0.3)',
    pct: 100
  },
  {
    layer: 'concept',
    name: 'Proof of Concept',
    short: 'Concept',
    desc: 'Strategy, thesis, fit logic',
    icon: Lightbulb,
    color: 'var(--proof-concept)',
    soft: 'rgba(167,139,250,0.12)',
    line: 'rgba(167,139,250,0.3)',
    pct: 70
  },
  {
    layer: 'execution',
    name: 'Proof of Execution',
    short: 'Execution',
    desc: 'Tasks, workflows, approvals',
    icon: ListChecks,
    color: 'var(--proof-execution)',
    soft: 'rgba(251,191,36,0.12)',
    line: 'rgba(251,191,36,0.3)',
    pct: 35
  },
  {
    layer: 'work',
    name: 'Proof of Work',
    short: 'Work',
    desc: 'Evidence, uploads, outcomes, logs',
    icon: Package,
    color: 'var(--proof-work)',
    soft: 'rgba(52,211,153,0.12)',
    line: 'rgba(52,211,153,0.3)',
    pct: 0
  }
];

/** Lookup a layer's presentation metadata by key. */
export function trustLayerMeta(layer: TrustLayer): TrustLayerMeta {
  return TRUST_LAYERS.find((l) => l.layer === layer) ?? TRUST_LAYERS[0];
}
