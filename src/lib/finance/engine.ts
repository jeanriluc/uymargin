import { createDirectModel, createMlModel, type ChannelModel } from "./channels";
import { TARGET_NET_MARGIN, VIABILITY_THRESHOLDS } from "./constants";
import { computeTaxes } from "./dgi-taxes";
import type {
  AnalysisInputs,
  ChannelId,
  ChannelResult,
  Money,
  TaxBreakdown,
  TaxSettings,
  Viability,
  WaterfallStep,
} from "./types";

/** Converts a Money value to UYU using the given rate (UYU per USD). */
export function toUyu(money: Money, exchangeRate: number): number {
  const amount = Number.isFinite(money.amount) ? Math.max(0, money.amount) : 0;
  return money.currency === "USD" ? amount * exchangeRate : amount;
}

export interface UnitCosts {
  /** Merchandise cost in UYU (as invoiced by the wholesaler). */
  merchandise: number;
  /** Acquisition freight per unit in UYU. */
  freight: number;
  /** Landed cost = merchandise + freight. */
  landed: number;
}

export function computeUnitCosts(inputs: AnalysisInputs): UnitCosts {
  const merchandise = toUyu(inputs.cost, inputs.exchangeRate);
  const freight = toUyu(inputs.freight, inputs.exchangeRate);
  return { merchandise, freight, landed: merchandise + freight };
}

interface Evaluation {
  fees: ReturnType<ChannelModel["fees"]>;
  platformFees: number;
  reservesCost: number;
  taxes: TaxBreakdown;
  netProfit: number;
}

function evaluate(
  model: ChannelModel,
  price: number,
  costs: UnitCosts,
  tax: TaxSettings,
  risks?: { returnRatePct?: number; shrinkageRatePct?: number },
): Evaluation {
  const fees = model.fees(price);
  const platformFees = fees.commission + fees.fixedFee + fees.gatewayFee;

  // Realism reserves:
  // - Return reverse logistics & processing impact: 20% value loss on returned units
  const returnRate = Math.max(0, risks?.returnRatePct || 0) / 100;
  const shrinkageRate = Math.max(0, risks?.shrinkageRatePct || 0) / 100;
  const returnCost = price * returnRate * 0.20;
  const shrinkageCost = costs.landed * shrinkageRate;
  const reservesCost = returnCost + shrinkageCost;

  const grossProfit = price - costs.landed - platformFees - model.shipping - reservesCost;
  const taxes = computeTaxes(
    {
      salePrice: price,
      merchandiseCost: costs.merchandise,
      platformFees,
      shipping: model.shipping,
      grossProfit,
    },
    tax,
  );
  return { fees, platformFees, reservesCost, taxes, netProfit: grossProfit - taxes.total };
}

const SOLVER_MAX_PRICE = 50_000_000;

/**
 * Finds the smallest price where `f(price) >= 0` via bisection.
 * `f` must be non-decreasing in price (true for our models; the ML fixed fee
 * threshold only produces upward jumps).
 */
