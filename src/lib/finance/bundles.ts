import { analyzeChannel, computeUnitCosts } from "./engine";
import { createMlModel } from "./channels";
import type { AnalysisInputs, ChannelResult } from "./types";

export interface BundleOption {
  /** Quantity of items in the pack (2, 3, 4, etc.) */
  quantity: number;
  /** Label for display (e.g. "Pack x2 (Dúo)", "Pack x3 (Trío)") */
  label: string;
  /** Suggested discount to end consumer (e.g. 5% or 8%) */
  discountPct: number;
  /** Proposed total bundle sale price in UYU */
  bundlePrice: number;
  /** Effective price per unit for the buyer */
  effectiveUnitPrice: number;
  /** Whether this bundle reaches or exceeds the MLU fixed fee threshold ($U 1.200) */
  crossesThreshold: number; // 1 if reaches, 0 if still below
  /** Total fixed fees saved by bundling vs selling individually */
  fixedFeeSavings: number;
  /** Full financial analysis for the bundled sale on MLU */
  bundleAnalysis: ChannelResult;
  /** Net profit per unit inside the bundle */
  netProfitPerUnit: number;
  /** Extra net pesos in pocket for the whole pack vs selling individual units */
  extraNetProfitUyu: number;
  /** Percent improvement in net profit */
  profitImprovementPct: number;
  /** Tactical recommendation copy */
  verdict: string;
}

export interface BundleAnalysisResult {
  /** Indicates whether the base product suffers from MLU fixed fee (< threshold) */
  isEligibleForBundleBoost: boolean;
  baseSalePrice: number;
  baseFixedFee: number;
  baseNetProfit: number;
  options: BundleOption[];
}

/**
 * Calculates optimal bundle / pack strategies to eliminate MLU fixed fees
 * and maximize cash in pocket for products with retail tickets under $U 1.200.
 */
export function calculateBundleOptions(inputs: AnalysisInputs): BundleAnalysisResult {
  const basePrice = Math.max(0, inputs.salePrice || 0);
  const threshold = inputs.ml.fixedFeeThreshold || 1200;
  const singleFixedFee = inputs.ml.fixedFee || 40;
  const isBelowThreshold = basePrice > 0 && basePrice < threshold;

  // Single unit ML analysis
  const baseAnalysis = analyzeChannel(createMlModel(inputs.ml), inputs);
  const baseNet = baseAnalysis.netProfit;

  const quantities = [2, 3, 4];
  const discounts = [0.05, 0.08, 0.12]; // 5% for x2, 8% for x3, 12% for x4

  const options: BundleOption[] = quantities.map((qty, idx) => {
    const discount = discounts[idx] || 0.05;
    // Bundle price with consumer discount
    const rawBundlePrice = Math.round(basePrice * qty * (1 - discount));
    // If raw is just below 1200 (e.g. 1180), bump it to 1200 or 1250 so it strictly crosses
    const bundlePrice =
      rawBundlePrice < threshold && rawBundlePrice >= threshold * 0.9
        ? threshold + 50
        : rawBundlePrice;

    // Synthetic inputs for the pack
    const packInputs: AnalysisInputs = {
      ...inputs,
      productName: `${inputs.productName || "Producto"} (Pack x${qty})`,
      salePrice: bundlePrice,
      cost: {
        ...inputs.cost,
        amount: inputs.cost.amount * qty,
      },
      freight: {
        ...inputs.freight,
        amount: inputs.freight.amount * qty,
      },
    };

    const bundleAnalysis = analyzeChannel(createMlModel(inputs.ml), packInputs);
    const individualEquivalentNet = baseNet * qty;
    const extraNet = bundleAnalysis.netProfit - individualEquivalentNet;
    const profitImprovementPct =
      individualEquivalentNet > 0
        ? (extraNet / individualEquivalentNet) * 100
        : extraNet > 0
        ? 100
        : 0;

    // Fixed fee comparison
    const individualFixedFees = isBelowThreshold ? singleFixedFee * qty : 0;
    const bundleFixedFee = bundlePrice < threshold ? singleFixedFee : 0;
    const fixedFeeSavings = Math.max(0, individualFixedFees - bundleFixedFee);

    const labels = ["Pack x2 (Dúo Ahorro)", "Pack x3 (Trío Mayorista)", "Pack x4 (Caja Familiar)"];

    let verdict = "";
    if (bundlePrice >= threshold && isBelowThreshold) {
      verdict = `¡Supera el umbral de $U 1.200! Eliminás $U ${fixedFeeSavings} de cargo fijo MLU.`;
    } else if (bundlePrice >= threshold) {
      verdict = "Ticket alto sin penalización de cargo fijo unitario.";
    } else {
      verdict = "Aún por debajo de $U 1.200, pero amortiza el flete y empaque.";
    }

    return {
      quantity: qty,
      label: labels[idx] || `Pack x${qty}`,
      discountPct: discount * 100,
      bundlePrice,
      effectiveUnitPrice: Math.round(bundlePrice / qty),
      crossesThreshold: bundlePrice >= threshold ? 1 : 0,
      fixedFeeSavings,
      bundleAnalysis,
      netProfitPerUnit: Math.round(bundleAnalysis.netProfit / qty),
      extraNetProfitUyu: Math.round(extraNet),
      profitImprovementPct: Math.round(profitImprovementPct * 10) / 10,
      verdict,
    };
  });

  return {
    isEligibleForBundleBoost: isBelowThreshold,
    baseSalePrice: basePrice,
    baseFixedFee: isBelowThreshold ? singleFixedFee : 0,
    baseNetProfit: baseNet,
    options,
  };
}
