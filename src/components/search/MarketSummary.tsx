import { AlertTriangle, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { formatRate, formatUyu } from "@/lib/format";
import type { MarketStats, MluItem, MluSearchError, RadarRelevance, UnsupportedListing } from "@/lib/mlu/types";
import { convertToUyu, describeRate, type ExchangeRate } from "@/lib/currency";
import { broadenQuery } from "@/lib/mlu/broaden";
import { assessMarketData } from "@/lib/mlu/reliability";
import { FAR_FROM_MEDIAN_FACTOR, isFarFromMedian } from "@/lib/mlu/statistics";
import { CatalogProductCard } from "@/components/search/CatalogProductCard";

export type MarketState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "success"; query: string; total: number; items: MluItem[]; relevance: RadarRelevance | null }
  | { status: "error"; query: string; error: MluSearchError };

interface MarketSummaryProps {
  state: MarketState;
  stats: MarketStats | null;
  /** Cotización en uso para pasar a pesos las publicaciones en dólares. */
  rate: ExchangeRate | null;
  /** Publicaciones en una moneda no soportada: se muestran, no se calculan. */
  unsupported?: UnsupportedListing[];
  /** De dónde salen las estadísticas: el radar de Mercado Libre o los precios cargados a mano. */
  source: "mlu" | "manual" | null;
  manualPrices: string;
  onManualPricesChange: (text: string) => void;
  /** `image`: foto del producto de la tarjeta elegida (null si no tiene). Sin indicar: precio de las estadísticas. */
  onSelectPrice: (price: number, image?: string | null) => void;
  /** Buscar de nuevo con un nombre más corto. Solo se llama cuando el usuario toca el botón. */
  onBroaden?: (query: string) => void;
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
      // Cada tarjeta crece para completar su fila: con cinco indicadores no queda un hueco al final.
      className={`flex min-w-0 flex-[1_1_7.5rem] flex-col justify-between rounded-lg border p-3.5 transition-all ${
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

/** Con menos productos que esto, mínimo, mediana y máximo se muestran como referencia, no como rango. */
const SMALL_SAMPLE = 3;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("es-UY")} ${count === 1 ? one : many}`;
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
  onBroaden,
}: MarketSummaryProps) {
  const loading = state.status === "loading";
  const items = state.status === "success" ? state.items : [];
  const total = state.status === "success" ? state.total : stats?.sampleSize ?? 0;

  // Radar por nombre: solo los productos que coinciden con la búsqueda alimentan las estadísticas.
  const fromRadar = state.status === "success" && source === "mlu";
  const relevance = state.status === "success" ? state.relevance : null;
  const matching = items.filter((i) => i.match?.matches);
  const related = items.filter((i) => !i.match?.matches);
  const matchingOffers = matching.reduce((acc, i) => acc + (i.activeSellersCount ?? 0), 0);
  const smallSample = fromRadar && matching.length > 0 && matching.length < SMALL_SAMPLE;
  // Solo los que coinciden entran al rango: son los que importan para la conversión a pesos.
  const usdCount = matching.filter((i) => i.currency === "USD").length;
  // Marca "precio muy distinto a la mediana": solo señala, no saca a nadie de las estadísticas.
  const isFar = (item: MluItem) => {
    if (!fromRadar || !stats) return false;
    const c = convertToUyu(item.price, item.currency, rate);
    return c.status === "ok" && isFarFromMedian(c.amountUyu, stats.median);
  };
  const farCount = matching.filter(isFar).length;
  // Confiabilidad del dato: describe los precios que coinciden, no cambia ninguna estadística.
  const reliability = fromRadar && stats
    ? assessMarketData(
        matching.flatMap((i) => { const c = convertToUyu(i.price, i.currency, rate); return c.status === "ok" ? [c.amountUyu] : []; }),
        matching.filter((i) => i.condition === "used").length
      )
    : null;
  // Sin precios para lo buscado: se ofrece (no se ejecuta sola) una búsqueda con el nombre más corto.
  const noPrices =
    (state.status === "error" && state.error.code === "NO_RESULTS") || (fromRadar && matching.length === 0);
  const shorterQuery = noPrices && onBroaden && (state.status === "error" || state.status === "success") ? broadenQuery(state.query) : null;
  const quoted = (terms: string[]) => terms.map((t) => `«${t}»`).join(", ");

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

        {reliability && (
          <span
            data-reliability={reliability.level}
            title={reliability.reasons.length > 0 ? `Porque ${reliability.reasons.join(" y ")}.` : "Varios precios y parecidos entre sí."}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-black uppercase tracking-wider ${
              reliability.level === "solid"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            }`}
          >
            {reliability.label}
          </span>
        )}

        {stats && stats.outliersRemoved != null && stats.outliersRemoved > 0 && (
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

      {shorterQuery && onBroaden && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3 text-xs text-zinc-700 dark:text-zinc-300">
          <span>No hubo precios con el nombre completo. Podés ampliar la búsqueda sacando la medida o el detalle:</span>
          <button
            type="button"
            data-broaden
            onClick={() => onBroaden(shorterQuery)}
            className="rounded-md bg-black px-3 py-2 text-xs font-black text-white dark:bg-white dark:text-black cursor-pointer hover:opacity-90"
          >
            Probar con «{shorterQuery}»
          </button>
        </div>
      )}

      {usdCount > 0 && !rate && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong className="font-bold">Falta la cotización del dólar.</strong> {usdCount} de {matching.length}{" "}
            productos que coinciden tienen su oferta más barata en dólares. No se calculó el rango de mercado: ingresá la cotización en el encabezado.
          </div>
        </div>
      )}

      {usdCount > 0 && rate && (
        <p className="mb-3 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
          {usdCount} de {matching.length} productos que coinciden tienen su oferta más barata en dólares. Para comparar
          se pasaron a pesos con:{" "}
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

      {fromRadar && (
        <div className="mb-4 space-y-2.5">
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            <strong className="font-bold text-zinc-800 dark:text-zinc-200">Cómo se arma este rango:</strong> un producto
            coincide cuando su nombre o su ficha en Mercado Libre mencionan todo lo que buscaste
            {relevance && relevance.terms.length > 0 && <> ({quoted(relevance.terms)})</>}. El mínimo, la mediana, el
            promedio y el máximo usan solo esos productos, cada uno con el precio de su oferta activa más barata.
          </p>

          {relevance?.searchUnavailable && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <strong className="font-bold">La búsqueda por palabras de Mercado Libre no respondió.</strong> Solo se
                revisaron los más vendidos de la categoría, así que pueden faltar productos que coinciden. Volvé a
                buscar en unos segundos.
              </div>
            </div>
          )}

          {matching.length === 0 && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <strong className="font-bold">Ningún producto con ofertas activas coincide con “{state.query}”.</strong>{" "}
                No se calculó mínimo, mediana ni máximo.
                {related.length > 0 &&
                  ` Abajo ${related.length === 1 ? "queda 1 producto relacionado" : `quedan ${related.length} productos relacionados`}, solo como referencia.`}{" "}
                Probá con menos palabras o cargá los precios a mano.
              </div>
            </div>
          )}

          {reliability && reliability.sampleSize >= 3 && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400" data-reliability-range>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">{reliability.label}:</span> la mitad de los productos que
              coinciden se vende entre <span className="num font-bold">{formatUyu(reliability.p25)}</span> y{" "}
              <span className="num font-bold">{formatUyu(reliability.p75)}</span>
              {reliability.reasons.length > 0 ? ` (${reliability.reasons.join("; ")})` : ""}.
            </p>
          )}
          {smallSample && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <strong className="font-bold">
                  Muestra chica: {matching.length === 1 ? "coincide 1 solo producto" : `coinciden solo ${matching.length} productos`}.
                </strong>{" "}
                Tomá estos números como referencia, no como el rango del mercado.
              </div>
            </div>
          )}

          {farCount > 0 && stats && (
            <p role="status" className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
              <strong className="font-bold">
                {farCount === 1 ? "1 producto tiene" : `${farCount} productos tienen`} un precio muy distinto a la mediana,
                de {matching.length} que {matching.length === 1 ? "coincide" : "coinciden"}
              </strong>{" "}
              (más de {FAR_FROM_MEDIAN_FACTOR} veces {formatUyu(stats.median)} o menos de un tercio).{" "}
              {farCount === 1 ? "Está marcado en su tarjeta y está incluido" : "Están marcados en sus tarjetas y están incluidos"}{" "}
              en el mínimo, la mediana, el promedio y el máximo: no se recorta nada.
            </p>
          )}

          {relevance && (related.length > 0 || relevance.matchedWithoutOffers > 0 || relevance.matchedNotChecked > 0) && (
            <ul className="space-y-0.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {related.length > 0 && (
                <li>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">
                    {plural(related.length, "relacionado quedó", "relacionados quedaron")} fuera de las estadísticas
                  </span>
                  {relevance.missingCounts.length > 0 && (
                    <>
                      :{" "}
                      {relevance.missingCounts
                        .map((m) => `${m.count} no ${m.count === 1 ? "menciona" : "mencionan"} «${m.term}»`)
                        .join("; ")}
                    </>
                  )}
                  .
                </li>
              )}
              {relevance.matchedWithoutOffers > 0 && (
                <li>
                  {plural(relevance.matchedWithoutOffers, "producto de catálogo coincide", "productos de catálogo coinciden")}{" "}
                  por nombre pero Mercado Libre no informa ofertas activas en Uruguay: no se muestran.
                </li>
              )}
              {relevance.matchedNotChecked > 0 && (
                <li>
                  {plural(relevance.matchedNotChecked, "producto más coincide", "productos más coinciden")} por nombre
                  y no se {relevance.matchedNotChecked === 1 ? "consultó" : "consultaron"}: se revisan las ofertas de
                  hasta {relevance.searchCheckLimit} por búsqueda. Si buscás algo más específico (marca, modelo, medida) entran todos.
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* 5 Architectural Stat Cards */}
      <div className="flex flex-wrap gap-2.5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 flex-[1_1_7.5rem] rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
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
              sublabel={smallSample ? "Muestra chica" : "Sugerida"}
              onClick={stats ? () => onSelectPrice(Math.round(stats.median)) : undefined}
            />
            <StatCard
              label="PROMEDIO"
              value={stats ? (stats.average != null ? formatUyu(stats.average) : "No disponible") : "—"}
              sublabel={stats && stats.average == null ? "No se guardó en la nube" : undefined}
              onClick={stats && stats.average != null ? () => onSelectPrice(Math.round(stats.average!)) : undefined}
            />
            <StatCard
              label="MÁXIMO"
              value={stats ? formatUyu(stats.max) : "—"}
              onClick={stats ? () => onSelectPrice(Math.round(stats.max)) : undefined}
            />
            {fromRadar ? (
              <StatCard
                label="PRODUCTOS DE CATÁLOGO"
                value={matching.length.toLocaleString("es-UY")}
                sublabel={
                  matching.length > 0
                    ? `Coinciden · ${plural(matchingOffers, "oferta activa", "ofertas activas")} en total`
                    : "Ninguno coincide"
                }
              />
            ) : (
              <StatCard
                label={stats?.fromCloud ? "OFERTAS" : "PRECIOS"}
                value={
                  stats?.fromCloud && total === 0 ? "No disponible" : stats ? total.toLocaleString("es-UY") : "—"
                }
                sublabel={stats?.fromCloud ? "Guardado en la nube" : stats ? "Cargados a mano" : undefined}
              />
            )}
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

      {/* Productos de catálogo encontrados: solo datos que informa Mercado Libre */}
      {items.length > 0 && (
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Coinciden con tu búsqueda ({matching.length})
              </h4>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Productos de catálogo con ofertas activas en Uruguay, ordenados por cantidad de ofertas; a igual
                cantidad, primero el más barato. El precio de cada tarjeta es el de la oferta activa más barata de ese
                producto y el vendedor es el de esa oferta.
              </p>
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

          {matching.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
              {matching.map((item) => (
                <CatalogProductCard
                  key={item.id}
                  item={item}
                  rate={rate}
                  onSimulate={onSelectPrice}
                  farFromMedian={isFar(item)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-xs text-zinc-600 dark:text-zinc-400">
              Ningún producto con ofertas activas menciona todo lo que buscaste.
            </p>
          )}

          {related.length > 0 && (
            <details className="group mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white uppercase tracking-wider">
                <span>Relacionados ({related.length}) · no entran a las estadísticas</span>
                <span className="shrink-0 text-[11px] font-black group-open:hidden underline underline-offset-4">+ VER</span>
              </summary>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Son los más vendidos de la misma categoría de Mercado Libre y resultados a los que les falta algo de lo
                que escribiste; cada tarjeta dice qué le falta. Mismo criterio de precio: la oferta activa más barata. No se
                comparan contra la mediana porque no son lo que buscaste.
              </p>
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
                {related.map((item) => (
                  <CatalogProductCard
                    key={item.id}
                    item={item}
                    rate={rate}
                    onSimulate={onSelectPrice}
                    note={
                      item.match && item.match.missing.length > 0
                        ? `No menciona: ${item.match.missing.join(", ")}`
                        : undefined
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
