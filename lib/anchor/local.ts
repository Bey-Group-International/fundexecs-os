import 'server-only';
import type { AnchorProvider } from './provider';

/**
 * lib/anchor/local.ts — the internal-first provider (the MVP).
 *
 * Folding a batch is purely internal: the root is persisted in `anchor_batches`
 * by the fold worker, and this provider simply reports that the root was
 * committed locally (no chain id, no tx hash, no network). This delivers full
 * tamper-evidence with zero third-party dependency.
 */
export function createLocalProvider(): AnchorProvider {
  return {
    name: 'local',
    async anchorRoot() {
      return { provider: 'local', chainId: null, txHash: null };
    }
  };
}
