import type { AnalysisInputs, ChannelResult } from "@/lib/finance/types";
import { formatPct, formatUyu } from "@/lib/format";

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
    ["Tipo de Cambio USD/UYU", inputs.exchangeRate.toFixed(2)],
    ["Régimen Tributario DGI", inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : "Régimen General"],
    ["", ""],
    ["ESTRUCTURA DE COSTOS Y COMPRA", ""],
    ["Costo Proveedor Original", `${inputs.cost.currency} ${inputs.cost.amount}`],
    ["Flete de Importación / Distribución", `${inputs.freight.currency} ${inputs.freight.amount}`],
    ["Costo Puesto Unitario (Landed UYU)", landedCostUyu.toFixed(2)],
    ["Precio de Venta Simulado (PVP UYU)", inputs.salePrice.toFixed(2)],
    ["", ""],
    ["MÉTRICAS POR CANAL", "MERCADO LIBRE UY", "TIENDA PROPIA / POS"],
    ["Precio de Venta", inputs.salePrice.toFixed(2), inputs.salePrice.toFixed(2)],
    ["Costo Puesto (Landed)", landedCostUyu.toFixed(2), landedCostUyu.toFixed(2)],
    ["Comisiones de Plataforma / Pasarela", mlResult.platformFees.toFixed(2), directResult.platformFees.toFixed(2)],
    ["Envío / Flete Local", mlResult.shipping.toFixed(2), directResult.shipping.toFixed(2)],
    ["Impuestos DGI Netos", mlResult.taxes.total.toFixed(2), directResult.taxes.total.toFixed(2)],
    ["Ganancia Líquida en Bolsillo (UYU)", mlResult.netProfit.toFixed(2), directResult.netProfit.toFixed(2)],
    ["Ganancia Líquida en USD", mlResult.netProfitUsd.toFixed(2), directResult.netProfitUsd.toFixed(2)],
    ["Margen Neto (%)", formatPct(mlResult.netMargin), formatPct(directResult.netMargin)],
    ["Retorno sobre Inversión (ROI %)", formatPct(mlResult.roi), formatPct(directResult.roi)],
    ["Precio de Equilibrio (Break-Even UYU)", mlResult.breakEvenPrice?.toFixed(2) || "N/A", directResult.breakEvenPrice?.toFixed(2) || "N/A"],
    ["Viabilidad Comercial", mlResult.viability.toUpperCase(), directResult.viability.toUpperCase()],
  ];

  const csvContent =
    "data:text/csv;charset=utf-8,\uFEFF" +
    rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
