import type { Currency } from "@/lib/finance/types";
import type { MarketStats } from "./types";

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

/**
 * Removes outliers using Tukey's fences (1.5 × IQR). Requires at least 5 samples.
 */
export function filterOutliers(sorted: number[]): number[] {
  if (sorted.length < 5) return sorted;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sorted.filter((v) => v >= lo && v <= hi);
}

/** Computes min / average / median / max (UYU) after IQR outlier filtering. */
export function computeMarketStats(prices: number[]): MarketStats | null {
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const filtered = filterOutliers(clean);
  const sum = filtered.reduce((acc, v) => acc + v, 0);
  return {
    sampleSize: filtered.length,
    outliersRemoved: clean.length - filtered.length,
    min: filtered[0],
    max: filtered[filtered.length - 1],
    average: sum / filtered.length,
    median: quantile(filtered, 0.5),
  };
}

export function priceToUyu(price: number, currency: Currency, exchangeRate: number): number {
  return currency === "USD" ? price * exchangeRate : price;
}

/** Parses free-form manual price input ("1.290; 1490 $ 1.350,50") into numbers. */
export function parseManualPrices(text: string): number[] {
  return text
    .split(/[\s;|]+/)
    .map((chunk) => chunk.replace(/[^\d.,]/g, ""))
    .map((chunk) => {
      // Uruguayan format: "." as thousands separator, "," as decimal.
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(chunk)) {
        return Number(chunk.replace(/\./g, "").replace(",", "."));
      }
      return Number(chunk.replace(",", "."));
    })
    .filter((n) => Number.isFinite(n) && n > 0);
}
