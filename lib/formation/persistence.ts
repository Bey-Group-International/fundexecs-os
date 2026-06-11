import { FORMATION_D0, type FormationData } from './config';

/**
 * lib/formation/persistence.ts — shape guard for the persisted FormationData
 * document (pure).
 *
 * The flow stores the operator's working document as one `jsonb` blob on
 * `fund_formations.data`. Anything read back from (or written to) that column
 * passes through `sanitizeFormationData`, which keeps only the known keys with
 * the right primitive types and sane lengths — so a stale or hand-edited row
 * can never crash the flow or smuggle oversized payloads into a write.
 */

const MAX_STR = 2000;
const MAX_EDGES = 12;

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, MAX_STR) : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function strArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  return v
    .filter((x): x is string => typeof x === 'string')
    .slice(0, MAX_EDGES)
    .map((x) => x.slice(0, 200));
}

/** Coerce unknown input into a complete, well-typed FormationData document. */
export function sanitizeFormationData(input: unknown): FormationData {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d0 = FORMATION_D0;
  return {
    storyHook: str(raw.storyHook, d0.storyHook),
    storyOrigin: str(raw.storyOrigin, d0.storyOrigin),
    storyEdges: strArray(raw.storyEdges, [...d0.storyEdges]),
    storyWhyNow: str(raw.storyWhyNow, d0.storyWhyNow),
    entity: str(raw.entity, d0.entity),
    domicile: str(raw.domicile, d0.domicile),
    gp: str(raw.gp, d0.gp),
    mgmtco: str(raw.mgmtco, d0.mgmtco),
    fee: num(raw.fee, d0.fee),
    carry: num(raw.carry, d0.carry),
    hurdle: num(raw.hurdle, d0.hurdle),
    gpCommit: num(raw.gpCommit, d0.gpCommit),
    term: num(raw.term, d0.term),
    termsUndecided: bool(raw.termsUndecided, d0.termsUndecided),
    ppmTrack: bool(raw.ppmTrack, d0.ppmTrack),
    ppmFee: bool(raw.ppmFee, d0.ppmFee),
    ppmConflicts: bool(raw.ppmConflicts, d0.ppmConflicts),
    ppmSector: bool(raw.ppmSector, d0.ppmSector),
    minCommit: str(raw.minCommit, d0.minCommit),
    accredMethod: str(raw.accredMethod, d0.accredMethod),
    sideLetters: bool(raw.sideLetters, d0.sideLetters),
    exemption: str(raw.exemption, d0.exemption),
    accred: str(raw.accred, d0.accred),
    erisa: bool(raw.erisa, d0.erisa),
    bank: str(raw.bank, d0.bank),
    escrow: str(raw.escrow, d0.escrow),
    acctType: str(raw.acctType, d0.acctType)
  };
}
