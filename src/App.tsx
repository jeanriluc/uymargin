import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Cloud,
  FileSpreadsheet,
  History,
  Link2,
  Printer,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShoppingBag,
  Store,
  TrendingUp,
} from "lucide-react";

import { Header, type CloudStatus, type ConnectionStatus } from "@/components/layout/Header";
import { SearchPanel } from "@/components/search/SearchPanel";
import { MarketSummary, type MarketState } from "@/components/search/MarketSummary";
import { ExactOffersSection } from "@/components/search/ExactOffersSection";
import { CostPanel } from "@/components/calculator/CostPanel";
import { ProfitHeroCard } from "@/components/calculator/ProfitHeroCard";
import { RiskTools } from "@/components/calculator/RiskTools";
import { BundleOptimizer } from "@/components/calculator/BundleOptimizer";
import { PricingBar } from "@/components/calculator/PricingBar";
import { StickyResultBar } from "@/components/calculator/StickyResultBar";
import { ChannelCard } from "@/components/calculator/ChannelCard";
import { MlSettings, DirectSettings } from "@/components/calculator/ChannelSettings";
import { HistorySection } from "@/components/history/HistorySection";
import type { CloudAuditRecord } from "@/lib/supabase";
import { exportAuditToCsv } from "@/lib/export/csv";

import { searchPanelState, type SearchTab } from "@/lib/searchTabs";
import { createDefaultInputs, VIABILITY_LABELS } from "@/lib/finance/constants";
import { analyzeAll } from "@/lib/finance/engine";
import { historyStore, createEntryId, type HistoryEntry } from "@/lib/storage/history";
import { loadDraft, saveDraft } from "@/lib/storage/draft";
import { checkCloudConnection } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthGate";
import { parseManualPrices, computeMarketStats } from "@/lib/mlu/statistics";
import { formatMoney, formatPct, formatRate, formatUyu } from "@/lib/format";
import {
  convertToUyu,
  describeRate,
  loadStoredRate,
  resolveExchangeRate,
  saveStoredRate,
  type ExchangeRate,
} from "@/lib/currency";

import type {
  AnalysisInputs,
  TaxSettings,
  MlChannelSettings,
  DirectChannelSettings,
} from "@/lib/finance/types";
import type {
  MarketStats,
  ExchangeRateResponse,
  ExactProductBlock,
  ExactSelection,
  UnsupportedListing,
} from "@/lib/mlu/types";

// Loaded on demand: none of these is needed to get the first verdict.
const UrlAnalyzer = lazy(() => import("@/components/search/UrlAnalyzer").then((m) => ({ default: m.UrlAnalyzer })));
const BatchAuditor = lazy(() => import("@/components/search/BatchAuditor").then((m) => ({ default: m.BatchAuditor })));
const SavedAuditsDrawer = lazy(() =>
  import("@/components/cloud/SavedAuditsDrawer").then((m) => ({ default: m.SavedAuditsDrawer }))
);
const AiAdvisor = lazy(() => import("@/components/ai/AiAdvisor").then((m) => ({ default: m.AiAdvisor })));

function PanelFallback() {
  return (
    <div
      role="status"
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-6 text-xs font-semibold text-zinc-600 dark:text-zinc-400"
    >
      Cargando…
    </div>
  );
}

type ToolId = "keyword" | "url" | "batch" | "copilot" | "cloud" | "history";

const TOOLS: { id: ToolId; label: string; Icon: typeof Bot }[] = [
  { id: "keyword", label: "Buscar precio de mercado", Icon: Search },
  { id: "url", label: "Analizar un enlace de Mercado Libre", Icon: Link2 },
  { id: "batch", label: "Cargar un catálogo CSV", Icon: FileSpreadsheet },
  { id: "copilot", label: "Preguntarle al copiloto", Icon: Bot },
  { id: "cloud", label: "Auditorías en la nube", Icon: Cloud },
  { id: "history", label: "Historial", Icon: History },
];

/** Stays true once `flag` has been true, so a lazy overlay keeps its state after closing. */
function useEverTrue(flag: boolean): boolean {
  const [ever, setEver] = useState(flag);
  if (flag && !ever) setEver(true);
  return ever;
}

