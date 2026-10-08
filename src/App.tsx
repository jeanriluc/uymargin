import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  FileSpreadsheet,
  Printer,
  Save,
  Share2,
  ShoppingBag,
  Store,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { Header, type ConnectionStatus } from "@/components/layout/Header";
import { SearchPanel } from "@/components/search/SearchPanel";
import { MarketSummary, type MarketState } from "@/components/search/MarketSummary";
import { UrlAnalyzer } from "@/components/search/UrlAnalyzer";
import { BatchAuditor } from "@/components/search/BatchAuditor";
import { SupabaseModal } from "@/components/cloud/SupabaseModal";
import { SavedAuditsDrawer } from "@/components/cloud/SavedAuditsDrawer";
import { CostPanel } from "@/components/calculator/CostPanel";
import { ProfitHeroCard } from "@/components/calculator/ProfitHeroCard";
import { BundleOptimizer } from "@/components/calculator/BundleOptimizer";
import { PricingBar } from "@/components/calculator/PricingBar";
import { ChannelCard } from "@/components/calculator/ChannelCard";
import { MlSettings, DirectSettings } from "@/components/calculator/ChannelSettings";
import { HistorySection } from "@/components/history/HistorySection";
import { AiAdvisor } from "@/components/ai/AiAdvisor";
import type { CloudAuditRecord } from "@/lib/supabase";
import { exportAuditToCsv } from "@/lib/export/csv";

import { createDefaultInputs } from "@/lib/finance/constants";
import { analyzeAll } from "@/lib/finance/engine";
import { historyStore, createEntryId, type HistoryEntry } from "@/lib/storage/history";
import { parseManualPrices, computeMarketStats } from "@/lib/mlu/statistics";
import { formatPct, formatUyu } from "@/lib/format";

import type {
  AnalysisInputs,
  TaxSettings,
  MlChannelSettings,
  DirectChannelSettings,
} from "@/lib/finance/types";
import type { MarketStats, ExchangeRateResponse } from "@/lib/mlu/types";

