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
] as const;

const pct = (value: number) => value.toFixed(1).replace(".", ",");

/**
 * Una fila del CSV del Lote. Sin dato de mercado no hay precio de venta: el precio, el canal,
 * los márgenes, las ganancias y el ROI van vacíos en vez de calcularse sobre un precio provisorio.
 */
export function batchCsvRow(r: BatchItemResult): Array<string | number> {
  const base = [`"${r.sku}"`, `"${r.name.replace(/"/g, '""')}"`, String(r.cost).replace(".", ","), r.currency, Math.round(r.costUyu)];
  if (r.status === "unpriced") {
    return [...base, "", r.sampleSize, "", "", "", "", "", "", UNPRICED_LABEL];
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
  ];
}

/** CSV separado por punto y coma, con BOM UTF-8 (lo abre bien Excel en es-UY). */
export function batchResultsToCsv(results: BatchItemResult[]): string {
  return "﻿" + [BATCH_CSV_HEADERS.join(";"), ...results.map((r) => batchCsvRow(r).join(";"))].join("\n");
}
