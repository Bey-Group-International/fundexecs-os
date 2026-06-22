// Execute-hub secondaries — LP liquidity Carta's cap table doesn't transact. A
// holder sells some or all of a fund position to a buyer at a negotiated price;
// this models the transfer (what committed/called/distributed/unfunded moves,
// the NAV share changing hands, and the premium or discount to NAV) so the
// operator can preview the cap-table impact before booking it. Pure: the server
// action splits the two commitment rows on an explicit operator confirm.

export interface Position {
  committed: number;
  called: number;
  distributed: number;
}

export interface SecondaryTransfer {
  fraction: number; // 0–1 of the position transferred
  committed: number; // amounts transferred from seller to buyer
  called: number;
  distributed: number;
  unfunded: number; // committed − called, transferred
  navShareTransferred: number; // NAV attaching to the transferred stake
  price: number; // cash the buyer pays the seller
  premiumDiscountPct: number | null; // price vs NAV share, percent (+premium / −discount)
  sellerRemaining: Position & { unfunded: number };
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function clampFraction(f: number): number {
  if (!Number.isFinite(f) || f <= 0) return 0;
  return f >= 1 ? 1 : f;
}

/** Cash price as a percentage of the transferred NAV share (e.g. 92 → 8% discount). */
export function priceFromNav(navShareTransferred: number, pctOfNav: number): number {
  if (!Number.isFinite(navShareTransferred) || !Number.isFinite(pctOfNav)) return 0;
  return round2(navShareTransferred * (pctOfNav / 100));
}

/**
 * Model transferring `fraction` of a position at `price`, against the holder's
 * total NAV share. Returns the transferred amounts, the seller's remaining
 * position, and the premium/discount the price implies to NAV. No I/O.
 */
export function modelTransfer(
  position: Position,
  navShare: number,
  fraction: number,
  price: number,
): SecondaryTransfer {
  const f = clampFraction(fraction);
  const committed = round2(position.committed * f);
  const called = round2(position.called * f);
  const distributed = round2(position.distributed * f);
  const unfunded = round2(Math.max(0, position.committed - position.called) * f);
  const navShareTransferred = round2(Math.max(0, navShare) * f);
  const cash = round2(Math.max(0, price));

  return {
    fraction: f,
    committed,
    called,
    distributed,
    unfunded,
    navShareTransferred,
    price: cash,
    premiumDiscountPct:
      navShareTransferred > 0 ? Math.round((cash / navShareTransferred - 1) * 1000) / 10 : null,
    sellerRemaining: {
      committed: round2(position.committed - committed),
      called: round2(position.called - called),
      distributed: round2(position.distributed - distributed),
      unfunded: round2(Math.max(0, position.committed - position.called) - unfunded),
    },
  };
}
