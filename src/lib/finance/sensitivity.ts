import type { ChannelModel } from "./channels";
import { VIABILITY_THRESHOLDS } from "./constants";
import { analyzeChannel, computeUnitCosts, solveMaxDecreasing } from "./engine";
import type { AnalysisInputs, ChannelId, Viability } from "./types";

/**
 * Dollar sensitivity. Nothing here has formulas of its own: every number comes from
 * `analyzeChannel` called with a copy of the inputs where only the exchange rate changes.
 */

export const SENSITIVITY_DELTAS: readonly number[] = [-10, -5, 0, 5, 10];

/** The break-even rate is searched up to this many times the current rate. */
export const BREAK_EVEN_RATE_LIMIT = 3;

/** Applies a percentage change. A 0% change returns the same number, bit for bit. */
export function applyDeltaPct(value: number, deltaPct: number): number {
  return deltaPct === 0 ? value : value * (1 + deltaPct / 100);
}

function hasRate(inputs: AnalysisInputs): boolean {
  return Number.isFinite(inputs.exchangeRate) && inputs.exchangeRate > 0;
}

/** True when the cost or the acquisition freight is in dollars, so the result moves with the rate. */
export function dependsOnDollar(inputs: AnalysisInputs): boolean {
  return (
    (inputs.cost.currency === "USD" && inputs.cost.amount > 0) ||
    (inputs.freight.currency === "USD" && inputs.freight.amount > 0)
  );
}

function withRate(inputs: AnalysisInputs, exchangeRate: number): AnalysisInputs {
  return { ...inputs, exchangeRate };
}

export interface SensitivityRow {
  /** Change against the current rate, in percent (0 = today). */
  deltaPct: number;
  exchangeRate: number;
  netProfit: number;
  netMargin: number;
  roi: number;
  viability: Viability;
}

/** One row per rate change. Empty without a valid exchange rate. The 0% row equals the current result. */
export function dollarSensitivity(
  model: ChannelModel,
  inputs: AnalysisInputs,
  deltasPct: readonly number[] = SENSITIVITY_DELTAS,
): SensitivityRow[] {
  if (!hasRate(inputs)) return [];
  return deltasPct.map((deltaPct) => {
    const exchangeRate = applyDeltaPct(inputs.exchangeRate, deltaPct);
    const r = analyzeChannel(model, withRate(inputs, exchangeRate));
    return { deltaPct, exchangeRate, netProfit: r.netProfit, netMargin: r.netMargin, roi: r.roi, viability: r.viability };
  });
}

export type RateThresholdReason =
  /** No exchange rate loaded. */
  | "no_rate"
  /** No sale price. */
  | "no_price"
  /** No cost loaded. */
  | "no_cost"
  /** Cost and freight are in pesos: the result does not depend on the dollar. */
  | "cost_in_uyu"
  /** Still above the target with the dollar at BREAK_EVEN_RATE_LIMIT times the current rate. */
  | "never_within_limit"
  /** Below the target even with the dollar at zero (the peso costs alone are too high). */
  | "below_at_any_rate";

export interface RateThreshold {
  channel: ChannelId;
  /** Net margin the threshold refers to, 0–100 (0 = break-even). */
  marginPct: number;
  /** Highest exchange rate (UYU per USD) that still reaches the margin. Null when there is none: see `reason`. */
  rate: number | null;
  /** How far that rate is from the current one, in percent. Negative when the product is already below the margin. */
  deltaPct: number | null;
  /** True when the product is already below the margin at the current rate. */
  alreadyBelow: boolean;
  reason: RateThresholdReason | null;
}

/**
 * The exchange rate at which the channel stops reaching `marginPct` net margin.
 * Net profit only goes down as the dollar goes up (the sale price is in pesos), so bisection applies.
 */
export function exchangeRateForMargin(model: ChannelModel, inputs: AnalysisInputs, marginPct: number): RateThreshold {
  const none = (reason: RateThresholdReason, alreadyBelow = false): RateThreshold => ({
    channel: model.id,
    marginPct,
    rate: null,
    deltaPct: null,
    alreadyBelow,
    reason,
  });

  const price = Math.max(0, inputs.salePrice || 0);
  if (price <= 0) return none("no_price");
  if (!dependsOnDollar(inputs)) {
    return none(computeUnitCosts({ ...inputs, exchangeRate: 1 }).landed > 0 ? "cost_in_uyu" : "no_cost");
  }
  if (!hasRate(inputs)) return none("no_rate");

  const current = inputs.exchangeRate;
  const targetProfit = (marginPct / 100) * price;
  const slack = (rate: number) => analyzeChannel(model, withRate(inputs, rate)).netProfit - targetProfit;

  const alreadyBelow = !(slack(current) > 0);
  const limit = current * BREAK_EVEN_RATE_LIMIT;
  if (!alreadyBelow && slack(limit) >= 0) return none("never_within_limit");

  // Above the target the threshold is between the current rate and the limit; below it, under the current rate.
  const rate = solveMaxDecreasing(slack, alreadyBelow ? current : limit);
  if (rate === null) return none("below_at_any_rate", true);
  return { channel: model.id, marginPct, rate, deltaPct: (rate / current - 1) * 100, alreadyBelow, reason: null };
}

/** "Dólar de quiebre": the exchange rate at which the net profit of the channel becomes zero. */
export function breakEvenExchangeRate(model: ChannelModel, inputs: AnalysisInputs): RateThreshold {
  return exchangeRateForMargin(model, inputs, 0);
}

/** The exchange rate at which the channel drops from "Bueno" to "Ajustado" (net margin under 15%). */
export function tightExchangeRate(model: ChannelModel, inputs: AnalysisInputs): RateThreshold {
  return exchangeRateForMargin(model, inputs, VIABILITY_THRESHOLDS.goodMargin);
}