export default function App() {
  const [inputs, setInputs] = useState<AnalysisInputs>(() => ({
    ...loadDraft(createDefaultInputs()),
    // La cotización nunca arranca de un valor por defecto: última guardada o ninguna.
    exchangeRate: loadStoredRate()?.rate ?? 0,
  }));
  const [marketState, setMarketState] = useState<MarketState>({ status: "idle" });
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [marketSource, setMarketSource] = useState<"mlu" | "manual" | null>(null);
  const [unsupportedListings, setUnsupportedListings] = useState<UnsupportedListing[]>([]);
  // Ofertas del producto de catálogo que coincide con la búsqueda. undefined = todavía no se buscó.
  const [exactBlock, setExactBlock] = useState<ExactProductBlock | null | undefined>(undefined);
  // Cómo se eligió (o por qué no se eligió) ese producto.
  const [exactSelection, setExactSelection] = useState<ExactSelection | null>(null);
  const [manualPrices, setManualPrices] = useState<string>("");

  const [searchLoading, setSearchLoading] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  // Cotización con su fecha y fuente. Arranca con la última guardada, marcada como no actualizada.
  const [rateMeta, setRateMeta] = useState<ExchangeRate | null>(() => {
    const stored = loadStoredRate();
    return stored ? { ...stored, stale: true } : null;
  });
  const [rateLoading, setRateLoading] = useState(false);

  // La cotización efectivamente en uso. Si el valor de la calculadora difiere del guardado
  // (por ejemplo durante una prueba de "si sube el dólar"), se trata como valor manual.
  const currentRate = useMemo<ExchangeRate | null>(() => {
    if (!(inputs.exchangeRate > 0)) return null;
    if (rateMeta && rateMeta.rate === inputs.exchangeRate) return rateMeta;
    return {
      rate: inputs.exchangeRate,
      referenceDate: new Date().toISOString().slice(0, 10),
      source: "manual",
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }, [inputs.exchangeRate, rateMeta]);
  const [copyFailed, setCopyFailed] = useState(false);

  const [aiAdvisorOpen, setAiAdvisorOpen] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("off");
  const auth = useAuth();

  const [searchTab, setSearchTab] = useState<SearchTab>("keyword");
  // Los paneles de Enlace y Lote se montan al abrirlos por primera vez y después solo se ocultan.
  const urlPanel = searchPanelState("url", searchTab, useEverTrue(searchTab === "url"));
  const batchPanel = searchPanelState("batch", searchTab, useEverTrue(searchTab === "batch"));
  const keywordPanel = searchPanelState("keyword", searchTab, true);
  const [savedAuditsOpen, setSavedAuditsOpen] = useState(false);
  const aiEverOpened = useEverTrue(aiAdvisorOpen);
  const auditsEverOpened = useEverTrue(savedAuditsOpen);

  const handleLoadCloudAudit = (audit: CloudAuditRecord) => {
    // Precio en pesos guardado; si no está, se convierte el original con su moneda. Nunca se asume.
    const converted =
      typeof audit.target_price === "number"
        ? convertToUyu(audit.target_price, audit.target_currency ?? "UYU", currentRate)
        : null;
    const targetPrice =
      audit.target_price_uyu && audit.target_price_uyu > 0
        ? audit.target_price_uyu
        : converted?.status === "ok"
          ? Math.round(converted.amountUyu)
          : 0;
    updateInputs({
      productName: audit.title,
      query: audit.title,
      ...(targetPrice > 0 ? { salePrice: targetPrice } : {}),
    });
    // Solo se cargan las estadísticas que la auditoría guardó. El promedio y los outliers no se guardan:
    // se muestran como "no disponible" en vez de reconstruirlos. Sin mínimo y máximo no se cargan.
    if (audit.competitor_median && audit.competitor_min && audit.competitor_max) {
      setStats({
        min: audit.competitor_min,
        median: audit.competitor_median,
        max: audit.competitor_max,
        average: null,
        sampleSize: audit.competitor_count ?? 0,
        outliersRemoved: null,
        fromCloud: true,
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

  // Keep the simulation in progress across reloads.
  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(inputs), 400);
    return () => window.clearTimeout(id);
  }, [inputs]);

  // Read-only check so the cloud indicator reflects the real connection.
  const checkCloud = useCallback(async () => {
    setCloudStatus("checking");
    const res = await checkCloudConnection();
    setCloudStatus(res.ok ? "ok" : res.configured ? "error" : "off");
  }, []);

  useEffect(() => {
    checkCloud();
  }, [checkCloud]);

  // Cotización del BCU (vía servidor). Si no llega: última guardada, marcada como no actualizada.
  // Si tampoco hay guardada: sin cotización, y se le pide el valor al usuario.
  const fetchRate = useCallback(
    async (force = false) => {
      setRateLoading(true);
      let fetched: ExchangeRate | null = null;
      let serverLastKnown: ExchangeRate | null = null;
      try {
        const res = await apiFetch(`/api/exchange-rate${force ? "?refresh=1" : ""}`);
        const data: ExchangeRateResponse = await res.json();
        if (data.ok && data.rate > 0) {
          const rate: ExchangeRate = {
            rate: data.rate,
            referenceDate: data.referenceDate,
            source: "bcu",
            fetchedAt: data.fetchedAt,
            stale: data.stale,
          };
          if (data.stale) serverLastKnown = rate;
          else fetched = rate;
        }
      } catch (e) {
        console.error("Failed to fetch exchange rate", e);
      }

      const resolution = resolveExchangeRate(fetched, serverLastKnown ?? loadStoredRate());
      setRateMeta(resolution.rate);
      if (resolution.status === "live") saveStoredRate(resolution.rate);
      updateInputs({ exchangeRate: resolution.rate?.rate ?? 0 });
      setRateLoading(false);
    },
    [updateInputs]
  );

  // Valor ingresado a mano en el encabezado.
  const handleManualRate = useCallback(
    (value: number) => {
      updateInputs({ exchangeRate: value });
      if (value > 0) {
        const manual: ExchangeRate = {
          rate: value,
          referenceDate: new Date().toISOString().slice(0, 10),
          source: "manual",
          fetchedAt: new Date().toISOString(),
          stale: false,
        };
        setRateMeta(manual);
        saveStoredRate(manual);
      } else {
        setRateMeta(null);
      }
    },
    [updateInputs]
  );

  useEffect(() => {
    fetchRate();
  }, [fetchRate]);

  // Handle Search in Mercado Libre Uruguay
  const searchAbortRef = useRef<AbortController | null>(null);
  const handleSearch = async (query: string) => {
    if (!query) return;
    // Una búsqueda nueva cancela la anterior: la respuesta vieja no pisa a la nueva.
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchLoading(true);
    setStatus("idle");
    setMarketState({ status: "loading", query });
    setExactBlock(undefined);

    try {
      const res = await apiFetch(
        `/api/search-mlu?q=${encodeURIComponent(query)}&rate=${inputs.exchangeRate}`,
        { signal: controller.signal }
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
          relevance: data.relevance ?? null,
        });

        setUnsupportedListings(Array.isArray(data.unsupported) ? data.unsupported : []);
        setExactBlock(data.exact ?? null);
        setExactSelection(data.exactSelection ?? null);
        // Sin productos que coincidan no hay estadística: no se arrastra la de una búsqueda anterior.
        setStats(data.stats ?? null);
        if (data.stats) {
          if (inputs.salePrice <= 0) {
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
      if (controller.signal.aborted) return; // reemplazada por una búsqueda más nueva
      console.error("Search failed", e);
      setStatus("manual");
      setMarketState({
        status: "error",
        query,
        error: { ok: false, code: "NETWORK", message: "Error de red al consultar Mercado Libre." },
      });
    } finally {
      if (searchAbortRef.current === controller) setSearchLoading(false);
    }
  };

  /**
   * Vacía el Radar (lista, estadísticas, ofertas exactas y precios manuales).
   * Se usa cuando el producto del simulador cambia por fuera del Radar ("Simular" en Lote o Por enlace)
   * y en "Nueva simulación": así el Radar nunca muestra resultados de otro producto.
   * Cambiar de pestaña no llama a esto.
   */
  const clearRadar = () => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setSearchLoading(false);
    setMarketState({ status: "idle" });
    setStats(null);
    setMarketSource(null);
    setUnsupportedListings([]);
    setExactBlock(undefined);
    setExactSelection(null);
    setManualPrices("");
    setStatus("idle");
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

  // Estadísticas del radar recalculadas con la cotización vigente: si cambia el dólar, cambian.
  // Solo entran los productos que coinciden con la búsqueda, sin excluir ninguno.
  // Si alguno de ellos está en dólares y no hay cotización, no se calcula nada.
  const liveStats = useMemo<MarketStats | null>(() => {
    if (marketSource !== "mlu" || marketState.status !== "success") return stats;
    const matching = marketState.items.filter((item) => item.match?.matches);
    const conversions = matching.map((item) => convertToUyu(item.price, item.currency, currentRate));
    if (conversions.some((c) => c.status === "no_rate")) return null;
    return computeMarketStats(
      conversions.flatMap((c) => (c.status === "ok" ? [c.amountUyu] : [])),
      { excludeOutliers: false }
    );
  }, [marketSource, marketState, stats, currentRate]);

  const analysis = analyzeAll(inputs);
  const bestChannel = analysis.ml.netProfit >= analysis.direct.netProfit ? "ml" : "direct";
  const winningChannelResult = bestChannel === "ml" ? analysis.ml : analysis.direct;
  const bestChannelLabel = bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia / POS";
  const isReady = inputs.salePrice > 0 && analysis.costs.landed > 0 && !(inputs.exchangeRate <= 0 && (inputs.cost.currency === "USD" || inputs.freight.currency === "USD"));
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
      market: liveStats
        ? {
            ...liveStats,
            total: marketState.status === "success" ? marketState.total : liveStats.sampleSize,
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
    if (historyStore.add(entry)) {
      setSaveFailed(false);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } else {
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 5000);
    }
  };

  const handleLoadEntry = (entry: HistoryEntry) => {
    setInputs(entry.inputs);
    // El Radar no queda con la búsqueda anterior; después se cargan las estadísticas que guardó la entrada.
    clearRadar();
    if (entry.market) {
      const { total, source, ...restStats } = entry.market;
      setStats(restStats);
      setMarketSource(source);
      setStatus("manual");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCopySummary = () => {
    const summary = `📊 Análisis de Rentabilidad UyMargin (${inputs.productName || inputs.query || "Producto"}):
- Costo Proveedor: ${formatMoney(inputs.cost.amount, inputs.cost.currency)} | Costo puesto: ${formatUyu(analysis.costs.landed)}
- Precio Venta Simulado: ${formatUyu(inputs.salePrice)}
- Ganancia Neta Mercado Libre: ${formatUyu(analysis.ml.netProfit)} (Margen: ${formatPct(analysis.ml.netMargin)})
- Ganancia Neta Tienda Propia: ${formatUyu(analysis.direct.netProfit)} (Margen: ${formatPct(analysis.direct.netMargin)})
- Canal más rentable: ${bestChannel === "ml" ? "Mercado Libre" : "Tienda Propia"} (${VIABILITY_LABELS[winningChannelResult.viability]})
- Régimen DGI: ${inputs.tax.regime === "literal_e" ? "Literal E" : "Régimen General"}`;

    navigator.clipboard.writeText(summary).then(
      () => {
        setCopyFailed(false);
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2000);
      },
      () => {
        setCopyFailed(true);
        setTimeout(() => setCopyFailed(false), 4000);
      }
    );
  };

  const handleShareWhatsApp = () => {
    const summary = `📊 *Auditoría UyMargin* - ${inputs.productName || inputs.query || "Producto"}
${{ loss: "🔴", tight: "🟡", good: "🟢", excellent: "🟢" }[winningChannelResult.viability]} *Resultado (${VIABILITY_LABELS[winningChannelResult.viability]}):* ${winningChannelResult.netProfit > 0 ? "Te quedan" : "Perdés"} ${formatUyu(Math.abs(winningChannelResult.netProfit))} ${winningChannelResult.netProfit > 0 ? "limpios " : ""}(${formatPct(winningChannelResult.netMargin)})
🏆 *Canal Ganador:* ${bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia / POS"}
💰 *Costo Puesto:* ${formatUyu(analysis.costs.landed)} (proveedor: ${formatMoney(inputs.cost.amount, inputs.cost.currency)})
🏷 *Precio de Venta:* ${formatUyu(inputs.salePrice)}
⚖ *Régimen DGI:* ${inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : "Régimen General"}
_Calculado con UyMargin - Analizador Mayorista Uruguay_`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(summary)}`;
    window.open(url, "_blank");
  };

  // Clears the product being analysed and the Radar; tax regime, channel settings and exchange rate stay.
  const handleNewSimulation = () => {
    setInputs((prev) => ({
      ...prev,
      productName: "",
      query: "",
      cost: { ...prev.cost, amount: 0 },
      freight: { ...prev.freight, amount: 0 },
      salePrice: 0,
    }));
    // El Lote y el análisis por enlace no se tocan: son listas de trabajo aparte del producto simulado.
    clearRadar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleExportCsv = () => {
    exportAuditToCsv(inputs, analysis.ml, analysis.direct, analysis.costs.landed);
  };

  const handlePrint = () => {
    window.print();
  };

  const rateIsUnreliable = !currentRate || currentRate.stale;
  // Cotización de más de 48 h: aviso reforzado con fecha y antigüedad (además del ámbar de la cinta).
  const rateAgeHours = currentRate ? (Date.now() - Date.parse(currentRate.fetchedAt)) / 3_600_000 : 0;
  const rateIsOld = !rateLoading && !!currentRate && Number.isFinite(rateAgeHours) && rateAgeHours > 48;
  const rateAgeText =
    rateAgeHours >= 72 ? `hace ${Math.floor(rateAgeHours / 24)} días` : `hace ${Math.floor(rateAgeHours)} horas`;
  const rateDateText = currentRate
    ? new Date(currentRate.referenceDate ? `${currentRate.referenceDate}T12:00:00` : currentRate.fetchedAt).toLocaleDateString("es-UY")
    : "";
  const rateNote = rateLoading ? "actualizando…" : currentRate ? describeRate(currentRate) : "falta la cotización";
  // Sin cotización, cualquier monto en dólares queda sin poder calcularse.
  const usesUsd = inputs.cost.currency === "USD" || inputs.freight.currency === "USD";
  const rateMissing = !currentRate;
  // Con costo o flete en dólares y sin cotización no hay nada confiable que mostrar.
  const resultPending = rateMissing && usesUsd;

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openTool = (id: ToolId) => {
    if (id === "copilot") return setAiAdvisorOpen(true);
    if (id === "cloud") return setSavedAuditsOpen(true);
    if (id === "history") return scrollToSection("historial");
    setSearchTab(id);
    // Wait for the tab to render before scrolling to it.
    requestAnimationFrame(() => scrollToSection("mercado"));
  };

  const renderTools = (visibility: string) => (
    <nav aria-label="Herramientas" className={`${visibility} flex-wrap items-center gap-2`}>
      <span className="mr-1 text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
        También podés:
      </span>
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => openTool(id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-surface px-3 py-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 transition-colors hover:border-black dark:hover:border-white cursor-pointer"
        >
          <Icon className="size-3.5" aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#f5f5f6] dark:bg-[#0c0c0e] text-[#121212] dark:text-[#f2f2f3] flex flex-col font-sans transition-colors bg-editorial-dots">
      <Header
        exchangeRate={inputs.exchangeRate}
        onExchangeRateChange={handleManualRate}
        rateLabel={currentRate ? describeRate(currentRate) : "Falta la cotización del dólar"}
        rateLoading={rateLoading}
        onRefreshRate={() => fetchRate(true)}
        status={status}
        cloudStatus={cloudStatus}
        onOpenAiAdvisor={() => setAiAdvisorOpen(true)}
        userEmail={auth.email}
        onSignOut={auth.signOut}
        onOpenSavedAudits={() => setSavedAuditsOpen(true)}
      />

      <main className={`mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pt-8 sm:px-6 lg:pb-8 ${isReady ? "pb-28" : "pb-8"}`}>
        {/* Architectural Executive Ribbon (inspired by reference layout) */}
        <section aria-label="Resumen Ejecutivo" className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-x-6 gap-y-4">
            {/* Left: Product & Sourcing */}
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
              <div className="flex size-11 sm:size-14 shrink-0 items-center justify-center bg-black text-white dark:bg-white dark:text-black font-black text-lg shadow-sm">
                <TrendingUp className="size-6 sm:size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                    {isReady ? "SIMULACIÓN ACTIVA" : "NUEVA SIMULACIÓN"}
                  </span>
                  <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
                    {inputs.tax.regime === "literal_e"
                      ? "LITERAL E"
                      : `RÉGIMEN GENERAL (IVA ${Math.round((inputs.tax.vatRate ?? 0.22) * 100)}%)`}
                  </span>
                </div>
                <h1
                  className="heading-grotesk text-xl sm:text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase mt-0.5 line-clamp-2 break-words"
                  title={inputs.productName || inputs.query || undefined}
                >
                  {inputs.productName || inputs.query || "Producto en Análisis"}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400 font-semibold uppercase tracking-wider">
                  <span className="whitespace-nowrap">Costo puesto: <strong className="text-black dark:text-white num">{formatUyu(analysis.costs.landed)}</strong></span>
                  <span className="whitespace-nowrap">Venta: <strong className="text-black dark:text-white num">{formatUyu(inputs.salePrice)}</strong></span>
                  <span>USD/UYU: <strong className="text-black dark:text-white num">{currentRate ? formatRate(currentRate.rate) : "—"}</strong>
                    {rateNote && (
                      <span
                        role="status"
                        className={`ml-1.5 normal-case tracking-normal ${rateIsUnreliable ? "font-bold text-amber-700 dark:text-amber-400" : "font-medium"}`}
                      >
                        ({rateNote})
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Quick Action Buttons */}
            <div className="grid grid-cols-2 min-[400px]:grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center xl:max-w-[34rem] xl:shrink-0 xl:justify-end [&>button]:justify-center">
              {(inputs.cost.amount > 0 || inputs.salePrice > 0 || inputs.productName) && (
                <button
                  type="button"
                  onClick={handleNewSimulation}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                  title="Empezar una simulación nueva (conserva régimen y canales)"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span>Nueva</span>
                </button>
              )}

              {isReady && (
                <>
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Descargar auditoría en formato Excel / CSV"
              >
                <FileSpreadsheet className="size-3.5 text-emerald-600" />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Imprimir / Exportar Ficha Oficial en PDF"
              >
                <Printer className="size-3.5" />
                <span>PDF</span>
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
                title="Copiar resumen al portapapeles"
              >
                {copiedSummary ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                <span>{copiedSummary ? "Copiado" : copyFailed ? "No se pudo copiar" : "Copiar"}</span>
              </button>

              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="flex items-center gap-1.5 rounded-md border border-emerald-600/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer"
                title="Compartir veredicto por WhatsApp"
              >
                <Share2 className="size-3.5" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={!isReady}
                className="flex items-center gap-1.5 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95"
              >
                {savedSuccess ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                <span>{savedSuccess ? "Guardado" : saveFailed ? "No se pudo guardar" : "Guardar"}</span>
              </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Desktop: tools up front. Mobile: after the verdict, so cost and price stay on the first screen. */}
        {renderTools("hidden lg:flex")}

        {rateMissing && !rateLoading && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
          >
            <p className="min-w-0 flex-1">
              <strong className="font-bold">No hay cotización del dólar.</strong> No se pudo consultar al BCU y no hay
              un valor guardado. Ingresá la cotización a mano: sin ella no se calcula ningún monto en dólares.
            </p>
            <button
              type="button"
              onClick={() => {
                const field = document.getElementById("header-rate");
                field?.scrollIntoView({ behavior: "smooth", block: "center" });
                field?.focus({ preventScroll: true });
              }}
              className="shrink-0 rounded-md bg-black px-3.5 py-2 text-xs font-black uppercase tracking-wider text-white dark:bg-white dark:text-black cursor-pointer"
            >
              Ingresar cotización
            </button>
          </div>
        )}

        {rateIsOld && currentRate && (
          <div
            role="alert"
            className="rounded-xl border-2 border-amber-500 bg-amber-500/15 p-4 text-sm text-amber-900 dark:text-amber-200"
          >
            <strong className="font-black">Cotización desactualizada.</strong> Estás usando el dólar a{" "}
            <span className="num font-bold">{formatRate(currentRate.rate)}</span> ({currentRate.source === "manual" ? "valor manual" : "BCU"}
            , del <span className="font-bold">{rateDateText}</span>, obtenida {rateAgeText}). Todo monto en dólares se
            calcula con ese valor. Actualizala con el botón del encabezado o ingresá la de hoy.
          </div>
        )}

        {/* Steps 1 and 2: what you pay, what you charge */}
        {/* Dos columnas recién desde xl: en tablet (hasta 1279 px) cada panel a media página queda demasiado angosto. */}
        <div className="grid gap-6 xl:grid-cols-2">
          <CostPanel
            inputs={inputs}
            costs={analysis.costs}
            onChange={updateInputs}
            onTaxChange={updateTax}
          />

          <PricingBar
            salePrice={inputs.salePrice}
            exchangeRate={inputs.exchangeRate}
            stats={liveStats}
            suggestedPrice={resultPending ? null : suggestedPrice}
            breakEvenPrice={!resultPending && Number.isFinite(minBreakEven) ? minBreakEven : null}
            onChange={(p) => updateInputs({ salePrice: p })}
            onFindMarketPrice={() => scrollToSection("mercado")}
          />
        </div>

        {/* Step 3: the verdict */}
        <ProfitHeroCard
          id="resultado"
          rateMissing={resultPending}
          inputs={inputs}
          analysis={analysis}
          bestChannel={bestChannel}
          targetMarginPrice={suggestedPrice}
          onSelectSalePrice={(p) => updateInputs({ salePrice: p })}
          onUpdateCostAmount={(newCost) => {
            updateInputs({ cost: { ...inputs.cost, amount: newCost } });
          }}
          onUpdateExchangeRate={(newRate) => {
            updateInputs({ exchangeRate: newRate });
          }}
        />

        {/* Riesgo: sensibilidad al dólar y escenarios (cerrados por defecto) */}
        <RiskTools inputs={inputs} analysis={analysis} bestChannel={bestChannel} rateMissing={resultPending} />

        {renderTools("flex lg:hidden")}

        {/* Channel battle */}
        {!resultPending && (
        <section aria-labelledby="channels-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="channels-heading" className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              Comparación por canal
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              ¿Dónde te conviene publicar considerando envíos, comisiones y pasarelas?
            </p>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChannelCard
              result={analysis.ml}
              icon={<ShoppingBag className="size-5" />}
              subtitle="Mercado Libre Uruguay (Comisión + Mercado Envíos + Cargo Fijo)"
              regime={inputs.tax.regime}
              vatRate={inputs.tax.vatRate ?? 0.22}
              isWinner={bestChannel === "ml" && isReady}
              settings={<MlSettings value={inputs.ml} onChange={updateMl} />}
            />

            <ChannelCard
              result={analysis.direct}
              icon={<Store className="size-5" />}
              subtitle="Tienda Propia / POS / Redes Sociales (Pasarela + Flete Local)"
              regime={inputs.tax.regime}
              vatRate={inputs.tax.vatRate ?? 0.22}
              isWinner={bestChannel === "direct" && isReady}
              settings={<DirectSettings value={inputs.direct} onChange={updateDirect} />}
            />
          </div>
        </section>

        )}

        {/* Strategic Bundle Optimizer (Anti-Cargo Fijo MLU & Multiplicador) */}
        {!resultPending && (
        <BundleOptimizer
          inputs={inputs}
          baseResult={analysis.ml}
          onApplyBundle={(bundlePrice, bundleTitle) => {
            updateInputs({
              salePrice: bundlePrice,
              productName: bundleTitle,
            });
            scrollToSection("resultado");
          }}
        />
        )}

        {/* Optional: market intelligence to pick a sale price */}
        <section id="mercado" aria-labelledby="market-heading" className="scroll-mt-24 flex flex-col gap-4">
          <div>
            <h2 id="market-heading" className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              Precio de mercado <span className="font-bold text-zinc-600 dark:text-zinc-400">· opcional</span>
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Buscá a cuánto se vende en Mercado Libre, analizá una publicación por enlace o cargá un catálogo completo.
            </p>
          </div>

          {/* Search Mode Tab Switcher */}
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-surface p-1.5 shadow-sm lg:max-w-xl">
            <button
              type="button"
              onClick={() => setSearchTab("keyword")}
              aria-pressed={searchTab === "keyword"}
              className={`flex-1 rounded-md px-2 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
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
              aria-pressed={searchTab === "url"}
              className={`flex-1 rounded-md px-2 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                searchTab === "url"
                  ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
              }`}
            >
              Por enlace
            </button>
            <button
              type="button"
              onClick={() => setSearchTab("batch")}
              aria-pressed={searchTab === "batch"}
              className={`flex-1 rounded-md px-2 py-2.5 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                searchTab === "batch"
                  ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
              }`}
            >
              Lote CSV
            </button>
          </div>

          {/* Los tres paneles quedan montados; los inactivos se ocultan sin desmontarse. */}
          <div className={keywordPanel.hidden ? "hidden" : "grid gap-6"} aria-hidden={keywordPanel.hidden || undefined}>
            <SearchPanel
              query={inputs.query}
              onQueryChange={(q) => updateInputs({ query: q })}
              onSearch={handleSearch}
              loading={searchLoading}
            />

            {marketState.status === "success" && exactBlock !== undefined && (
              <ExactOffersSection
                exact={exactBlock}
                selection={exactSelection}
                rate={currentRate}
                onSimulate={(p) => updateInputs({ salePrice: p })}
              />
            )}

            <MarketSummary
              state={marketState}
              stats={liveStats}
              rate={currentRate}
              unsupported={unsupportedListings}
              source={marketSource}
              manualPrices={manualPrices}
              onManualPricesChange={handleManualPricesChange}
              onSelectPrice={(p) => updateInputs({ salePrice: p })}
            />
          </div>

          {urlPanel.mounted && (
            <div className={urlPanel.hidden ? "hidden" : undefined} aria-hidden={urlPanel.hidden || undefined}>
              <Suspense fallback={<PanelFallback />}>
                <UrlAnalyzer
                  exchangeRate={inputs.exchangeRate}
                  rate={currentRate}
                  onSimulatePrice={(p, name) => {
                    // No cambia de pestaña ni borra el análisis: carga el producto y vacía el Radar.
                    updateInputs({ salePrice: p, productName: name, query: name });
                    clearRadar();
                    scrollToSection("resultado");
                  }}
                />
              </Suspense>
            </div>
          )}

          {batchPanel.mounted && (
            <div className={batchPanel.hidden ? "hidden" : undefined} aria-hidden={batchPanel.hidden || undefined}>
              <Suspense fallback={<PanelFallback />}>
                <BatchAuditor
                  baseInputs={inputs}
                  exchangeRate={inputs.exchangeRate}
                  onSimulateProduct={(simInputs) => {
                    // No cambia de pestaña ni borra el lote: carga el producto y vacía el Radar.
                    updateInputs(simInputs);
                    clearRadar();
                    scrollToSection("resultado");
                  }}
                />
              </Suspense>
            </div>
          )}
        </section>

        {/* History Vault Section */}
        <section id="historial" aria-label="Historial de Simulaciones" className="scroll-mt-24 mt-2">
          <HistorySection onLoadEntry={handleLoadEntry} />
        </section>
      </main>

      {isReady && (
        <StickyResultBar
          targetId="resultado"
          result={winningChannelResult}
          channelLabel={bestChannelLabel}
        />
      )}

      <Suspense fallback={null}>
      {/* AI Financial Advisor Drawer / Modal */}
      {aiEverOpened && (
      <AiAdvisor
        isOpen={aiAdvisorOpen}
        onClose={() => setAiAdvisorOpen(false)}
        inputs={inputs}
        analysis={analysis}
      />
      )}

      {/* Supabase Saved Audits Drawer */}
      {auditsEverOpened && (
      <SavedAuditsDrawer
        isOpen={savedAuditsOpen}
        onClose={() => setSavedAuditsOpen(false)}
        onLoadAudit={handleLoadCloudAudit}
      />
      )}
      </Suspense>
    </div>
  );
}
