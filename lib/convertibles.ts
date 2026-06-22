// lib/convertibles.ts
// SAFE / convertible-note conversion engine for a Build-hub entity cap table.
// Given a SAFE or note (principal, optional valuation cap, optional discount,
// note interest) and a priced round (price-per-share + pre-money fully-diluted
// shares), it computes the conversion price — the better of the discount and cap
// prices — and the shares issued on conversion. Pure & dependency-free so the
// agents and the UI run the same math.

export type InstrumentType = "safe" | "note";

export interface Instrument {
  name: string;
  type: InstrumentType;
  /** Principal / investment amount in dollars. */
  principal: number;
  /** Optional valuation cap in dollars (cap-based conversion). */
  valuationCap?: number;
  /** Optional discount rate, e.g. 0.20 for a 20% discount. */
  discount?: number;
  /** Notes only: annual simple interest rate, e.g. 0.06. SAFEs have no interest. */
  interestRate?: number;
  /** Notes only: ISO date the note was issued; interest accrues from here. */
  issueDate?: string;
}

export interface PricedRound {
  /** The priced-round price per share. */
  pricePerShare: number;
  /** Pre-money fully-diluted share count the cap price divides into. */
  preMoneyShares: number;
}

export interface ConversionResult {
  name: string;
  type: InstrumentType;
  invested: number; // original principal
  accrued: number; // principal + accrued note interest
  conversionPrice: number;
  /** Which mechanism set the price. */
  basis: "cap" | "discount" | "round";
  sharesIssued: number;
  /** Implied pre-money valuation the investor converts at (price × preMoneyShares). */
  effectiveValuation: number;
  /** Investor's ownership of pre-money fully-diluted shares, %. */
  ownershipPct: number;
}

export interface ConvertAllResult {
  results: ConversionResult[];
  totalInvested: number;
  totalAccrued: number;
  totalSharesIssued: number;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round0 = (v: number): number => Math.round(v);
const clamp0 = (v: number): number => (v > 0 && Number.isFinite(v) ? v : 0);

const DAYS_PER_YEAR = 365;

/**
 * Principal plus any accrued note interest (simple, non-compounded) as of the
 * conversion date. SAFEs carry no interest, so accrued === principal.
 *
 * interest = principal × rate × (days held / 365)
 */
export function accruedAmount(
  instrument: Instrument,
  conversionDate: string | Date,
): number {
  const principal = clamp0(num(instrument.principal));
  if (instrument.type !== "note") return round2(principal);

  const rate = clamp0(num(instrument.interestRate));
  if (rate === 0 || !instrument.issueDate) return round2(principal);

  const issued = new Date(instrument.issueDate).getTime();
  const converted = new Date(conversionDate).getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(converted)) {
    return round2(principal);
  }

  const days = (converted - issued) / 86_400_000;
  const years = clamp0(days) / DAYS_PER_YEAR;
  const interest = principal * rate * years;
  return round2(principal + interest);
}

/**
 * The per-share price the instrument converts at: the better (lower) of the
 * discount price and the cap price.
 *
 *   discountPrice = roundPrice × (1 − discount)
 *   capPrice      = valuationCap ÷ preMoneyShares
 *
 * Handles cap-only, discount-only, both (min), and neither (converts at the
 * round price). Returns 0 only when the round price itself is unusable.
 */
export function conversionPrice(
  instrument: Instrument,
  pricedRoundPricePerShare: number,
  preMoneyShares: number,
): number {
  const roundPrice = clamp0(num(pricedRoundPricePerShare));
  if (roundPrice === 0) return 0;

  const candidates: number[] = [];

  const discount = num(instrument.discount);
  if (discount > 0 && discount < 1) {
    candidates.push(roundPrice * (1 - discount));
  }

  const cap = num(instrument.valuationCap);
  const shares = clamp0(num(preMoneyShares));
  if (cap > 0 && shares > 0) {
    candidates.push(cap / shares);
  }

  // Neither cap nor discount: converts at the round price.
  if (candidates.length === 0) return round2(roundPrice);

  return round2(Math.min(...candidates));
}

/**
 * Convert a single instrument against a priced round. Shares issued =
 * accrued amount ÷ conversion price.
 */
export function convert(
  instrument: Instrument,
  round: PricedRound,
  conversionDate: string | Date = new Date(),
): ConversionResult {
  const invested = clamp0(num(instrument.principal));
  const accrued = accruedAmount(instrument, conversionDate);
  const roundPrice = clamp0(num(round.pricePerShare));
  const preMoneyShares = clamp0(num(round.preMoneyShares));

  const price = conversionPrice(instrument, roundPrice, preMoneyShares);

  const sharesIssued = price > 0 ? round0(accrued / price) : 0;
  const effectiveValuation = round2(price * preMoneyShares);
  const ownershipPct =
    preMoneyShares > 0 ? round2((sharesIssued / preMoneyShares) * 100) : 0;

  // Classify which mechanism won, for transparency in the UI.
  let basis: ConversionResult["basis"] = "round";
  const discount = num(instrument.discount);
  const cap = num(instrument.valuationCap);
  const discountPrice =
    discount > 0 && discount < 1 ? roundPrice * (1 - discount) : Infinity;
  const capPrice =
    cap > 0 && preMoneyShares > 0 ? cap / preMoneyShares : Infinity;
  if (Number.isFinite(capPrice) && capPrice <= discountPrice) basis = "cap";
  else if (Number.isFinite(discountPrice)) basis = "discount";

  return {
    name: instrument.name,
    type: instrument.type,
    invested: round2(invested),
    accrued,
    conversionPrice: price,
    basis,
    sharesIssued,
    effectiveValuation,
    ownershipPct,
  };
}

/**
 * Convert a batch of instruments against the same priced round and total the
 * shares issued and capital invested.
 */
export function convertAll(
  instruments: Instrument[],
  round: PricedRound,
  conversionDate: string | Date = new Date(),
): ConvertAllResult {
  const results = (instruments ?? []).map((i) =>
    convert(i, round, conversionDate),
  );

  const totalInvested = round2(results.reduce((s, r) => s + r.invested, 0));
  const totalAccrued = round2(results.reduce((s, r) => s + r.accrued, 0));
  const totalSharesIssued = results.reduce((s, r) => s + r.sharesIssued, 0);

  return { results, totalInvested, totalAccrued, totalSharesIssued };
}