export default function App() {
  const [inputs, setInputs] = useState<AnalysisInputs>(createDefaultInputs());
  const [marketState, setMarketState] = useState<MarketState>({ status: "idle" });
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [marketSource, setMarketSource] = useState<"mlu" | "manual" | null>(null);
  const [manualPrices, setManualPrices] = useState<string>("");

  const [searchLoading, setSearchLoading] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  const [rateInfo, setRateInfo] = useState<ExchangeRateResponse | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const [aiAdvisorOpen, setAiAdvisorOpen] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [searchTab, setSearchTab] = useState<"keyword" | "url" | "batch">("keyword");
  const [supabaseModalOpen, setSupabaseModalOpen] = useState(false);
  const [savedAuditsOpen, setSavedAuditsOpen] = useState(false);

  const handleLoadCloudAudit = (audit: CloudAuditRecord) => {
    const targetPrice = audit.target_price_uyu || Math.round(audit.target_price || 1200);
    updateInputs({
      productName: audit.title,
      query: audit.title,
      salePrice: targetPrice,
    });
    if (audit.competitor_median) {
      setStats({
        min: audit.competitor_min || targetPrice,
        median: audit.competitor_median,
        average: Math.round(
          ((audit.competitor_min || targetPrice) +
            (audit.competitor_max || targetPrice) +
            audit.competitor_median) /
            3
        ),
        max: audit.competitor_max || targetPrice,
        sampleSize: audit.competitor_count || 1,
        outliersRemoved: 0,
      });
      setMarketSource("mlu");
      setStatus("online");
    }
  };

  const updateInputs = useCallback((patch: Partial<AnalysisInputs>) => {
    setInputs((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateTax = useCallback((patch: Partial<TaxSettings>) => {
    setInputs((prev) => ({ ...prev, tax: { ...prev.tax, ...patch } }));
  }, []);

  const updateMl = useCallback((patch: Partial<MlChannelSettings>) => {
    setInputs((prev) => ({ ...prev, ml: { ...prev.ml, ...patch } }));
  }, []);

  const updateDirect = useCallback((patch: Partial<DirectChannelSettings>) => {
    setInputs((prev) => ({ ...prev, direct: { ...prev.direct, ...patch } }));
  }, []);

  // Fetch exchange rate on mount
  const fetchRate = useCallback(async () => {
    setRateLoading(true);
    try {
      const res = await fetch("/api/exchange-rate");
      if (res.ok) {
        const data: ExchangeRateResponse = await res.json();
        setRateInfo(data);
        if (data.rate && data.rate > 0) {
          updateInputs({ exchangeRate: data.rate });
        }
      }
    } catch (e) {
      console.error("Failed to fetch exchange rate", e);
    } finally {
      setRateLoading(false);
    }
  }, [updateInputs]);

  useEffect(() => {
    fetchRate();
  }, [fetchRate]);

  // Handle Search in Mercado Libre Uruguay
  const handleSearch = async (query: string) => {
    if (!query) return;
    setSearchLoading(true);
    setStatus("idle");
    setMarketState({ status: "loading", query });

    try {
      const res = await fetch(
        `/api/search-mlu?q=${encodeURIComponent(query)}&rate=${inputs.exchangeRate}`
      );
      const data = await res.json();

      if (data.ok) {
        setStatus("online");
        setMarketSource("mlu");
        setMarketState({
          status: "success",
          query,
          total: data.total,
          items: data.items,
        });

        if (data.stats) {
          setStats(data.stats);
          if (inputs.salePrice <= 0 || inputs.salePrice === 1290) {
            updateInputs({ salePrice: Math.round(data.stats.median) });
          }
        }
      } else {
        setStatus("manual");
        setMarketState({
          status: "error",
          query,
          error: { ok: false, code: data.code || "UPSTREAM_ERROR", message: data.message || "Error al buscar." },
        });
      }
    } catch (e) {
      console.error("Search failed", e);
      setStatus("manual");
      setMarketState({
        status: "error",
        query,
        error: { ok: false, code: "NETWORK", message: "Error de red al consultar Mercado Libre." },
      });
    } finally {
      setSearchLoading(false);
    }
  };

  // Handle manual competitor prices
  const handleManualPricesChange = (text: string) => {
    setManualPrices(text);
    const parsed = parseManualPrices(text);
    if (parsed.length > 0) {
      const computed = computeMarketStats(parsed);
      setStats(computed);
      setMarketSource("manual");
      setStatus("manual");
      if (computed && inputs.salePrice <= 0) {
        updateInputs({ salePrice: Math.round(computed.median) });
      }
    } else {
      setStats(null);
    }
  };

  const analysis = analyzeAll(inputs);
  const bestChannel = analysis.ml.netProfit >= analysis.direct.netProfit ? "ml" : "direct";
  const winningChannelResult = bestChannel === "ml" ? analysis.ml : analysis.direct;
  const suggestedPrice = analysis.ml.targetMarginPrice ?? analysis.direct.targetMarginPrice;
  const minBreakEven = Math.min(
    analysis.ml.breakEvenPrice ?? Infinity,
    analysis.direct.breakEvenPrice ?? Infinity
  );

  const handleSave = () => {
    const entry: HistoryEntry = {
      id: createEntryId(),
      savedAt: new Date().toISOString(),
      inputs,
      market: stats
        ? {
            ...stats,
            total: marketState.status === "success" ? marketState.total : stats.sampleSize,
            source: marketSource ?? "manual",
          }
        : null,
      ml: {
        netProfit: analysis.ml.netProfit,
        netMargin: analysis.ml.netMargin,
        roi: analysis.ml.roi,
        viability: analysis.ml.viability,
      },
      direct: {
        netProfit: analysis.direct.netProfit,
        netMargin: analysis.direct.netMargin,
        roi: analysis.direct.roi,
        viability: analysis.direct.viability,
      },
    };
    historyStore.add(entry);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleLoadEntry = (entry: HistoryEntry) => {
    setInputs(entry.inputs);
    if (entry.market) {
      const { total, source, ...restStats } = entry.market;
      setStats(restStats);
      setMarketSource(source);
      setStatus("manual");
    } else {
      setStats(null);
      setMarketSource(null);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCopySummary = () => {
    const summary = `📊 Análisis de Rentabilidad UyMargin (${inputs.productName || inputs.query || "Producto"}):
- Costo Proveedor: ${inputs.cost.currency} ${inputs.cost.amount} | Landed: ${formatUyu(analysis.costs.landed)}
- Precio Venta Simulado: ${formatUyu(inputs.salePrice)}
- Ganancia Neta Mercado Libre: ${formatUyu(analysis.ml.netProfit)} (Margen: ${formatPct(analysis.ml.netMargin)})
- Ganancia Neta Tienda Propia: ${formatUyu(analysis.direct.netProfit)} (Margen: ${formatPct(analysis.direct.netMargin)})
- Canal más rentable: ${bestChannel === "ml" ? "Mercado Libre" : "Tienda Propia"} (${winningChannelResult.viability.toUpperCase()})
- Régimen DGI: ${inputs.tax.regime === "literal_e" ? "Literal E" : "Régimen General"}`;

    navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const summary = `📊 *Auditoría UyMargin* - ${inputs.productName || inputs.query || "Producto"}
🟢 *Resultado:* Te quedan ${formatUyu(winningChannelResult.netProfit)} limpios (${formatPct(winningChannelResult.netMargin)})
🏆 *Canal Ganador:* ${bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia / POS"}
💰 *Costo Puesto:* ${inputs.cost.currency} ${inputs.cost.amount} (${formatUyu(analysis.costs.landed)})
🏷 *Precio de Venta:* ${formatUyu(inputs.salePrice)}
⚖ *Régimen DGI:* ${inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : "Régimen General"}
_Calculado con UyMargin - Analizador Mayorista Uruguay_`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(summary)}`;
    window.open(url, "_blank");
  };

  const handleExportCsv = () => {
    exportAuditToCsv(inputs, analysis.ml, analysis.direct, analysis.costs.landed);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-[#f5f5f6] dark:bg-[#0c0c0e] text-[#121212] dark:text-[#f2f2f3] flex flex-col font-sans transition-colors bg-editorial-dots">
      <Header
        exchangeRate={inputs.exchangeRate}
        onExchangeRateChange={(r) => updateInputs({ exchangeRate: r })}
        rateInfo={rateInfo}
        rateLoading={rateLoading}
        onRefreshRate={fetchRate}
        status={status}
        onOpenAiAdvisor={() => setAiAdvisorOpen(true)}
        onOpenCloudModal={() => setSupabaseModalOpen(true)}
        onOpenSavedAudits={() => setSavedAuditsOpen(true)}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        {/* Architectural Executive Ribbon (inspired by reference layout) */}
        <section aria-label="Resumen Ejecutivo" className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Left: Product & Sourcing */}
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center bg-black text-white dark:bg-white dark:text-black font-black text-lg shadow-sm">
                <TrendingUp className="size-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    SIMULACIÓN ACTIVA
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                    {inputs.tax.regime === "literal_e" ? "LITERAL E / MONOTRIBUTO" : "RÉGIMEN GENERAL (22%)"}
                  </span>
                </div>
                <h1 className="heading-grotesk text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase mt-0.5">
                  {inputs.productName || inputs.query || "Producto en Análisis"}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-zinc-500 font-semibold uppercase tracking-wider">
                  <span>Costo Landed: <strong className="text-black dark:text-white num">{formatUyu(analysis.costs.landed)}</strong></span>
                  <span>·</span>
                  <span>Venta: <strong className="text-black dark:text-white num">{formatUyu(inputs.salePrice)}</strong></span>
                  <span>·</span>
                  <span>USD/UYU: <strong className="text-black dark:text-white num">${inputs.exchangeRate.toFixed(2)}</strong></span>
                </div>
              </div>
            </div>

            {/* Center: Winning channel verdict callout */}
            {inputs.salePrice > 0 && (
              <div className="flex items-center gap-4 rounded-lg border border-black dark:border-white bg-black text-white dark:bg-white dark:text-black px-5 py-3 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Trophy className="size-5 shrink-0" />
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-widest block opacity-75">
                      CANAL RECOMENDADO
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider">
                      {bestChannel === "ml" ? "MERCADO LIBRE UY" : "TIENDA PROPIA / POS"}
                    </span>
                  </div>
                </div>

                <div className="h-8 w-px bg-white/30 dark:bg-black/30" />

                <div>
                  <span className="text-[9px] font-black uppercase tracking-widest block opacity-75">
                    UTILIDAD LÍQUIDA
                  </span>
                  <span className="num text-sm font-black">
                    {formatUyu(winningChannelResult.netProfit)} ({formatPct(winningChannelResult.netMargin)})
                  </span>
                </div>
              </div>
            )}

            {/* Right: Quick Action Buttons */}
            <div className="flex items-center gap-2 self-start lg:self-center">
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Descargar auditoría en formato Excel / CSV"
              >
                <FileSpreadsheet className="size-3.5 text-emerald-600" />
                <span className="hidden sm:inline">CSV</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Imprimir / Exportar Ficha Oficial en PDF"
              >
                <Printer className="size-3.5" />
                <span className="hidden sm:inline">PDF</span>
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Copiar resumen al portapapeles"
              >
                {copiedSummary ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span className="hidden sm:inline">{copiedSummary ? "Copiado" : "Copiar"}</span>
              </button>

              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="flex items-center gap-1.5 rounded-md border border-emerald-600/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer"
                title="Compartir veredicto por WhatsApp"
              >
                <Share2 className="size-3.5" />
                <span className="hidden sm:inline">WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={() => setAiAdvisorOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-all cursor-pointer"
              >
                <Bot className="size-3.5" />
                <span>Copilot IA</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={inputs.salePrice <= 0}
                className="flex items-center gap-1.5 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95"
              >
                {savedSuccess ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                <span>{savedSuccess ? "Guardado" : "Guardar"}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Level 1: 5-Second Executive Profit Hero & Reverse Calculator */}
        <ProfitHeroCard
          inputs={inputs}
          analysis={analysis}
          suggestedMarketPrice={suggestedPrice}
          onSelectSalePrice={(p) => updateInputs({ salePrice: p })}
          onUpdateCostAmount={(newCost) => {
            updateInputs({ cost: { ...inputs.cost, amount: newCost } });
          }}
          onUpdateExchangeRate={(newRate) => {
            updateInputs({ exchangeRate: newRate });
          }}
        />

        {/* Strategic Bundle Optimizer (Anti-Cargo Fijo MLU & Multiplicador) */}
        <BundleOptimizer
          inputs={inputs}
          baseResult={analysis.ml}
          onApplyBundle={(bundlePrice, bundleTitle) => {
            updateInputs({
              salePrice: bundlePrice,
              productName: bundleTitle,
            });
            window.scrollTo({ top: 350, behavior: "smooth" });
          }}
        />

        {/* Bento Grid: Step 1, Step 2, Step 3 */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column: Sourcing & Market Intelligence */}
          <div className="flex flex-col gap-6">
            {/* Search Mode Tab Switcher */}
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-1.5 shadow-sm">
              <button
                type="button"
                onClick={() => setSearchTab("keyword")}
                className={`flex-1 rounded-md py-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  searchTab === "keyword"
                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                }`}
              >
                Radar MLU
              </button>
              <button
                type="button"
                onClick={() => setSearchTab("url")}
                className={`flex-1 rounded-md py-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  searchTab === "url"
                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                }`}
              >
                <span>Auditor Enlace</span>
                <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black text-amber-500">NUEVO</span>
              </button>
              <button
                type="button"
                onClick={() => setSearchTab("batch")}
                className={`flex-1 rounded-md py-2 text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  searchTab === "batch"
                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                }`}
              >
                <span>Lote CSV</span>
                <span className="rounded bg-indigo-500/20 px-1 py-0.2 text-[9px] font-black text-indigo-500">PRO</span>
              </button>
            </div>

            {searchTab === "keyword" ? (
              <>
                <SearchPanel
                  query={inputs.query}
                  onQueryChange={(q) => updateInputs({ query: q })}
                  onSearch={handleSearch}
                  loading={searchLoading}
                />

                <MarketSummary
                  state={marketState}
                  stats={stats}
                  source={marketSource}
                  manualPrices={manualPrices}
                  onManualPricesChange={handleManualPricesChange}
                  onSelectPrice={(p) => updateInputs({ salePrice: p })}
                />
              </>
            ) : searchTab === "url" ? (
              <UrlAnalyzer
                exchangeRate={inputs.exchangeRate}
                onSimulatePrice={(p, name) => {
                  updateInputs({ salePrice: p, productName: name, query: name });
                  window.scrollTo({ top: 300, behavior: "smooth" });
                }}
                onOpenCloudSettings={() => setSupabaseModalOpen(true)}
              />
            ) : (
              <BatchAuditor
                baseInputs={inputs}
                exchangeRate={inputs.exchangeRate}
                onSimulateProduct={(simInputs) => {
                  updateInputs(simInputs);
                  setSearchTab("keyword");
                  window.scrollTo({ top: 250, behavior: "smooth" });
                }}
                onOpenCloudSettings={() => setSupabaseModalOpen(true)}
              />
            )}

            <CostPanel
              inputs={inputs}
              costs={analysis.costs}
              onChange={updateInputs}
              onTaxChange={updateTax}
            />
          </div>

          {/* Right Column: Pricing Engine & Channel Battle */}
          <div className="flex flex-col gap-6">
            <PricingBar
              salePrice={inputs.salePrice}
              exchangeRate={inputs.exchangeRate}
              stats={stats}
              suggestedPrice={suggestedPrice}
              breakEvenPrice={Number.isFinite(minBreakEven) ? minBreakEven : null}
              onChange={(p) => updateInputs({ salePrice: p })}
            />

            {/* Channels Comparative Header Banner */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-4 flex items-center justify-between">
              <div>
                <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <span>Simulación Multicanal Comparada</span>
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  ¿Dónde te conviene publicar considerando envíos, comisiones y pasarelas?
                </p>
              </div>
            </div>

            {/* Mercado Libre Card */}
            <ChannelCard
              result={analysis.ml}
              icon={<ShoppingBag className="size-5" />}
              subtitle="Mercado Libre Uruguay (Comisión + Mercado Envíos + Cargo Fijo)"
              regime={inputs.tax.regime}
              isWinner={bestChannel === "ml" && inputs.salePrice > 0}
              settings={<MlSettings value={inputs.ml} onChange={updateMl} />}
            />

            {/* Direct Web / POS Card */}
            <ChannelCard
              result={analysis.direct}
              icon={<Store className="size-5" />}
              subtitle="Tienda Propia / POS / Redes Sociales (Pasarela + Flete Local)"
              regime={inputs.tax.regime}
              isWinner={bestChannel === "direct" && inputs.salePrice > 0}
              settings={<DirectSettings value={inputs.direct} onChange={updateDirect} />}
            />
          </div>
        </div>

        {/* History Vault Section */}
        <section aria-label="Historial de Simulaciones" className="mt-2">
          <HistorySection onLoadEntry={handleLoadEntry} />
        </section>
      </main>

      {/* AI Financial Advisor Drawer / Modal */}
      <AiAdvisor
        isOpen={aiAdvisorOpen}
        onClose={() => setAiAdvisorOpen(false)}
        inputs={inputs}
        analysis={analysis}
      />

      {/* Supabase Cloud Settings Modal */}
      <SupabaseModal
        isOpen={supabaseModalOpen}
        onClose={() => setSupabaseModalOpen(false)}
        onConnected={() => setSupabaseModalOpen(false)}
      />

      {/* Supabase Saved Audits Drawer */}
      <SavedAuditsDrawer
        isOpen={savedAuditsOpen}
        onClose={() => setSavedAuditsOpen(false)}
        onLoadAudit={handleLoadCloudAudit}
        onOpenSettings={() => setSupabaseModalOpen(true)}
      />
    </div>
  );
}
