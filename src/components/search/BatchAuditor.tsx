"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Upload,
  Play,
  RotateCcw,
  Download,
  CloudUpload,
  Check,
  AlertTriangle,
  Trophy,
  ExternalLink,
  Sliders,
  Sparkles,
  Info,
} from "lucide-react";
import { formatUyu, formatUsd, formatPct, formatRate } from "@/lib/format";
import { VIABILITY_LABELS } from "@/lib/finance/constants";
import { batchResultsToCsv, signedUyu, UNPRICED_LABEL, type BatchItemInput, type BatchItemResult } from "@/lib/export/batchCsv";
import { createDirectModel, createMlModel } from "@/lib/finance/channels";
import { analyzeAll } from "@/lib/finance/engine";
import { breakEvenExchangeRate } from "@/lib/finance/sensitivity";
import { assessMarketData, type MarketReliability } from "@/lib/mlu/reliability";
import { priceToUyu } from "@/lib/mlu/statistics";
import { saveAuditToCloud } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import type { AnalysisInputs } from "@/lib/finance/types";
import type { MluSearchResponse } from "@/lib/mlu/types";
import { normalizeCurrency } from "@/lib/currency";

const SAMPLE_CATALOG: BatchItemInput[] = [
  { sku: "STAN-950", name: "Botella termo Stanley Classic 950 ml", cost: 26, currency: "USD" },
  { sku: "F9-TWS", name: "Auriculares F9-5 TWS Bluetooth", cost: 3.8, currency: "USD" },
  { sku: "XION-105", name: "Olla a presion electrica 5 lts Xion", cost: 1750, currency: "UYU" },
  { sku: "TRAM-24", name: "Set cubiertos Tramontina 24 piezas inox", cost: 13.5, currency: "USD" },
  { sku: "XIA-RGB", name: "Lampara inteligente Xiaomi Smart LED", cost: 8.9, currency: "USD" },
];

interface BatchAuditorProps {
  baseInputs: AnalysisInputs;
  exchangeRate: number;
  onSimulateProduct: (inputs: Partial<AnalysisInputs>) => void;
}

