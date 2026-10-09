import type { ChannelModel } from "./channels";
import { analyzeChannel } from "./engine";
import { applyDeltaPct } from "./sensitivity";
import type { AnalysisInputs, ChannelResult } from "./types";

/**
 * What-if scenarios. No formulas of its own: each scenario is `analyzeChannel` called with a copy
 * of the inputs (sale price, exchange rate) and of the channel model (shipping paid by the seller).
 */

export interface Scenario {
  /** Change in the sale price, in percent. */
  priceDeltaPct: number;
  /** Change in the exchange rate, in percent. */
  exchangeDeltaPct: number;
  /** Change in the shipping the seller pays on the channel, in percent. Acquisition freight is not touched. */
  shippingDeltaPct: number;
}

export type ScenarioId = "pessimistic" | "base" | "optimistic";

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  pessimistic: "Pesimista",
  base: "Base",
  optimistic: "Optimista",
};

export const DEFAULT_SCENARIOS: Record<ScenarioId, Scenario> = {
  pessimistic: { priceDeltaPct: -10, exchangeDeltaPct: 10, shippingDeltaPct: 20 },
  base: { priceDeltaPct: 0, exchangeDeltaPct: 0, shippingDeltaPct: 0 },
  optimistic: { priceDeltaPct: 5, exchangeDeltaPct: -5, shippingDeltaPct: 0 },
};

/** "¿Aguanta un 20% de descuento?" */
export const CYBER_SCENARIO: Scenario = { priceDeltaPct: -20, exchangeDeltaPct: 0, shippingDeltaPct: 0 };
export const CYBER_LABEL = "Ciberlunes";

export const SCENARIO_PCT_RANGE = { min: -50, max: 100 } as const;

/** Keeps a typed percentage inside the allowed range. Anything that is not a number counts as 0. */
export function clampScenarioPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(SCENARIO_PCT_RANGE.max, Math.max(SCENARIO_PCT_RANGE.min, value));
}

export function isSameScenario(a: Scenario, b: Scenario): boolean {
  return a.priceDeltaPct === b.priceDeltaPct && a.exchangeDeltaPct === b.exchangeDeltaPct && a.shippingDeltaPct === b.shippingDeltaPct;
}

export interface ScenarioResult {
  scenario: Scenario;
  /** Values the scenario was evaluated with. */
  salePrice: number;
  exchangeRate: number;
  shipping: number;
  result: ChannelResult;
}

/** Evaluates one channel under a scenario. With all changes at 0 it returns exactly the current result. */
export function runScenario(model: ChannelModel, inputs: AnalysisInputs, scenario: Scenario): ScenarioResult {
  const salePrice = applyDeltaPct(inputs.salePrice, scenario.priceDeltaPct);
  const exchangeRate = applyDeltaPct(inputs.exchangeRate, scenario.exchangeDeltaPct);
  const shipping = applyDeltaPct(model.shipping, scenario.shippingDeltaPct);
  const result = analyzeChannel({ ...model, shipping }, { ...inputs, salePrice, exchangeRate });
  return { scenario, salePrice, exchangeRate, shipping, result };
}
