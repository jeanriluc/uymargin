import type { AnalysisInputs, ChannelResult } from "@/lib/finance/types";
import { formatMoney, formatPct } from "@/lib/format";

const VIABILITY_LABEL = { excellent: "Excelente", tight: "Ajustado", risky: "Riesgoso" } as const;

/** Decimal comma so Excel in es-UY reads the cell as a number. */
function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2).replace(".", ",") : "N/A";
}

export function exportAuditToCsv(
  inputs: AnalysisInputs,
  mlResult: ChannelResult,
  directResult: ChannelResult,
  landedCostUyu: number
) {
  const dateStr = new Date().toISOString().split("T")[0];
  const filename = `uymargin_auditoria_${(inputs.productName || "producto")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_${dateStr}.csv`;

  const rows = [
    ["UYMARGIN - REPORTE DE RENTABILIDAD MAYORISTA", ""],
    ["Fecha de Generación", new Date().toLocaleString("es-UY")],
    ["Producto", inputs.productName || inputs.query || "Producto"],
    ["Tipo de Cambio USD/UYU", num(inputs.exchangeRate)],
    ["Régimen Tributario DGI", inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : "Régimen General"],
    ["", ""],
    ["ESTRUCTURA DE COSTOS Y COMPRA", ""],
    ["Costo Proveedor Original", formatMoney(inputs.cost.amount, inputs.cost.currency)],
    ["Flete de Importación / Distribución", formatMoney(inputs.freight.amount, inputs.freight.currency)],
    ["Costo Puesto Unitario (Landed UYU)", num(landedCostUyu)],
    ["Precio de Venta Simulado (PVP UYU)", num(inputs.salePrice)],
    ["", ""],
    ["MÉTRICAS POR CANAL", "MERCADO LIBRE UY", "TIENDA PROPIA / POS"],
    ["Precio de Venta", num(inputs.salePrice), num(inputs.salePrice)],
    ["Costo Puesto (Landed)", num(landedCostUyu), num(landedCostUyu)],
    ["Comisiones de Plataforma / Pasarela", num(mlResult.platformFees), num(directResult.platformFees)],
    ["Envío / Flete Local", num(mlResult.shipping), num(directResult.shipping)],
    ["Impuestos DGI Netos", num(mlResult.taxes.total), num(directResult.taxes.total)],
    ["Ganancia Líquida en Bolsillo (UYU)", num(mlResult.netProfit), num(directResult.netProfit)],
    ["Ganancia Líquida en USD", num(mlResult.netProfitUsd), num(directResult.netProfitUsd)],
    ["Margen Neto (%)", formatPct(mlResult.netMargin), formatPct(directResult.netMargin)],
    ["Retorno sobre Inversión (ROI %)", formatPct(mlResult.roi), formatPct(directResult.roi)],
    ["Precio de Equilibrio (Break-Even UYU)", num(mlResult.breakEvenPrice), num(directResult.breakEvenPrice)],
    ["Viabilidad Comercial", VIABILITY_LABEL[mlResult.viability], VIABILITY_LABEL[directResult.viability]],
  ];

  const csvContent =
    "data:text/csv;charset=utf-8,\uFEFF" +
    rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
