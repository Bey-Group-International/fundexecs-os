// lib/earn/lp-sim.ts
// A constant-product (x·y=k) liquidity-pool simulator — the treasury "what-if"
// engine behind the Earn surface. FundExecs already models private-market
// mechanics (waterfall, LBO, cap table); this is the native, pure distillation
// of the public liquidity-pool math (the excel-liquidity-pool-simulator idea):
// given a pool and a trade, what comes out, how much does the price move, and
// how does providing liquidity compare to simply holding (impermanent loss)?
//
// Everything here is PURE and deterministic — no DB, no key, no Date — so it
// runs identically at request time and in tests, and can back an interactive
// "simulate" panel without any backend round-trip. Amounts are plain numbers in
// the pool's own units; fees are basis points (30 bps = 0.30%).

// A constant-product pool: reserves of two assets and the invariant k = x·y.
export interface Pool {
  /** Reserve of asset X (the "base"). */
  x: number;
  /** Reserve of asset Y (the "quote"). */
  y: number;
  /** The invariant, x·y. */
  k: number;
  /** Spot price of one X in units of Y. */
  price: number;
}

// The result of quoting a swap against a pool.
export interface SwapQuote {
  amountIn: number;
  amountOut: number;
  /** Effective price paid (amountIn / amountOut), in Y per X or X per Y. */
  executionPrice: number;
  /** Fraction in [0,1]: how far execution price moved from spot. */
  priceImpact: number;
  /** Fee paid, in input-asset units. */
  feePaid: number;
  /** The pool state after the swap. */
  poolAfter: Pool;
}

const clampNonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Build a pool from its two reserves. Price is Y per X (i.e. y/x). Reserves
 * must be positive; non-positive inputs yield a zeroed, inert pool. Pure.
 */
export function poolFromReserves(x: number, y: number): Pool {
  const rx = clampNonNeg(x);
  const ry = clampNonNeg(y);
  return { x: rx, y: ry, k: rx * ry, price: rx > 0 ? ry / rx : 0 };
}

// Spot price of X in units of Y for the given reserves (y/x). Pure.
export function spotPrice(x: number, y: number): number {
  return x > 0 ? y / x : 0;
}

/**
 * Quote swapping `amountIn` of the input asset into the other asset, given the
 * input/output reserves and a fee in basis points. Uses the constant-product
 * formula with the fee taken off the input:
 *
 *   amountInAfterFee = amountIn · (1 − fee)
 *   amountOut = reserveOut · amountInAfterFee / (reserveIn + amountInAfterFee)
 *
 * `xIsInput` orients the returned pool (which side grew). Pure; returns a
 * zeroed quote for non-positive inputs or an empty pool.
 */
export function swap(
  pool: Pool,
  amountIn: number,
  opts: { feeBps?: number; xIsInput?: boolean } = {},
): SwapQuote {
  const feeBps = Number.isFinite(opts.feeBps) ? Math.max(0, Math.min(10_000, opts.feeBps as number)) : 30;
  const xIsInput = opts.xIsInput ?? true;
  const reserveIn = xIsInput ? pool.x : pool.y;
  const reserveOut = xIsInput ? pool.y : pool.x;
  const amt = clampNonNeg(amountIn);

  if (amt === 0 || reserveIn <= 0 || reserveOut <= 0) {
    return {
      amountIn: amt,
      amountOut: 0,
      executionPrice: 0,
      priceImpact: 0,
      feePaid: 0,
      poolAfter: pool,
    };
  }

  const fee = feeBps / 10_000;
  const feePaid = amt * fee;
  const amountInAfterFee = amt - feePaid;
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

  const newIn = reserveIn + amt;
  const newOut = reserveOut - amountOut;
  const poolAfter = xIsInput ? poolFromReserves(newIn, newOut) : poolFromReserves(newOut, newIn);

  // Spot price of the OUTPUT asset in INPUT units before the trade, vs the
  // effective price actually paid — their gap is the price impact.
  const spotOutInIn = reserveIn / reserveOut;
  const executionPrice = amt / amountOut;
  const priceImpact = executionPrice > 0 ? Math.max(0, 1 - spotOutInIn / executionPrice) : 0;

  return { amountIn: amt, amountOut, executionPrice, priceImpact, feePaid, poolAfter };
}

/**
 * Impermanent loss for a 50/50 constant-product LP when the price ratio moves
 * by factor `r` (new price ÷ entry price). Returned as a NON-NEGATIVE fraction:
 * the value of the LP position relative to simply holding the two assets is
 * (1 − il). IL(r) = 1 − 2·√r/(1+r). Symmetric in r and 1/r; zero at r = 1. Pure.
 */
export function impermanentLoss(priceRatio: number): number {
  const r = clampNonNeg(priceRatio);
  if (r === 0) return 0;
  const il = 1 - (2 * Math.sqrt(r)) / (1 + r);
  return Math.max(0, Math.min(1, il));
}

/**
 * Annualized fee yield (APR) for a liquidity provider, as a fraction:
 *
 *   apr = (dailyVolume · fee / liquidity) · 365
 *
 * `liquidity` is the pool's total value in the same units as `dailyVolume`.
 * Pure; returns 0 for a non-positive pool.
 */
export function feeApr(input: {
  dailyVolume: number;
  liquidity: number;
  feeBps?: number;
}): number {
  const fee = (Number.isFinite(input.feeBps) ? Math.max(0, input.feeBps as number) : 30) / 10_000;
  const vol = clampNonNeg(input.dailyVolume);
  const liq = clampNonNeg(input.liquidity);
  if (liq === 0) return 0;
  return ((vol * fee) / liq) * 365;
}

/**
 * Net position vs holding: the LP earns fees but bears impermanent loss. Given
 * an entry, a price move, the LP's fee APR and a horizon in days, returns the
 * fractional edge of LPing over holding — positive when fees outrun IL. Pure.
 */
export function lpEdgeVsHold(input: {
  priceRatio: number;
  feeApr: number;
  days: number;
}): number {
  const il = impermanentLoss(input.priceRatio);
  const feeReturn = clampNonNeg(input.feeApr) * (clampNonNeg(input.days) / 365);
  return feeReturn - il;
}