export function BatchAuditor({
  baseInputs,
  exchangeRate,
  onSimulateProduct,
}: BatchAuditorProps) {
  const [rawText, setRawText] = useState("");
  const [items, setItems] = useState<BatchItemInput[]>(SAMPLE_CATALOG);
  // Filas que no se calculan porque no se sabe en qué moneda está el costo.
  const [rejectedRows, setRejectedRows] = useState<{ line: string; reason: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentName: string }>({
    current: 0,
    total: 0,
    currentName: "",
  });
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [savedToCloudCount, setSavedToCloudCount] = useState<number | null>(null);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "good" | "loss">("all");

  // Con filas en U$S y sin cotización el costo en pesos no se puede calcular: no se ejecuta.
  const usdRowsWithoutRate = !(exchangeRate > 0) && items.some((i) => i.currency === "USD");

  // Parse raw text or CSV
  const parseRawInput = (text: string) => {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed: BatchItemInput[] = [];
    const rejected: { line: string; reason: string }[] = [];
    for (const line of lines) {
      // Support comma, semicolon, or tab separation
      const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
      if (parts.length >= 2) {
        let sku = parts[0];
        let name = parts[1];
        let costStr = parts[2] || "0";
        let currStr = parts[3] || "";

        // If first column looks like a name without SKU
        if (isNaN(Number(parts[1])) && parts.length === 2) {
          sku = `SKU-${parsed.length + 1}`;
          name = parts[0];
          costStr = parts[1];
          currStr = "";
        }

        const cost = parseFloat(costStr.replace("$", "").replace(",", ".")) || 0;
        // La moneda tiene que venir indicada: no se asume dólares ni pesos.
        const currency = normalizeCurrency(currStr);

        if (name && cost > 0) {
          if (currency) {
            parsed.push({ sku, name, cost, currency });
          } else {
            rejected.push({
              line,
              reason: currStr ? `moneda no reconocida ("${currStr}")` : "falta la moneda (USD o UYU)",
            });
          }
        }
      }
    }
    setRejectedRows(rejected);
    return parsed;
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRawText(e.target.value);
    const parsed = parseRawInput(e.target.value);
    if (parsed.length > 0) {
      setItems(parsed);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || "";
      setRawText(content);
      const parsed = parseRawInput(content);
      if (parsed.length > 0) {
        setItems(parsed);
      }
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    setRejectedRows([]);
    setItems(SAMPLE_CATALOG);
    setRawText(
      SAMPLE_CATALOG.map((i) => `${i.sku}, ${i.name}, ${i.cost}, ${i.currency}`).join("\n")
    );
  };

  // Run Batch Simulation
  const handleRunBatch = async () => {
    if (items.length === 0 || usdRowsWithoutRate) return;
    setIsProcessing(true);
    setResults([]);
    setSavedToCloudCount(null);

    const batchResults: BatchItemResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setProgress({ current: i + 1, total: items.length, currentName: item.name });

      const costUyu = item.currency === "USD" ? item.cost * exchangeRate : item.cost;
      // Placeholder so the row can be opened in the simulator; sampleSize 0 marks it as not a market price.
      let marketPriceUyu = Math.round(costUyu * 1.5);
      let sampleSize = 0;
      let marketError: string | undefined;
      let reliability: MarketReliability | null = null;

      try {
        const res = await apiFetch(
          `/api/search-mlu?q=${encodeURIComponent(item.name)}&rate=${exchangeRate}`
        );
        const data: MluSearchResponse | null = await res.json().catch(() => null);
        if (data?.ok && data.stats && data.stats.median > 0) {
          marketPriceUyu = Math.round(data.stats.median);
          sampleSize = data.stats.sampleSize;
          // Mismos precios con los que el servidor armó la mediana: los productos que coinciden, en pesos.
          reliability = assessMarketData(
            (data.items ?? []).filter((it) => it.match?.matches).map((it) => priceToUyu(it.price, it.currency, exchangeRate))
          );
        } else if (data && !data.ok && "message" in data && data.message) {
          marketError = data.message;
        } else if (!res.ok) {
          marketError = `Mercado Libre no respondió (HTTP ${res.status}).`;
        } else if (data?.ok && data.relevance) {
          // Hubo resultados pero ninguno coincide: se dice qué faltó. Los relacionados no se usan como precio.
          const rel = data.relevance;
          const missing = rel.missingCounts.map((m) => `«${m.term}»`).join(", ");
          const related = `${rel.related} ${rel.related === 1 ? "producto relacionado" : "productos relacionados"}`;
          marketError = rel.searchUnavailable
            ? "La búsqueda por palabras de Mercado Libre no respondió. Volvé a ejecutar el lote."
            : rel.matchedWithoutOffers > 0
              ? `${rel.matchedWithoutOffers === 1 ? "1 producto coincide" : `${rel.matchedWithoutOffers} productos coinciden`} por nombre pero sin ofertas activas en Uruguay. Hay ${related} que no se ${rel.related === 1 ? "usó" : "usaron"} como precio.`
              : `Ningún producto con ofertas menciona todo el nombre${missing ? `: a los ${related} les falta ${missing}` : ""}. Probá con un nombre más corto (marca, modelo y medida).`;
        } else {
          marketError = "La búsqueda no devolvió precios.";
        }
      } catch (err) {
        console.warn("[batch-auditor] MLU search error for item:", item.name, err);
        marketError = "No se pudo conectar con el servidor.";
      }

      // Financial Engine Simulation
      const itemInputs: AnalysisInputs = {
        ...baseInputs,
        productName: item.name,
        query: item.name,
        cost: { amount: item.cost, currency: item.currency },
        salePrice: marketPriceUyu,
      };

      const analysis = analyzeAll(itemInputs);
      const mlProfit = analysis.ml.netProfit;
      const mlMargin = analysis.ml.netMargin;
      const directProfit = analysis.direct.netProfit;
      const directMargin = analysis.direct.netMargin;

      const bestChannel = directProfit >= mlProfit ? "direct" : "ml";
      const winningResult = bestChannel === "direct" ? analysis.direct : analysis.ml;

      // Dólar de quiebre del canal ganador. Sin dato de mercado no hay precio real: no se calcula.
      const breakEven =
        sampleSize === 0
          ? null
          : breakEvenExchangeRate(bestChannel === "ml" ? createMlModel(itemInputs.ml) : createDirectModel(itemInputs.direct), itemInputs);

      // Same traffic light as the rest of the app; "unpriced" is not a viability level.
      const status: BatchItemResult["status"] = sampleSize === 0 ? "unpriced" : winningResult.viability;

      batchResults.push({
        sku: item.sku,
        name: item.name,
        cost: item.cost,
        currency: item.currency,
        costUyu,
        marketPriceUyu,
        sampleSize,
        bestChannel,
        mlProfit,
        mlMargin,
        directProfit,
        directMargin,
        roi: winningResult.roi,
        status,
        marketError,
        reliabilityLabel: reliability?.label ?? null,
        reliabilityReasons: reliability?.reasons ?? [],
        breakEvenRate: breakEven?.rate ?? null,
        rateCushionPct: breakEven?.deltaPct ?? null,
        // Sin dato de mercado no se pasa al simulador un precio provisorio como si fuera de venta.
        analysisInputs: sampleSize === 0 ? { ...itemInputs, salePrice: 0 } : itemInputs,
      });

      // Small delay between queries to respect ML rate limits
      await new Promise((r) => setTimeout(r, 250));
    }

    // Ranking por margen neto del canal ganador; las filas sin dato de mercado van al final, fuera del ranking.
    const winningMargin = (r: BatchItemResult) => (r.bestChannel === "ml" ? r.mlMargin : r.directMargin);
    batchResults.sort((a, b) => {
      if ((a.status === "unpriced") !== (b.status === "unpriced")) return a.status === "unpriced" ? 1 : -1;
      return a.status === "unpriced" ? 0 : winningMargin(b) - winningMargin(a);
    });
    setResults(batchResults);
    setIsProcessing(false);
  };

  // Export Results to CSV
  const handleExportCsv = () => {
    if (results.length === 0) return;

    const csvContent = batchResultsToCsv(results);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `uymargin_auditoria_lote_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Save All to Supabase
  const handleSaveAllToCloud = async () => {
    if (results.length === 0) return;
    setCloudSaving(true);
    let count = 0;

    for (const r of results) {
      // Rows without a real market price are not saved: there is no audit to store.
      if (r.status === "unpriced") continue;
      try {
        const res = await saveAuditToCloud({
          title: r.name,
          target_price: r.marketPriceUyu,
          target_currency: "UYU",
          target_price_uyu: r.marketPriceUyu,
          competitor_median: r.marketPriceUyu,
          competitor_count: r.sampleSize,
          financial_simulation: {
            channel: r.bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia",
            costWholesale: r.costUyu,
            sellingPrice: r.marketPriceUyu,
            netMarginPercent: r.bestChannel === "ml" ? r.mlMargin : r.directMargin,
            netProfitUyu: r.bestChannel === "ml" ? r.mlProfit : r.directProfit,
            taxRegime: baseInputs.tax.regime === "literal_e" ? "Literal E" : "Régimen General",
          },
          notes: `Lote SKU: ${r.sku} · Costo Original: ${r.currency} ${r.cost}`,
        });
        if (res.ok) count++;
      } catch (e) {
        console.error("[batch-auditor] error saving to cloud", e);
      }
    }

    setSavedToCloudCount(count);
    setCloudSaving(false);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 shadow-sm space-y-5 animate-rise">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="heading-grotesk text-sm font-black tracking-tight uppercase text-zinc-900 dark:text-zinc-100">
            Evaluador de listas de precios y catálogos
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            Cargá un catálogo mayorista para cotizar automáticamente en Mercado Libre Uruguay y rankear por margen neto real.
          </p>
        </div>

        <button
          type="button"
          onClick={handleLoadSample}
          className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:border-black dark:hover:border-white px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 transition-all cursor-pointer"
        >
          <Sparkles className="size-3.5 text-amber-500" />
          <span>Cargar Ejemplo (5 Productos)</span>
        </button>
      </div>

      {/* Input Area: CSV / Textarea */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label htmlFor="csv-input" className="text-xs font-black uppercase text-zinc-600 dark:text-zinc-400">
            Formato: <span className="font-mono text-zinc-800 dark:text-zinc-200">SKU, Nombre del Producto, Costo, Moneda (USD / UYU)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
            <Upload className="size-3.5" />
            <span>Subir archivo .csv</span>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        <textarea
          id="csv-input"
          rows={4}
          value={rawText}
          onChange={handleTextChange}
          placeholder="Ej:&#10;STAN-950, Botella termo Stanley Classic 950 ml, 26, USD&#10;F9-TWS, Auriculares Bluetooth F9-5 TWS, 3.8, USD&#10;XION-105, Olla a presion electrica 5 lts Xion, 1750, UYU"
          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3 font-mono text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-hidden focus:ring-1 focus:ring-black dark:focus:ring-white"
        />

        {rejectedRows.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
          >
            <p className="font-bold">
              {rejectedRows.length} {rejectedRows.length === 1 ? "fila no se va a calcular" : "filas no se van a calcular"}:
              indicá la moneda del costo (USD o UYU) en la cuarta columna.
            </p>
            <ul className="mt-1.5 space-y-0.5 pl-4">
              {rejectedRows.slice(0, 6).map((r, i) => (
                <li key={i}>
                  <span className="num">{r.line}</span> — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {usdRowsWithoutRate && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-bold leading-relaxed text-amber-900 dark:text-amber-200"
          >
            Hay productos con costo en dólares y no hay cotización del dólar. Ingresá la cotización en el encabezado
            para poder auditar el catálogo.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
            <span>{items.length} productos detectados</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>Tipo de cambio: {exchangeRate > 0 ? formatRate(exchangeRate) : "falta"}</span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>Régimen: {baseInputs.tax.regime === "literal_e" ? "Literal E" : "Régimen General"}</span>
          </div>

          <button
            type="button"
            onClick={handleRunBatch}
            disabled={isProcessing || items.length === 0 || usdRowsWithoutRate}
            className="inline-flex items-center gap-2 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm disabled:opacity-40"
          >
            <Play className={`size-3.5 ${isProcessing ? "animate-spin" : ""}`} />
            <span>{isProcessing ? "Auditando en vivo..." : "Auditar Catálogo Completo"}</span>
          </button>
        </div>
      </div>

      {/* Processing Progress Bar */}
      {isProcessing && (
        <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 animate-rise">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-950 dark:text-indigo-200 mb-1.5">
            <span>Consultando precios en ML Uruguay ({progress.current}/{progress.total}):</span>
            <span>{Math.round((progress.current / progress.total) * 100)}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-indigo-200 dark:bg-indigo-900 overflow-hidden">
            <div
              className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate block mt-1">«{progress.currentName}»</span>
        </div>
      )}

      {/* Results Section */}
      {results.length > 0 && (() => {
        const pricedResults = results.filter((r) => r.status !== "unpriced");
        const totalInvestmentUyu = pricedResults.reduce((acc, r) => acc + r.costUyu, 0);
        const totalProfitUyu = pricedResults.reduce(
          (acc, r) => acc + (r.bestChannel === "ml" ? r.mlProfit : r.directProfit),
          0
        );
        const overallRoi = totalInvestmentUyu > 0 ? (totalProfitUyu / totalInvestmentUyu) * 100 : 0;
        const goodCount = results.filter((r) => r.status === "good" || r.status === "excellent").length;
        const lossCount = results.filter((r) => r.status === "loss").length;
        const displayedResults = results.filter((r) => {
          if (filterStatus === "good") return r.status === "good" || r.status === "excellent";
          if (filterStatus === "loss") return r.status === "loss";
          return true;
        });

        return (
          <div className="space-y-4 pt-2 border-t border-zinc-100 dark:border-zinc-800 animate-rise">
            {/* Lot Summary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 block tracking-wider">
                  Inversión Total del Lote
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-lg font-black text-zinc-900 dark:text-zinc-100 num">
                    {formatUyu(totalInvestmentUyu)}
                  </span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400 font-bold">
                    {exchangeRate > 0 ? `(≈ USD ${Math.round(totalInvestmentUyu / exchangeRate)})` : ""}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 block tracking-wider">
                  Ganancia Neta en Bolsillo
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className={`text-lg font-black num ${totalProfitUyu >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                    {formatUyu(totalProfitUyu)}
                  </span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400 font-bold">
                    (margen {formatPct(totalInvestmentUyu > 0 ? (totalProfitUyu / (totalInvestmentUyu + totalProfitUyu)) * 100 : 0)})
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 block tracking-wider">
                  Retorno Global de Capital (ROI)
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 num">
                    {formatPct(overallRoi)}
                  </span>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400 font-bold">
                    s/ costo puesto
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFilterStatus("all")}
                  className={`px-2.5 py-1 text-xs font-bold rounded cursor-pointer transition-all ${
                    filterStatus === "all"
                      ? "bg-white dark:bg-zinc-800 text-black dark:text-white shadow-xs"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  Todos ({results.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus("good")}
                  className={`px-2.5 py-1 text-xs font-bold rounded cursor-pointer transition-all ${
                    filterStatus === "good"
                      ? "bg-emerald-500 text-white shadow-xs"
                      : "text-emerald-700 dark:text-emerald-400 hover:opacity-80"
                  }`}
                >
                  {VIABILITY_LABELS.good} o {VIABILITY_LABELS.excellent} ({goodCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus("loss")}
                  className={`px-2.5 py-1 text-xs font-bold rounded cursor-pointer transition-all ${
                    filterStatus === "loss"
                      ? "bg-red-500 text-white shadow-xs"
                      : "text-red-600 dark:text-red-400 hover:opacity-80"
                  }`}
                >
                  {VIABILITY_LABELS.loss} ({lossCount})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:border-black dark:hover:border-white px-3 py-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 cursor-pointer transition-all"
                  title="Descargar ranking en CSV compatible con Excel"
                >
                  <Download className="size-3.5" />
                  <span>Exportar CSV</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveAllToCloud}
                  disabled={cloudSaving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-bold cursor-pointer transition-all disabled:opacity-50"
                  title="Guardar resultados del lote en Supabase"
                >
                  <CloudUpload className="size-3.5" />
                  <span>{cloudSaving ? "Guardando..." : "Guardar en Supabase"}</span>
                </button>
              </div>
            </div>

            {savedToCloudCount !== null && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Check className="size-4 shrink-0" />
                <span>Se guardaron {savedToCloudCount} productos exitosamente en tu base de datos de Supabase.</span>
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    <th className="py-2.5 px-3">SKU & Producto</th>
                    <th className="py-2.5 px-3">Costo Unitario</th>
                    <th className="py-2.5 px-3">Mercado MLU</th>
                    <th className="py-2.5 px-3">Mercado Libre</th>
                    <th className="py-2.5 px-3">Tienda Propia</th>
                    <th className="py-2.5 px-3">Canal Ganador</th>
                    <th className="py-2.5 px-3">Estado</th>
                    <th className="py-2.5 px-3">Dólar de quiebre</th>
                    <th className="py-2.5 px-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium">
                  {displayedResults.map((r) => {
                    const winningProfit = r.bestChannel === "ml" ? r.mlProfit : r.directProfit;
                    const winningMargin = r.bestChannel === "ml" ? r.mlMargin : r.directMargin;

                  return (
                    <tr
                      key={r.sku}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 block">{r.sku}</span>
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">{r.name}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">
                          {r.currency === "USD" ? formatUsd(r.cost) : formatUyu(r.cost)}
                        </span>
                        {r.currency === "USD" && (
                          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">≈ {formatUyu(r.costUyu)}</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {r.status === "unpriced" ? (
                          <>
                            <span className="block text-[11px] font-bold text-zinc-600 dark:text-zinc-400">
                              {UNPRICED_LABEL}
                            </span>
                            {r.marketError && (
                              <span role="alert" className="block text-[11px] text-red-600 dark:text-red-400">
                                {r.marketError}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-zinc-900 dark:text-zinc-100 num">
                              {formatUyu(r.marketPriceUyu)}
                            </span>
                            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{r.sampleSize} {r.sampleSize === 1 ? "producto que coincide" : "productos que coinciden"}</span>
                            {r.reliabilityLabel && (
                              <span
                                title={r.reliabilityReasons?.length ? `Porque ${r.reliabilityReasons.join(" y ")}.` : undefined}
                                className={`block text-[11px] font-bold ${r.reliabilityLabel === "Dato sólido" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                              >
                                {r.reliabilityLabel}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {r.status === "unpriced" ? (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        ) : (
                          <>
                            <span className={`num font-bold ${r.mlProfit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                              {formatUyu(r.mlProfit)}
                            </span>
                            <span className="block text-[11px] text-zinc-600 dark:text-zinc-400 font-bold">{formatPct(r.mlMargin)}</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {r.status === "unpriced" ? (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        ) : (
                          <>
                            <span className={`num font-bold ${r.directProfit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                              {formatUyu(r.directProfit)}
                            </span>
                            <span className="block text-[11px] text-zinc-600 dark:text-zinc-400 font-bold">{formatPct(r.directMargin)}</span>
                          </>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {r.status === "unpriced" ? (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        ) : (
                          <div className="flex items-center gap-1 font-bold text-zinc-900 dark:text-zinc-100">
                            <Trophy className="size-3 text-amber-500 shrink-0" />
                            <span>{r.bestChannel === "ml" ? "Mercado Libre" : "Tienda Propia"}</span>
                          </div>
                        )}
                        {r.status !== "unpriced" && (
                          <span className={`num text-[11px] font-bold ${winningProfit > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {signedUyu(winningProfit)} ({formatPct(winningMargin)})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {r.status === "unpriced" && (
                          <span className="inline-flex rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-black text-zinc-700 dark:text-zinc-300 uppercase">
                            {UNPRICED_LABEL}
                          </span>
                        )}
                        {(r.status === "good" || r.status === "excellent") && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">
                            <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" /> {VIABILITY_LABELS[r.status]}
                          </span>
                        )}
                        {r.status === "tight" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase">
                            <span aria-hidden className="size-1.5 rounded-full bg-amber-500" /> {VIABILITY_LABELS.tight}
                          </span>
                        )}
                        {r.status === "loss" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-black text-red-600 dark:text-red-400 uppercase">
                            <span aria-hidden className="size-1.5 rounded-full bg-red-500" /> {VIABILITY_LABELS.loss}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {typeof r.breakEvenRate === "number" && typeof r.rateCushionPct === "number" ? (
                          <>
                            <span className="num font-bold text-zinc-900 dark:text-zinc-100">$ {formatRate(r.breakEvenRate)}</span>
                            <span className={`block text-[11px] font-bold ${r.rateCushionPct > 0 ? "text-zinc-600 dark:text-zinc-400" : "text-red-600 dark:text-red-400"}`}>
                              colchón {r.rateCushionPct > 0 ? "+" : ""}{formatPct(r.rateCushionPct)}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            onSimulateProduct(r.analysisInputs);
                          }}
                          className="px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-[11px] font-black uppercase transition-all cursor-pointer"
                        >
                          Simular
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    })()}
    </div>
  );
}
