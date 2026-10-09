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
] as const;

const pct = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * Una fila del CSV del Lote. Sin dato de mercado no hay precio de venta: el precio, el canal,
 * los márgenes, las ganancias y el ROI van vacíos en vez de calcularse sobre un precio provisorio.
 */
export function batchCsvRow(r: BatchItemResult): Array<string | number> {
  const base = [`"${r.sku}"`, `"${r.name.replace(/"/g, '""')}"`, String(r.cost).replace(".", ","), r.currency, Math.round(r.costUyu)];
  if (r.status === "unpriced") {
    return [...base, "", r.sampleSize, "", "", "", "", "", "", UNPRICED_LABEL, "", "", ""];
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