function solveMonotonic(f: (price: number) => number): number | null {
  let lo = 0;
  let hi = 1_000;
  while (f(hi) < 0) {
    hi *= 2;
    if (hi > SOLVER_MAX_PRICE) return null;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Finds the largest `x >= 0` where `f(x) >= 0` via bisection.
 * `f` must be non-increasing in `x`. Returns null when not even `x = 0` satisfies it.
 * The returned value is always on the side where `f >= 0`.
 */
function solveMaxDecreasing(f: (x: number) => number, initialHi: number): number | null {
  if (f(0) < 0) return null;
  let lo = 0;
  let hi = Math.max(1, initialHi);
  while (f(hi) >= 0) {
    lo = hi;
    hi *= 2;
    if (hi > SOLVER_MAX_PRICE) return lo;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function classifyViability(netMargin: number, roi: number): Viability {
  const t = VIABILITY_THRESHOLDS;
  if (netMargin >= t.excellentMargin && roi >= t.excellentRoi) return "excellent";
  if (netMargin >= t.tightMargin) return "tight";
  return "risky";
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

export function analyzeChannel(model: ChannelModel, inputs: AnalysisInputs): ChannelResult {
  const costs = computeUnitCosts(inputs);
  const price = Math.max(0, inputs.salePrice || 0);
  const risks = {
    returnRatePct: inputs.returnRatePct,
    shrinkageRatePct: inputs.shrinkageRatePct,
  };
  const ev = evaluate(model, price, costs, inputs.tax, risks);

  const netMargin = pct(ev.netProfit, price);
  const grossMargin = pct(price - costs.landed, price);
  const roi = pct(ev.netProfit, costs.landed);
  const annualizedRoi =
    inputs.stockTurnoverDays && inputs.stockTurnoverDays > 0
      ? roi * (365 / inputs.stockTurnoverDays)
      : undefined;

  const profitAt = (p: number) => evaluate(model, p, costs, inputs.tax, risks).netProfit;
  const breakEvenPrice = costs.landed > 0 || model.shipping > 0 ? solveMonotonic(profitAt) : 0;
  const targetMarginPrice =
    costs.landed > 0 || model.shipping > 0
      ? solveMonotonic((p) => profitAt(p) - TARGET_NET_MARGIN * p)
      : null;

  const waterfall: WaterfallStep[] = [
    { key: "price", label: "Precio de venta", amount: price },
    { key: "product", label: "Costo de producto", amount: -costs.landed },
    { key: "fees", label: "Comisiones", amount: -ev.platformFees },
    { key: "shipping", label: "Envío", amount: -model.shipping },
    ...(ev.reservesCost > 0
      ? [{ key: "reserves" as const, label: "Mermas / devoluciones", amount: -ev.reservesCost }]
      : []),
    { key: "taxes", label: "Impuestos", amount: -ev.taxes.total },
    { key: "net", label: "Ganancia neta", amount: ev.netProfit },
  ];

  return {
    channel: model.id,
    label: model.label,
    salePrice: price,
    productCost: costs.landed,
    commission: ev.fees.commission,
    fixedFee: ev.fees.fixedFee,
    gatewayFee: ev.fees.gatewayFee,
    platformFees: ev.platformFees,
    effectiveFeeRate: ev.fees.rate,
    shipping: model.shipping,
    taxes: ev.taxes,
    reservesCost: ev.reservesCost,
    netProfit: ev.netProfit,
    netProfitUsd: inputs.exchangeRate > 0 ? ev.netProfit / inputs.exchangeRate : 0,
    netMargin,
    grossMargin,
    roi,
    annualizedRoi,
    breakEvenPrice,
    targetMarginPrice,
    viability: price > 0 ? classifyViability(netMargin, roi) : "risky",
    waterfall,
  };
}

export interface MaxCostResult {
  channel: ChannelId;
  label: string;
  /** Target net margin, 0–100. */
  targetMarginPct: number;
  /** Maximum merchandise cost in UYU (as invoiced by the wholesaler, without freight). */
  maxMerchandiseCost: number;
  /** Maximum landed cost in UYU = merchandise + acquisition freight. */
  maxLandedCost: number;
  /** USD equivalents (null without a valid exchange rate). */
  maxMerchandiseCostUsd: number | null;
  maxLandedCostUsd: number | null;
  /**
   * Merchandise cost to load in the simulation, in the currency of `inputs.cost`,
   * rounded DOWN (cents in USD, whole pesos in UYU) so the resulting net margin
   * never falls below the target. Null when it cannot be expressed in that currency.
   */
  applyCost: Money | null;
}

/**
 * Inverse calculator: the maximum merchandise cost that still reaches
 * `targetMarginPct` net margin at the given sale price, on one channel.
 *
 * Uses the same `evaluate()` as `analyzeChannel` (fees, shipping, reserves, IVA, IRAE),
 * so applying the result to the simulation yields a net margin >= the target.
 * Net profit is strictly decreasing in the merchandise cost, so bisection applies.
 *
 * Returns null when the target is unreachable even with a merchandise cost of zero.
 */
export function solveMaxMerchandiseCost(
  model: ChannelModel,
  inputs: AnalysisInputs,
  targetMarginPct: number,
): MaxCostResult | null {
  const price = Math.max(0, inputs.salePrice || 0);
  if (price <= 0 || !Number.isFinite(targetMarginPct)) return null;

  const freight = toUyu(inputs.freight, inputs.exchangeRate);
  const risks = {
    returnRatePct: inputs.returnRatePct,
    shrinkageRatePct: inputs.shrinkageRatePct,
  };
  const targetProfit = (targetMarginPct / 100) * price;
  const slack = (merchandise: number) =>
    evaluate(model, price, { merchandise, freight, landed: merchandise + freight }, inputs.tax, risks)
      .netProfit - targetProfit;

  const maxMerchandiseCost = solveMaxDecreasing(slack, price);
  if (maxMerchandiseCost === null) return null;

  const rate = inputs.exchangeRate;
  const hasRate = Number.isFinite(rate) && rate > 0;
  const currency = inputs.cost.currency;

  let applyCost: Money | null = null;
  if (currency === "UYU" || hasRate) {
    // Work in integer units (pesos or cents) to round down without float drift.
    const unitsPerAmount = currency === "USD" ? 100 : 1;
    const inCurrency = currency === "USD" ? maxMerchandiseCost / rate : maxMerchandiseCost;
    let units = Math.floor(inCurrency * unitsPerAmount);
    // Guard against the last-bit error of the currency conversion.
    while (units > 0 && slack(toUyu({ amount: units / unitsPerAmount, currency }, rate)) < 0) units--;
    applyCost = { amount: units / unitsPerAmount, currency };
  }

  const maxLandedCost = maxMerchandiseCost + freight;
  return {
    channel: model.id,
    label: model.label,
    targetMarginPct,
    maxMerchandiseCost,
    maxLandedCost,
    maxMerchandiseCostUsd: hasRate ? maxMerchandiseCost / rate : null,
    maxLandedCostUsd: hasRate ? maxLandedCost / rate : null,
    applyCost,
  };
}

/** Inverse calculator for both channels (null per channel when the target is unreachable). */
export function solveMaxMerchandiseCostAll(
  inputs: AnalysisInputs,
  targetMarginPct: number,
): Record<ChannelId, MaxCostResult | null> {
  return {
    ml: solveMaxMerchandiseCost(createMlModel(inputs.ml), inputs, targetMarginPct),
    direct: solveMaxMerchandiseCost(createDirectModel(inputs.direct), inputs, targetMarginPct),
  };
}

export interface MultichannelAnalysis {
  ml: ChannelResult;
  direct: ChannelResult;
  costs: UnitCosts;
}

export function analyzeAll(inputs: AnalysisInputs): MultichannelAnalysis {
  return {
    ml: analyzeChannel(createMlModel(inputs.ml), inputs),
    direct: analyzeChannel(createDirectModel(inputs.direct), inputs),
    costs: computeUnitCosts(inputs),
  };
}
