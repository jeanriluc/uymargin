import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  ExternalLink,
  PackageSearch,
  Sigma,
  Truck,
  Users,
  Star,
  Sparkles,
  Store,
  Award,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { formatRate, formatUyu } from "@/lib/format";
import type { MarketStats, MluItem, MluSearchError, UnsupportedListing } from "@/lib/mlu/types";
import { convertToUyu, describeRate, type ExchangeRate } from "@/lib/currency";
import { PriceWithEquivalent } from "@/components/ui/PriceWithEquivalent";

export type MarketState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "success"; query: string; total: number; items: MluItem[] }
  | { status: "error"; query: string; error: MluSearchError };

interface MarketSummaryProps {
  state: MarketState;
  stats: MarketStats | null;
  /** Cotización en uso para pasar a pesos las publicaciones en dólares. */
  rate: ExchangeRate | null;
  /** Publicaciones en una moneda no soportada: se muestran, no se calculan. */
  unsupported?: UnsupportedListing[];
  source: "mlu" | "manual" | null;
  manualPrices: string;
  onManualPricesChange: (text: string) => void;
  onSelectPrice: (price: number) => void;
}

function StatCard({
  label,
  value,
  sublabel,
  highlight = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-col justify-between rounded-lg border p-3.5 transition-all ${
        onClick ? "cursor-pointer hover:border-black dark:hover:border-white" : ""
      } ${
        highlight
          ? "border-black bg-black text-white dark:bg-white dark:text-black shadow-sm"
          : "border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-black uppercase tracking-wider ${highlight ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-600 dark:text-zinc-400"}`}>
          {label}
        </span>
      </div>
      <div className="mt-2.5">
        <p className="num text-xl font-black tracking-tight">
          {value}
        </p>
        {sublabel && (
          <p className={`text-[11px] font-semibold uppercase tracking-wider mt-0.5 ${highlight ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-500 dark:text-zinc-400"}`}>
            {sublabel}
          </p>
        )}
      </div>
    </div>
  );
}

