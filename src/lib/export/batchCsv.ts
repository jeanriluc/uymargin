import { VIABILITY_LABELS } from "../finance/constants";
import type { AnalysisInputs, Viability } from "../finance/types";
import { formatUyu } from "../format";

export interface BatchItemInput {
  sku: string;
  name: string;
  cost: number;
  currency: "USD" | "UYU";
}

export interface BatchItemResult {
  sku: string;
  name: string;
  cost: number;
  currency: "USD" | "UYU";
  costUyu: number;
  marketPriceUyu: number;
  sampleSize: number;
  bestChannel: "ml" | "direct";
  mlProfit: number;
  mlMargin: number;
  directProfit: number;
  directMargin: number;
  roi: number;
  /** "unpriced": Mercado Libre returned no market price, so the row cannot be ranked. */
  status: Viability | "unpriced";
  /** Por qué no hay dato de mercado cuando la consulta falló o no devolvió precios. */
  marketError?: string;
  analysisInputs: AnalysisInputs;
  /**
   * "Dólar de quiebre" del canal ganador (UYU por USD) y cuánto puede subir el dólar antes de perder plata, en %.
   * null cuando no aplica: sin dato de mercado, costo en pesos, o no quiebra dentro del rango que se busca.
   * Si la fila ya pierde plata, el colchón es negativo.
   */
  breakEvenRate?: number | null;
  rateCushionPct?: number | null;
  /** Confiabilidad del precio de mercado ("Dato sólido" / "Dato flojo" / "Pocas muestras") y por qué. */
  reliabilityLabel?: string | null;
  reliabilityReasons?: string[];
  /** Nombre más corto con el que se consiguió el precio, cuando el nombre completo no tuvo resultados. null = no se amplió. */
  broadenedQuery?: string | null;
}

export const UNPRICED_LABEL = "Sin dato de mercado";

/** "+$U 292" con ganancia, "−$U 292" con pérdida (nunca "+−"), "$U 0" en cero. */
export function signedUyu(value: number): string {
  return `${value > 0 ? "+" : ""}${formatUyu(value)}`;
}

export const BATCH_CSV_HEADERS = [
  "SKU",
  "Producto",
  "Costo Original",
  "Moneda",
  "Costo UYU",
  "Precio Mediana MLU ($U)",
  "Muestras MLU",
  "Canal Ganador",
  "Margen ML (%)",
  "Ganancia ML ($U)",
  "Margen Tienda (%)",
  "Ganancia Tienda ($U)",
  "ROI (%)",
  "Viabilidad",
  "Dólar de quiebre ($U)",
  "Colchón (%)",
  "Confiabilidad del dato",
  "Búsqueda ampliada",
] as const;

const pct = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * Una fila del CSV del Lote. Sin dato de mercado no hay precio de venta: el precio, el canal,
 * los márgenes, las ganancias y el ROI van vacíos en vez de calcularse sobre un precio provisorio.
 */
export function batchCsvRow(r: BatchItemResult): Array<string | number> {
  const base = [`"${r.sku}"`, `"${r.name.replace(/"/g, '""')}"`, String(r.cost).replace(".", ","), r.currency, Math.round(r.costUyu)];
  if (r.status === "unpriced") {
    return [...base, "", r.sampleSize, "", "", "", "", "", "", UNPRICED_LABEL, "", "", "", ""];
  }
  return [
    ...base,
    r.marketPriceUyu,
    r.sampleSize,
    r.bestChannel === "ml" ? "Mercado Libre" : "Tienda Propia",
    pct(r.mlMargin),
    Math.round(r.mlProfit),
    pct(r.directMargin),
    Math.round(r.directProfit),
    pct(r.roi),
    VIABILITY_LABELS[r.status],
    typeof r.breakEvenRate === "number" ? r.breakEvenRate.toFixed(2).replace(".", ",") : "",
    typeof r.rateCushionPct === "number" ? pct(r.rateCushionPct) : "",
    r.reliabilityLabel ?? "",
    r.broadenedQuery ? `"${r.broadenedQuery.replace(/"/g, '""')}"` : "",
  ];
}

/** CSV separado por punto y coma, con BOM UTF-8 (lo abre bien Excel en es-UY). */
export function batchResultsToCsv(results: BatchItemResult[]): string {
  return "﻿" + [BATCH_CSV_HEADERS.join(";"), ...results.map((r) => batchCsvRow(r).join(";"))].join("\n");
}

/** Ranking del Lote: por margen neto del canal ganador; las filas sin dato de mercado van al final, fuera del ranking. */
export function sortBatchResults(results: BatchItemResult[]): BatchItemResult[] {
  const winningMargin = (r: BatchItemResult) => (r.bestChannel === "ml" ? r.mlMargin : r.directMargin);
  return [...results].sort((a, b) => {
    if ((a.status === "unpriced") !== (b.status === "unpriced")) return a.status === "unpriced" ? 1 : -1;
    return a.status === "unpriced" ? 0 : winningMargin(b) - winningMargin(a);
  });
}

/** Filas que vale la pena volver a consultar: las que quedaron sin dato de mercado. */
export function retryTargets(results: BatchItemResult[]): BatchItemInput[] {
  return results
    .filter((r) => r.status === "unpriced")
    .map((r) => ({ sku: r.sku, name: r.name, cost: r.cost, currency: r.currency }));
}

/**
 * Resultado de una corrida (completa, cancelada o de reintento):
 * las filas nuevas reemplazan a las anteriores con el mismo SKU; las que no se llegaron a consultar
 * (corrida cancelada) conservan su resultado anterior, si lo tenían.
 */
export function mergeBatchResults(previous: BatchItemResult[], fresh: BatchItemResult[]): BatchItemResult[] {
  const freshSkus = new Set(fresh.map((r) => r.sku));
  return sortBatchResults([...previous.filter((r) => !freshSkus.has(r.sku)), ...fresh]);
}

/** Espera máxima que el Lote hace solo ante un 429. Más que eso es el tope diario: no tiene sentido esperar. */
export const BATCH_MAX_WAIT_SECONDS = 65;

export type RateLimitDecision =
  /** No es un 429: seguir normalmente. */
  | { action: "continue" }
  /** Tope por minuto: esperar y volver a consultar la misma fila. */
  | { action: "wait"; seconds: number }
  /** Tope diario (o espera desconocida demasiado larga): frenar el lote y conservar lo consultado. */
  | { action: "stop" };

/** Qué hace el Lote cuando una consulta responde con el límite de uso (HTTP 429 + Retry-After en segundos). */
export function rateLimitDecision(status: number, retryAfterHeader: string | null | undefined): RateLimitDecision {
  if (status !== 429) return { action: "continue" };
  const seconds = Math.ceil(Number(retryAfterHeader));
  // Sin Retry-After válido se espera un poco: puede ser Mercado Libre pidiendo ir más despacio.
  if (!Number.isFinite(seconds) || seconds <= 0) return { action: "wait", seconds: 5 };
  return seconds <= BATCH_MAX_WAIT_SECONDS ? { action: "wait", seconds } : { action: "stop" };
}
