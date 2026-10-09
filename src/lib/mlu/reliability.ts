import { isFarFromMedian } from "./statistics";

/**
 * Confiabilidad de un dato de mercado: cuántos precios hay, qué tan dispersos están y si hay
 * alguno muy fuera de rango. Solo describe los precios: no excluye ninguno ni cambia la mediana.
 */

export type ReliabilityLevel = "solid" | "weak" | "few";

export const RELIABILITY_LABELS: Record<ReliabilityLevel, string> = {
  solid: "Dato sólido",
  weak: "Dato flojo",
  few: "Pocas muestras",
};

export const RELIABILITY_RULES = {
  /** Con menos precios que esto, la mediana depende de una o dos publicaciones. */
  minSamples: 3,
  /** Desde esta cantidad un dato puede ser sólido. */
  solidSamples: 5,
  /** Dispersión máxima (p75 / p25) de un dato sólido: la mitad central no difiere más de un 50%. */
  solidSpread: 1.5,
} as const;

export interface MarketReliability {
  level: ReliabilityLevel;
  label: string;
  sampleSize: number;
  median: number;
  /** La mitad central de los precios está entre p25 y p75. */
  p25: number;
  p75: number;
  /** p75 / p25: 1 = todos iguales. */
  spread: number;
  /** Precios a más de 3 veces la mediana o a menos de un tercio. Siguen contando en las estadísticas. */
  farCount: number;
  /** Precios que corresponden a productos usados. */
  usedCount: number;
  /** Por qué no es sólido, en palabras. Vacío si lo es. */
  reasons: string[];
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + (pos - base) * (next - sorted[base]) : sorted[base];
}

/**
 * null cuando no hay ningún precio válido. Los precios van en pesos.
 * `usedCount`: cuántos de esos precios son de productos usados (la oferta más barata es usada).
 * Si hay usados mezclados con nuevos, la mediana compara cosas distintas y el dato no es sólido.
 */
export function assessMarketData(pricesUyu: number[], usedCount = 0): MarketReliability | null {
  const sorted = pricesUyu.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const spread = p25 > 0 ? p75 / p25 : 1;
  const farCount = sorted.filter((p) => isFarFromMedian(p, median)).length;

  const reasons: string[] = [];
  const few = sorted.length < RELIABILITY_RULES.minSamples;
  if (few) {
    reasons.push(sorted.length === 1 ? "hay un solo precio" : `hay solo ${sorted.length} precios`);
  } else if (sorted.length < RELIABILITY_RULES.solidSamples) {
    reasons.push(`hay solo ${sorted.length} precios`);
  }
  if (spread > RELIABILITY_RULES.solidSpread) reasons.push("los precios están muy dispersos");
  if (farCount > 0) reasons.push(farCount === 1 ? "hay 1 precio muy fuera de rango" : `hay ${farCount} precios muy fuera de rango`);

  const used = Math.max(0, Math.min(sorted.length, Math.floor(usedCount) || 0));
  if (used > 0 && used < sorted.length) reasons.push(used === 1 ? "hay 1 usado mezclado con nuevos" : `hay ${used} usados mezclados con nuevos`);

  const level: ReliabilityLevel = few ? "few" : reasons.length === 0 ? "solid" : "weak";
  return { level, label: RELIABILITY_LABELS[level], sampleSize: sorted.length, median, p25, p75, spread, farCount, usedCount: used, reasons };
}
