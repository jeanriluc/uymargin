"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  TrendingDown,
  TrendingUp,
  X,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Store,
  Award,
  Trash2,
  Play,
  Pause,
  Download,
  AlertTriangle,
  Plus,
  ArrowRight,
  Calculator,
  Sliders,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { TrackedCompetitor, TriggeredAlert } from "@/lib/tracking/types";
import {
  getTrackedCompetitors,
  saveTrackedList,
  removeTrackedCompetitor,
  updateCompetitorSettings,
  markAlertAsRead,
  markAllAlertsAsRead,
  getTrackingStats,
  exportTrackingHistoryCsv,
  addOrUpdateTrackedCompetitor,
} from "@/lib/tracking/storage";
import { formatMoney, formatUyu, formatPct } from "@/lib/format";

interface CompetitorTrackingDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPriceForSimulation?: (price: number, title?: string) => void;
  exchangeRate?: number;
  currentProductTitle?: string;
  currentProductLandedCost?: number;
}

export function CompetitorTrackingDrawer({
  isOpen,
  onClose,
  onSelectPriceForSimulation,
  exchangeRate = 40,
  currentProductTitle,
  currentProductLandedCost,
}: CompetitorTrackingDrawerProps) {
  const [items, setItems] = useState<TrackedCompetitor[]>([]);
  const [stats, setStats] = useState(getTrackingStats());
  const [activeTab, setActiveTab] = useState<"tracked" | "alerts" | "add">("tracked");
  const [checking, setChecking] = useState(false);
  const [checkStatusMessage, setCheckStatusMessage] = useState<string | null>(null);
  
  // New item manual input
  const [newUrl, setNewUrl] = useState("");
  const [addingLoading, setAddingLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Sync state when drawer opens or updates
  useEffect(() => {
    if (isOpen) {
      refreshLocal();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleUpdate = () => refreshLocal();
    window.addEventListener("uymargin_tracking_updated", handleUpdate);
    return () => window.removeEventListener("uymargin_tracking_updated", handleUpdate);
  }, []);

  const refreshLocal = () => {
    const data = getTrackedCompetitors();
    setItems(data);
    setStats(getTrackingStats());
  };

  // Run live price check against MLU
  const handleCheckAllLive = async () => {
    if (items.length === 0 || checking) return;
    setChecking(true);
    setCheckStatusMessage("Consultando precios en vivo con Mercado Libre Uruguay...");

    try {
      const res = await fetch("/api/tracking/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, exchangeRate }),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.ok && Array.isArray(result.updatedItems)) {
          saveTrackedList(result.updatedItems);
          setItems(result.updatedItems);
          setStats(getTrackingStats());
          const newAlerts = result.alerts?.length || 0;
          setCheckStatusMessage(
            newAlerts > 0
              ? `¡Actualizado! Se detectaron ${newAlerts} variaciones/alertas de precio.`
              : `Precios verificados. Todos los competidores están al día.`
          );
        }
      } else {
        setCheckStatusMessage("No se pudo verificar algunos precios. Reintentando...");
      }
    } catch (e) {
      console.error("Tracking check failed", e);
      setCheckStatusMessage("Error al conectar con la API de Mercado Libre.");
    } finally {
      setChecking(false);
      setTimeout(() => setCheckStatusMessage(null), 6000);
    }
  };

  // Add new item via URL analyzer
  const handleAddManualUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim() || addingLoading) return;

    setAddingLoading(true);
    setAddError(null);

    try {
      const res = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim(), rate: exchangeRate }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok || !data.targetProduct) {
        throw new Error(data.message || "No se pudo extraer la publicación.");
      }

      const p = data.targetProduct;
      const newItem = addOrUpdateTrackedCompetitor({
        id: p.id || `MLU_${Date.now()}`,
        productId: p.id,
        title: p.title,
        permalink: p.permalink,
        thumbnail: p.thumbnail,
        seller: p.seller,
        sellerBadge: p.sellerBadge,
        sellerCity: p.sellerCity,
        currency: p.currency,
        initialPrice: p.priceUyu || p.price,
        currentPrice: p.priceUyu || p.price,
        inStock: p.isAvailable !== false,
        alertThresholdPct: 5,
        alertOnDrop: true,
        alertOnMarginRisk: true,
        myTargetMarginPct: 20,
        myLandedCostUyu: currentProductLandedCost,
      });

      setNewUrl("");
      setActiveTab("tracked");
      refreshLocal();
    } catch (err: any) {
      setAddError(err?.message || "Error al analizar el enlace de Mercado Libre.");
    } finally {
      setAddingLoading(false);
    }
  };

  const handleExportCsv = () => {
    const csv = exportTrackingHistoryCsv(items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `uymargin_competitor_tracking_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Render SVG Price Chart Sparkline
  const renderPriceSparkline = (item: TrackedCompetitor) => {
    const history = item.priceHistory || [];
    if (history.length < 2) return null;

    const prices = history.map((h) => h.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    const width = 280;
    const height = 55;
    const padding = 10;

    const points = history.map((h, i) => {
      const x = padding + (i / (history.length - 1)) * (width - padding * 2);
      const y = height - padding - ((h.price - minP) / range) * (height - padding * 2);
      return `${x},${y}`;
    }).join(" ");

    const isDropping = item.currentPrice < item.initialPrice;

    return (
      <div className="mt-2.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-2.5">
        <div className="flex items-center justify-between text-[10px] text-zinc-500 font-semibold mb-1">
          <span>Evolución en el tiempo</span>
          <span className={isDropping ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-zinc-600 dark:text-zinc-300"}>
            Min: {formatUyu(minP)} | Max: {formatUyu(maxP)}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12 overflow-visible">
          {/* Trend Line */}
          <polyline
            fill="none"
            stroke={isDropping ? "#10b981" : "#6366f1"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
          {/* Circles for points */}
          {history.map((h, i) => {
            const x = padding + (i / (history.length - 1)) * (width - padding * 2);
            const y = height - padding - ((h.price - minP) / range) * (height - padding * 2);
            const isLast = i === history.length - 1;
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={isLast ? "4" : "2.5"}
                  fill={isLast ? (isDropping ? "#10b981" : "#6366f1") : "#9ca3af"}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      {/* Backdrop click */}
      <div className="flex-1" onClick={onClose} />

      {/* Drawer Container */}
      <div className="w-full max-w-2xl bg-white dark:bg-[#111113] border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-lg bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-black">
              <Bell className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="heading-grotesk text-base font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                  Radar de Tracking & Alertas MLU
                </h2>
                {stats.unreadAlertsCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
                    {stats.unreadAlertsCount} nuevas
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 font-medium">
                Monitoreo continuo de precios, caídas agresivas y riesgo de margen en Uruguay
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCheckAllLive}
              disabled={checking || items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase rounded-md bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-black transition-all cursor-pointer disabled:opacity-50"
              title="Consultar precios en tiempo real ahora"
            >
              <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Comprobar en Vivo</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Live status notification toast */}
        {checkStatusMessage && (
          <div className="px-5 py-2.5 bg-indigo-500/10 border-b border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Sparkles className="size-3.5 shrink-0" />
            <span>{checkStatusMessage}</span>
          </div>
        )}

        {/* KPI Summary Bar */}
        <div className="grid grid-cols-4 gap-2 p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113]">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50 dark:bg-zinc-900/40">
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400 block">Monitoreados</span>
            <span className="text-lg font-black text-zinc-900 dark:text-zinc-100 num">{stats.totalTracked}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50 dark:bg-zinc-900/40">
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400 block">Caídas Precio</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 num">{stats.priceDropsCount}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50 dark:bg-zinc-900/40">
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400 block">Alertas Activas</span>
            <span className="text-lg font-black text-amber-600 dark:text-amber-400 num">{stats.activeAlertsCount}</span>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 bg-zinc-50 dark:bg-zinc-900/40">
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400 block">Variación Prom.</span>
            <span className={`text-lg font-black num ${stats.averageVariationPct < 0 ? "text-emerald-600" : "text-zinc-900 dark:text-zinc-100"}`}>
              {formatPct(stats.averageVariationPct)}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-4 pt-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113]">
          <button
            onClick={() => setActiveTab("tracked")}
            className={`pb-2.5 px-2 text-xs font-black uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === "tracked"
                ? "border-black dark:border-white text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Competidores ({items.length})
          </button>
          <button
            onClick={() => setActiveTab("alerts")}
            className={`pb-2.5 px-2 text-xs font-black uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeTab === "alerts"
                ? "border-black dark:border-white text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <span>Feed de Alertas</span>
            {stats.unreadAlertsCount > 0 && (
              <span className="size-2 rounded-full bg-red-500" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("add")}
            className={`pb-2.5 px-2 text-xs font-black uppercase tracking-wider transition-all border-b-2 cursor-pointer flex items-center gap-1 ${
              activeTab === "add"
                ? "border-black dark:border-white text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <Plus className="size-3" />
            <span>Añadir Link MLU</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* TAB 1: TRACKED COMPETITORS */}
          {activeTab === "tracked" && (
            <div className="space-y-3.5">
              {items.length === 0 ? (
                <div className="p-8 text-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
                  <Bell className="size-10 mx-auto text-zinc-400 mb-2" />
                  <h3 className="font-bold text-zinc-800 dark:text-zinc-200">No hay competidores en seguimiento</h3>
                  <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                    Añade publicaciones desde el radar de búsqueda o pega un enlace directo de Mercado Libre Uruguay para recibir alertas automáticas si bajan el precio.
                  </p>
                  <button
                    onClick={() => setActiveTab("add")}
                    className="mt-4 px-4 py-2 bg-black text-white dark:bg-white dark:text-black font-black text-xs uppercase rounded-md"
                  >
                    Añadir Primera Publicación
                  </button>
                </div>
              ) : (
                items.map((item) => {
                  const dropPct = item.initialPrice > 0
                    ? (((item.currentPrice - item.initialPrice) / item.initialPrice) * 100)
                    : 0;
                  const isDropping = dropPct < 0;

                  // Projected margin if matching competitor's price
                  const landed = item.myLandedCostUyu || currentProductLandedCost || 0;
                  const estProfit = landed > 0 ? (item.currentPrice - landed - (item.currentPrice * 0.14)) : 0;
                  const estMargin = item.currentPrice > 0 && landed > 0 ? (estProfit / item.currentPrice) * 100 : 0;
                  const marginAtRisk = estMargin > 0 && item.myTargetMarginPct && estMargin < item.myTargetMarginPct;

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/40 p-4 transition-all hover:border-zinc-400 dark:hover:border-zinc-600"
                    >
                      {/* Top Badges & Status */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.sellerBadge === "Tienda Oficial" ? (
                            <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1">
                              <Store className="size-2.5" /> Oficial
                            </span>
                          ) : item.sellerBadge === "MercadoLíder Platinum" ? (
                            <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1">
                              <Award className="size-2.5" /> Platinum
                            </span>
                          ) : (
                            <span className="rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 text-[9px] font-black text-zinc-700 dark:text-zinc-300 uppercase">
                              {item.seller}
                            </span>
                          )}

                          {item.inStock ? (
                            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <span className="size-1.5 rounded-full bg-emerald-500" /> En Stock
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-red-500 flex items-center gap-1">
                              <span className="size-1.5 rounded-full bg-red-500" /> Sin Stock / Pausado
                            </span>
                          )}
                        </div>

                        {/* Status chip */}
                        {item.status === "alert_triggered" ? (
                          <span className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle className="size-2.5" /> Alerta Activa
                          </span>
                        ) : item.status === "paused" ? (
                          <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-500 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full">
                            Pausado
                          </span>
                        ) : (
                          <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full">
                            Monitoreando
                          </span>
                        )}
                      </div>

                      {/* Product Thumbnail & Title */}
                      <div className="flex items-start gap-3">
                        <div className="size-14 shrink-0 rounded-lg bg-white overflow-hidden p-1 border border-zinc-200 dark:border-zinc-700">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="size-full object-contain" />
                          ) : (
                            <div className="size-full flex items-center justify-center text-zinc-400 text-xs font-bold">MLU</div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <a
                            href={item.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-xs text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2 hover:underline flex items-center gap-1"
                          >
                            <span>{item.title}</span>
                            <ExternalLink className="size-3 shrink-0 text-zinc-400" />
                          </a>

                          {/* Prices bar */}
                          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
                            <div>
                              <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Precio Actual</span>
                              <span className="text-base font-black text-black dark:text-white num">
                                {formatUyu(item.currentPrice)}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Precio Base</span>
                              <span className="text-xs font-bold text-zinc-500 num line-through">
                                {formatUyu(item.initialPrice)}
                              </span>
                            </div>

                            {dropPct !== 0 && (
                              <div className="flex items-center gap-1">
                                {isDropping ? (
                                  <span className="inline-flex items-center gap-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                    <TrendingDown className="size-3" /> {formatPct(dropPct)}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-xs font-black text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                                    <TrendingUp className="size-3" /> +{formatPct(dropPct)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Sparkline Chart */}
                      {renderPriceSparkline(item)}

                      {/* Margin impact preview if landed cost exists */}
                      {landed > 0 && (
                        <div className={`mt-2.5 p-2 rounded-lg border text-xs flex items-center justify-between ${
                          marginAtRisk
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-200"
                            : "bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
                        }`}>
                          <div className="flex items-center gap-1.5">
                            {marginAtRisk ? (
                              <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                            ) : (
                              <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                            )}
                            <span>
                              Si igualas este precio ({formatUyu(item.currentPrice)}), tu margen neto queda en:{" "}
                              <strong className="font-black">{formatPct(estMargin)}</strong> ({formatUyu(estProfit)} en mano)
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Footer Actions */}
                      <div className="mt-3 pt-2.5 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between gap-2 flex-wrap text-xs">
                        {/* Alert sensitivity badge */}
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                          <span>Alerta si cae &gt;</span>
                          <select
                            value={item.alertThresholdPct}
                            onChange={(e) => updateCompetitorSettings(item.id, { alertThresholdPct: Number(e.target.value) })}
                            className="bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[10px] font-bold text-zinc-800 dark:text-zinc-200"
                          >
                            <option value={3}>3%</option>
                            <option value={5}>5%</option>
                            <option value={10}>10%</option>
                            <option value={15}>15%</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {onSelectPriceForSimulation && (
                            <button
                              onClick={() => {
                                onSelectPriceForSimulation(item.currentPrice, item.title);
                                onClose();
                              }}
                              className="px-2.5 py-1 bg-black text-white dark:bg-white dark:text-black font-black text-[10px] uppercase rounded hover:opacity-90 transition-opacity flex items-center gap-1 cursor-pointer"
                              title="Cargar este precio en la calculadora financiera"
                            >
                              <Calculator className="size-2.5" />
                              <span>Simular</span>
                            </button>
                          )}

                          <button
                            onClick={() => updateCompetitorSettings(item.id, { status: item.status === "paused" ? "active" : "paused" })}
                            className="p-1 rounded text-zinc-400 hover:text-black dark:hover:text-white cursor-pointer"
                            title={item.status === "paused" ? "Reanudar tracking" : "Pausar tracking"}
                          >
                            {item.status === "paused" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                          </button>

                          <button
                            onClick={() => removeTrackedCompetitor(item.id)}
                            className="p-1 rounded text-zinc-400 hover:text-red-500 cursor-pointer"
                            title="Eliminar del radar"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: ALERTS FEED */}
          {activeTab === "alerts" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Historial de Alertas</span>
                <button
                  onClick={markAllAlertsAsRead}
                  className="text-[11px] font-black uppercase text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  Marcar todas como leídas
                </button>
              </div>

              {items.flatMap((item) => item.triggeredAlerts).length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-xs">
                  No hay alertas registradas aún. El sistema te notificará cuando se detecten caídas de precios o riesgos de margen.
                </div>
              ) : (
                items.flatMap((item) => item.triggeredAlerts).map((alert) => (
                  <div
                    key={alert.id}
                    onClick={() => markAlertAsRead(alert.competitorId, alert.id)}
                    className={`rounded-lg border p-3.5 transition-all cursor-pointer ${
                      alert.read
                        ? "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 text-zinc-600 dark:text-zinc-400"
                        : "border-amber-400 dark:border-amber-600 bg-amber-500/5 text-zinc-900 dark:text-zinc-100 shadow-xs"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] mb-1">
                      <span className="font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="size-3" />
                        {alert.type === "price_drop" ? "Caída de Precio MLU" : "Riesgo de Margen"}
                      </span>
                      <span className="text-zinc-400 font-medium">
                        {new Date(alert.date).toLocaleDateString("es-UY", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs font-semibold leading-relaxed">{alert.message}</p>
                    <div className="mt-2 text-[10px] text-zinc-400 font-medium truncate">
                      Publicación: {alert.competitorTitle}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: ADD DIRECT MLU LINK */}
          {activeTab === "add" && (
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/40">
              <h3 className="font-black text-sm uppercase text-zinc-900 dark:text-zinc-100 mb-1">
                Añadir Publicación de Mercado Libre Uruguay
              </h3>
              <p className="text-xs text-zinc-500 mb-4">
                Pega la URL completa de cualquier publicación en mercadolibre.com.uy para comenzar a monitorear sus precios y reputación.
              </p>

              <form onSubmit={handleAddManualUrl} className="space-y-3">
                <div>
                  <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block mb-1">
                    Enlace de Mercado Libre
                  </label>
                  <input
                    type="url"
                    placeholder="https://articulo.mercadolibre.com.uy/MLU-... o https://www.mercadolibre.com.uy/p/MLU..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    required
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
                  />
                </div>

                {addError && (
                  <p className="text-xs text-red-500 font-semibold">{addError}</p>
                )}

                <button
                  type="submit"
                  disabled={addingLoading || !newUrl.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-black text-white dark:bg-white dark:text-black font-black text-xs uppercase rounded-md hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  {addingLoading ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  <span>{addingLoading ? "Analizando publicación..." : "Comenzar a Seguir"}</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 flex items-center justify-between">
          <button
            onClick={handleExportCsv}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="size-3.5" />
            <span>Exportar Historial (CSV)</span>
          </button>

          <span className="text-[10px] text-zinc-400 font-medium">
            UyMargin Engine · Datos en vivo MLU
          </span>
        </div>
      </div>
    </div>
  );
}
