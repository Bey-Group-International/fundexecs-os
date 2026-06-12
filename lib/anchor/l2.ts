import 'server-only';
import type { AnchorProvider } from './provider';

/**
 * lib/anchor/l2.ts — the dormant external-witness provider.
 *
 * Per the internal-first decision this is intentionally NOT implemented: the
 * MVP ships with the `local` provider only. Wiring this up later (post the
 * tamper-evidence thesis) means submitting a single ~32-byte Merkle root per
 * window to a public L2 from a gas-only key — never customer funds, no custody.
 * It is a self-contained swap: nothing else in the anchoring layer changes.
 *
 * `createL2Provider` returns null until configured + implemented, so
 * `getAnchorProvider` cleanly falls back to `local`.
 */
export function createL2Provider(): AnchorProvider | null {
  // Intentionally unimplemented in the internal-first MVP. To enable the
  // external witness, construct a provider here that signs + submits `rootHex`
  // to the configured chain and returns its { chainId, txHash }.
  return null;
}