export function MarketSummary({
  state,
  stats,
  rate,
  unsupported = [],
  source,
  manualPrices,
  onManualPricesChange,
  onSelectPrice,
}: MarketSummaryProps) {
  const loading = state.status === "loading";
  const items = state.status === "success" ? state.items : [];
  const usdCount = items.filter((i) => i.currency === "USD").length;
  const total = state.status === "success" ? state.total : stats?.sampleSize ?? 0;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              Distribución de Precios de Competidores
            </h3>
          </div>
          {state.status === "success" && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              Auditoría activa para: <span className="font-bold text-black dark:text-white">“{state.query}”</span>
            </p>
          )}
        </div>

        {stats && stats.outliersRemoved > 0 && (
          <span className="inline-flex items-center gap-1 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
            {stats.outliersRemoved} OUTLIERS EXCLUIDOS (IQR)
          </span>
        )}
      </div>

      {state.status === "error" && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong className="font-bold">No hay precios de mercado para “{state.query}”.</strong>{" "}
            {state.error.message}
          </div>
        </div>
      )}

      {usdCount > 0 && !rate && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong className="font-bold">Falta la cotización del dólar.</strong> {usdCount} de {items.length}{" "}
            publicaciones están en dólares. No se calculó el rango de mercado: ingresá la cotización en el encabezado.
          </div>
        </div>
      )}

      {usdCount > 0 && rate && (
        <p className="mb-3 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
          {usdCount} de {items.length} publicaciones están en dólares. Para comparar se pasaron a pesos con:{" "}
          <span className={rate.stale ? "font-bold text-amber-700 dark:text-amber-400" : ""}>
            {describeRate(rate)} (<span className="num">{formatRate(rate.rate)}</span>)
          </span>
          .
        </p>
      )}

      {unsupported.length > 0 && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <p className="flex items-start gap-2 font-bold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {unsupported.length} {unsupported.length === 1 ? "publicación quedó" : "publicaciones quedaron"} fuera del
            cálculo por estar en una moneda que UyMargin no convierte.
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6">
            {unsupported.slice(0, 5).map((u) => (
              <li key={u.id}>
                <a href={u.permalink} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {u.title}
                </a>
                : <span className="num font-bold">{u.currency || "moneda sin indicar"} {u.price}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5 Architectural Stat Cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-2.5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))
        ) : (
          <>
            <StatCard
              label="MÍNIMO"
              value={stats ? formatUyu(stats.min) : "—"}
              sublabel="Tocá para simular"
              onClick={stats ? () => onSelectPrice(Math.round(stats.min)) : undefined}
            />
            <StatCard
              label="MEDIANA (FOCAL)"
              highlight
              value={stats ? formatUyu(stats.median) : "—"}
              sublabel="Sugerida"
              onClick={stats ? () => onSelectPrice(Math.round(stats.median)) : undefined}
            />
            <StatCard
              label="PROMEDIO"
              value={stats ? formatUyu(stats.average) : "—"}
              onClick={stats ? () => onSelectPrice(Math.round(stats.average)) : undefined}
            />
            <StatCard
              label="MÁXIMO"
              value={stats ? formatUyu(stats.max) : "—"}
              onClick={stats ? () => onSelectPrice(Math.round(stats.max)) : undefined}
            />
            <StatCard
              label="OFERTAS"
              value={stats || state.status === "success" ? total.toLocaleString("es-UY") : "—"}
              sublabel="Muestra real con stock"
            />
          </>
        )}
      </div>

      {/* Manual Prices fallback section */}
      <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <details className="group" open={state.status === "error" || undefined}>
          <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white uppercase tracking-wider">
            <span>Editor Manual de Precios de la Competencia</span>
            <span className="text-[11px] font-black group-open:hidden underline underline-offset-4">+ ABRIR</span>
          </summary>
          <div className="mt-3">
            <textarea
              id="manual-prices"
              aria-label="Precios de la competencia, separados por coma o salto de línea"
              rows={2}
              value={manualPrices}
              onChange={(e) => onManualPricesChange(e.target.value)}
              placeholder="Ej: 1290  1450  1350  1890 (separados por espacio o coma)"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs num font-semibold text-zinc-900 dark:text-zinc-100 outline-none focus:border-black dark:focus:border-white"
            />
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-1">
              Los precios cargados recalculan al instante el rango de mercado y la mediana en pesos uruguayos.
            </p>
          </div>
        </details>
      </div>

      {/* Live item thumbnails & links with pre-click quality & reviews info */}
      {items.length > 0 && (
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Publicaciones Reales Verificadas con Stock en Uruguay
              </h4>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.2 text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase whitespace-nowrap">
                <span className="size-1.5 rounded-full bg-emerald-500"></span> 100% Stock Activo
              </span>
            </div>
            {state.status === "success" && state.query && (
              <a
                href={`https://listado.mercadolibre.com.uy/${encodeURIComponent(state.query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline"
              >
                <span>Ver listado completo en mercadolibre.com.uy</span>
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
            {items.slice(0, 9).map((item) => (
              <div
                key={item.id}
                className="group flex min-w-0 flex-col justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/40 p-3 transition-all hover:border-black dark:hover:border-white hover:shadow-sm"
              >
                <div>
                  {/* Top badges: Stock & Store Quality */}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-black uppercase text-emerald-700 dark:text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-500"></span> En Stock
                    </span>

                    <div className="flex items-center gap-1">
                      {item.sellerBadge === "Tienda Oficial" ? (
                        <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase">
                          Oficial
                        </span>
                      ) : item.sellerBadge === "MercadoLíder Platinum" ? (
                        <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">
                          Platinum
                        </span>
                      ) : item.sellerBadge === "MercadoLíder Gold" ? (
                        <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase">
                          Gold
                        </span>
                      ) : null}

                      {item.isTopChoice && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-black text-white dark:bg-white dark:text-black px-1.5 py-0.2 text-[11px] font-black uppercase">
                          <Sparkles className="size-2" /> Top
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Thumbnail & Title */}
                  <div className="flex items-start gap-2.5">
                    <div className="relative size-12 shrink-0 rounded bg-white overflow-hidden p-0.5 border border-zinc-200 dark:border-zinc-700 shadow-2xs">
                      {item.thumbnail ? (
                        <img loading="lazy" decoding="async" src={item.thumbnail} alt="" className="size-full object-contain" />
                      ) : (
                        <PackageSearch className="m-auto size-5 text-zinc-500 dark:text-zinc-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-2 text-xs font-bold leading-snug text-zinc-800 dark:text-zinc-200 hover:underline"
                        title={item.title}
                      >
                        {item.title}
                      </a>
                    </div>
                  </div>

                  {/* Pre-click seller reputation, sales & reviews */}
                  <div className="mt-2.5 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400 font-medium" title={item.seller || undefined}>
                      {item.seller || "Vendedor sin identificar"}
                    </span>
                    {item.ratingAverage != null && (
                      <div className="flex shrink-0 items-center gap-1 font-black text-amber-700 dark:text-amber-400">
                      <Star className="size-2.5 fill-amber-500 text-amber-500" />
                      <span>{item.ratingAverage}</span>
                      {item.reviewsCount != null && <span className="text-zinc-500 dark:text-zinc-400 text-[11px] font-normal">({item.reviewsCount})</span>}
                    </div>
                    )}
                  </div>
                </div>

                {/* Price, Shipping & Actions */}
                <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-zinc-200/60 dark:border-zinc-800/60 pt-2">
                  <div className="min-w-0">
                    <PriceWithEquivalent amount={item.price} currency={item.currency} rate={rate} />
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5">
                      {item.salesVolume && (
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                          {item.salesVolume}
                        </span>
                      )}
                      {item.freeShipping && (
                        <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-black uppercase text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 px-1 rounded">
                          <Truck className="size-2" aria-hidden /> Envío gratis
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={convertToUyu(item.price, item.currency, rate).status !== "ok"}
                      onClick={() => {
                        // El simulador trabaja en pesos: una publicación en dólares entra convertida.
                        const c = convertToUyu(item.price, item.currency, rate);
                        if (c.status === "ok") onSelectPrice(Math.round(c.amountUyu));
                      }}
                      title={
                        convertToUyu(item.price, item.currency, rate).status === "ok"
                          ? "Simular con este precio de venta (en pesos)"
                          : "No se puede simular: falta la cotización o la moneda no es reconocida"
                      }
                      className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:pointer-events-none hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white cursor-pointer"
                    >
                      Simular
                    </button>
                    <a
                      href={item.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ver en Mercado Libre"
                      aria-label={`Ver ${item.title} en Mercado Libre`}
                      className="tap-target inline-flex size-8 items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
