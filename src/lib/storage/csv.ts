import type { HistoryEntry } from "./history";
import { VIABILITY_LABELS } from "@/lib/finance/constants";

const REGIME_LABEL = { literal_e: "Literal E", general: "Régimen General" } as const;

function cell(value: string | number): string {
  const text = typeof value === "number" ? value.toFixed(2).replace(".", ",") : value;
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a semicolon-separated CSV (Excel es-UY friendly) with UTF-8 BOM. */
export function historyToCsv(entries: HistoryEntry[]): string {
  const header = [
    "Fecha",
    "Producto",
    "Búsqueda",
    "Costo",
    "Moneda costo",
    "Flete",
    "Moneda flete",
    "Tipo de cambio",
    "Régimen DGI",
    "Precio venta (UYU)",
    "ML mínimo",
    "ML mediana",
    "ML promedio",
    "ML máximo",
    "Publicaciones",
    "ML ganancia neta (UYU)",
    "ML margen neto %",
    "ML ROI %",
    "ML viabilidad",
    "Tienda ganancia neta (UYU)",
    "Tienda margen neto %",
    "Tienda ROI %",
    "Tienda viabilidad",
  ];
  const rows = entries.map((e) => [
    new Date(e.savedAt).toLocaleString("es-UY"),
    e.inputs.productName || e.inputs.query || "Sin nombre",
    e.inputs.query,
    e.inputs.cost.amount,
    e.inputs.cost.currency,
    e.inputs.freight.amount,
    e.inputs.freight.currency,
    e.inputs.exchangeRate,
    REGIME_LABEL[e.inputs.tax.regime],
    e.inputs.salePrice,
    e.market?.min ?? "",
    e.market?.median ?? "",
    e.market?.average ?? "",
    e.market?.max ?? "",
    e.market?.total ?? "",
    e.ml.netProfit,
    e.ml.netMargin,
    e.ml.roi,
    VIABILITY_LABELS[e.ml.viability],
    e.direct.netProfit,
    e.direct.netMargin,
    e.direct.roi,
    VIABILITY_LABELS[e.direct.viability],
  ]);
  return "\uFEFF" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
