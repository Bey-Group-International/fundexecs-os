import 'server-only';

/**
 * lib/anchor/provider.ts — the anchoring sink abstraction.
 *
 * `local` (the MVP) records a fold as an internal batch with no chain, key, or
 * network — full tamper-evidence, zero third-party dependency. `l2` is the
 * dormant external-witness option: enabling it later is a provider swap with no
 * schema or UX change (the batch row already carries provider/chain_id/tx_hash).
 *
 * Mirrors the codebase's mock-or-real adapter pattern (integrations) and the
 * never-block rule: a provider failure must never block an approval — at worst
 * a leaf stays pending and is folded in the next window.
 */

export type AnchorProviderName = 'local' | 'l2';

export interface AnchorResult {
  provider: AnchorProviderName;
  /** Chain identifier when an external witness landed the root; null for local. */
  chainId: string | null;
  /** On-chain transaction hash when externally anchored; null for local. */
  txHash: string | null;
}

export interface AnchorProvider {
  readonly name: AnchorProviderName;
  /** Commit a Merkle root to the sink. Returns where it landed (or local). */
  anchorRoot(rootHex: string): Promise<AnchorResult>;
}

/**
 * Select the active provider. Defaults to `local`; `l2` is used only when
 * explicitly opted in AND configured — otherwise we fall back to `local` rather
 * than fail, so anchoring never blocks on a half-configured witness.
 */
export async function getAnchorProvider(): Promise<AnchorProvider> {
  if (process.env.ANCHOR_PROVIDER === 'l2') {
    try {
      const { createL2Provider } = await import('./l2');
      const l2 = createL2Provider();
      if (l2) return l2;
    } catch {
      // fall through to local — never block on a misconfigured external witness
    }
  }
  const { createLocalProvider } = await import('./local');
  return createLocalProvider();
}
