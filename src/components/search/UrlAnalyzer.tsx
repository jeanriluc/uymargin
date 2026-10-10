import { useState } from "react";
import {
  Link as LinkIcon,
  Search,
  Loader2,
  ExternalLink,
  Store,
  Truck,
  Calculator,
  Cloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  PackageSearch,
} from "lucide-react";
import { StepHeader } from "@/components/ui/StepHeader";
import { PriceWithEquivalent } from "@/components/ui/PriceWithEquivalent";
import { convertToUyu, type ExchangeRate } from "@/lib/currency";
import type { ExactProductBlock, MluItem, SimilarCriteria, UnsupportedListing } from "@/lib/mlu/types";
import { CatalogProductCard } from "@/components/search/CatalogProductCard";
import { ExactOffersSection } from "@/components/search/ExactOffersSection";
import { formatRate } from "@/lib/format";
import { FAR_FROM_MEDIAN_FACTOR, computeMarketStats, isFarFromMedian } from "@/lib/mlu/statistics";
import { formatUyu } from "@/lib/format";
import { saveAuditToCloud, type CloudAuditRecord } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

export interface AnalyzedProductData {
  id: string;
  title: string;
  /** Precio de referencia: el de la oferta exacta más barata. 0 si no hay ofertas activas. */
  price: number;
  priceUyu: number;
  currency: "UYU" | "USD";
  thumbnail: string | null;
  permalink: string;
  /** Apodo del vendedor de la oferta más barata. null = no disponible. */
  seller: string | null;
  sellerCity: string | null;
  condition: "new" | "used" | "other" | null;
  freeShipping: boolean;
  isAvailable?: boolean;
  activeSellersCount?: number;
}

export interface UrlAuditResponse {
  ok: boolean;
  url: string;
  /** Cotización con la que el servidor calculó comparaciones y rango de mercado. */
  rateUsed?: number;
  /** Publicaciones en una moneda no soportada: se informan, no se calculan. */
  unsupported?: UnsupportedListing[];
  targetProduct: AnalyzedProductData;
  /** Ofertas del mismo producto de catálogo ("Productos exactos"). */
  exact: ExactProductBlock;
  /** Otros productos de catálogo del mismo tipo. Puede venir vacío: no se rellena. */
  similarProducts: MluItem[];
  /** Con qué criterio se eligieron los similares. null = no se buscaron. */
  similarCriteria?: SimilarCriteria | null;
  /**
   * Mismos números que `exact.stats` (ofertas del producto exacto, sin excluir ninguna) más el promedio.
   * El rango de mercado tiene una sola fuente: la interfaz lee `exact.stats`.
   */
  marketStats?: {
    min: number;
    median: number;
    average: number;
    max: number;
    sampleSize: number;
  };
}

interface UrlAnalyzerProps {
  exchangeRate: number;
  /** Cotización en uso, con fecha y fuente, para mostrar equivalentes en pesos. */
  rate: ExchangeRate | null;
  /** `image`: foto del producto elegido (null si no tiene). */
  onSimulatePrice: (price: number, productName: string, image: string | null) => void;
}

const SAMPLE_URLS = [
  {
    name: "Termo Stanley Classic 950ml",
    url: "https://www.mercadolibre.com.uy/botella-termo-stanley-classic-950-ml-color-verde/p/MLU36006952",
  },
  {
    name: "Olla a Presión Eléctrica Xion 5L",
    url: "https://www.mercadolibre.com.uy/p/MLU20543325",
  },
  {
    name: "Vaso Shaker Gym 500ml",
    url: "https://www.mercadolibre.com.uy/p/MLU51013442",
  },
];

export function UrlAnalyzer({
  exchangeRate,
  rate,
  onSimulatePrice,
}: UrlAnalyzerProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UrlAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const [cloudSavedSuccess, setCloudSavedSuccess] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  async function handleAnalyze(targetUrl?: string) {
    const inputUrl = (targetUrl ?? url).trim();
    if (!inputUrl) return;

    setLoading(true);
    setError(null);
    setCloudSavedSuccess(false);
    setCloudError(null);

    try {
      const res = await apiFetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputUrl, rate: exchangeRate }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setResult(data);
        if (targetUrl) setUrl(targetUrl);
      } else {
        setError(data.message || "No se pudo analizar la publicación de Mercado Libre.");
      }
    } catch (err: any) {
      setError(err?.message || "Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveToSupabase() {
    if (!result) return;

    setSavingToCloud(true);
    setCloudError(null);

    const record: CloudAuditRecord = {
      title: result.targetProduct.title,
      product_url: result.targetProduct.permalink,
      thumbnail: result.targetProduct.thumbnail,
      target_price: result.targetProduct.price,
      target_currency: result.targetProduct.currency,
      target_price_uyu: result.targetProduct.priceUyu,
      // Rango de las ofertas del producto exacto (el mismo que muestra "Productos exactos"); sin ofertas no se guarda.
      competitor_min: result.exact.stats?.min,
      competitor_median: result.exact.stats?.median,
      competitor_max: result.exact.stats?.max,
      competitor_count: result.exact.offers.length,
      same_product_sellers: result.exact.offers.map((o) => ({
        seller: o.seller?.nickname ?? "no disponible",
        price: o.price,
        currency: o.currency,
        priceUyu: o.priceUyu,
        permalink: o.permalink,
      })),
      similar_products: result.similarProducts.map((p) => ({
        title: p.title,
        price: p.price,
        currency: p.currency,
        permalink: p.permalink,
        thumbnail: p.thumbnail,
      })),
    };

    const res = await saveAuditToCloud(record);
    setSavingToCloud(false);
    if (res.ok) {
      setCloudSavedSuccess(true);
      setTimeout(() => setCloudSavedSuccess(false), 4000);
    } else {
      setCloudError(res.error || "Error al guardar en Supabase");
    }
  }

  const targetIsAvailable = result?.targetProduct.isAvailable !== false && (result?.targetProduct.priceUyu ?? 0) > 0;

  // Pesos con la cotización vigente (no la del momento del análisis). Null si no se puede convertir.
  const uyuOf = (price: number, currency: string): number | null => {
    const c = convertToUyu(price, currency, rate);
    return c.status === "ok" ? Math.round(c.amountUyu) : null;
  };
  const simulate = (price: number, currency: string, title: string, image: string | null) => {
    const uyu = uyuOf(price, currency);
    if (uyu !== null) onSimulatePrice(uyu, title, image);
  };
  // Mediana de las ofertas del producto exacto con la cotización vigente: referencia para marcar similares
  // con precio muy distinto. Es solo una marca: los similares no entran a ningún rango.
  const exactPricesUyu = (result?.exact.offers ?? []).flatMap((o) => {
    const uyu = uyuOf(o.price, o.currency);
    return uyu !== null ? [uyu] : [];
  });
  const exactMedian = computeMarketStats(exactPricesUyu, { excludeOutliers: false })?.median ?? null;
  const similarIsFar = (item: MluItem) => {
    const uyu = uyuOf(item.price, item.currency);
    return uyu !== null && isFarFromMedian(uyu, exactMedian);
  };
  const farSimilarCount = (result?.similarProducts ?? []).filter(similarIsFar).length;
  const rateChangedSinceAnalysis =
    !!result?.rateUsed && !!rate && Math.abs(result.rateUsed - rate.rate) > 0.005;

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
        <StepHeader title="Auditor de publicación por enlace (MLU)" aside="Producto de catálogo" />

        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
          Pegá el link de una publicación de Mercado Libre Uruguay. UyMargin muestra las ofertas activas del mismo producto de catálogo con el precio de cada una, los datos del vendedor que informa Mercado Libre y otros productos del mismo tipo.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAnalyze();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <div className="relative flex-1 group">
            <LinkIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-500 dark:text-zinc-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors" />
            <input
              type="url"
              required
              placeholder="https://www.mercadolibre.com.uy/... o https://articulo.mercadolibre.com.uy/MLU-..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-12 w-full rounded-md border border-zinc-400 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3.5 pl-10 text-xs font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 outline-none transition-all hover:border-zinc-500 focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading || url.trim().length < 5}
            className="h-12 px-6 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95 shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Auditando...</span>
              </>
            ) : (
              <>
                <Search className="size-4" />
                <span>Auditar Enlace</span>
              </>
            )}
          </button>
        </form>

        {/* Quick sample chips */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
          <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mr-1">
            PROBAR CON UN EJEMPLO:
          </span>
          {SAMPLE_URLS.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => handleAnalyze(item.url)}
              className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white transition-colors cursor-pointer"
            >
              {item.name}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Results View */}
      {result && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Target Product Summary Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  PRODUCTO AUDITADO
                </span>
                {/* Real Availability Badge */}
                {targetIsAvailable ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    <span className="size-2 rounded-full bg-emerald-500"></span>
                    {result.exact.offers.length} {result.exact.offers.length === 1 ? "oferta activa" : "ofertas activas"} en UY
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                    <AlertTriangle className="size-3" />
                    0 ofertas activas en Uruguay
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Cloud Save Button */}
                <button
                  onClick={handleSaveToSupabase}
                  disabled={savingToCloud}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/80 px-3 py-1.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors cursor-pointer"
                >
                  {savingToCloud ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : cloudSavedSuccess ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <Cloud className="size-3.5 text-emerald-500" />
                  )}
                  <span>
                    {cloudSavedSuccess
                      ? "¡Guardado en Supabase!"
                      : "Guardar en Nube"}
                  </span>
                </button>

                {/* Simulate Button (if in stock) */}
                {targetIsAvailable && (
                  <button
                    disabled={uyuOf(result.targetProduct.price, result.targetProduct.currency) === null}
                    onClick={() =>
                      simulate(result.targetProduct.price, result.targetProduct.currency, result.targetProduct.title, result.targetProduct.thumbnail ?? null)
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-xs font-black uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
                  >
                    <Calculator className="size-3.5" />
                    <span>Simular Rentabilidad</span>
                  </button>
                )}
              </div>
            </div>

            {/* Out of Stock Warning Banner */}
            {!targetIsAvailable && (
              <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-3">
                <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="font-black uppercase tracking-wider text-[11px]">
                    Atención: este producto no tiene ofertas activas
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    Mercado Libre no informa ninguna publicación activa de este producto en Uruguay en este momento, así que no hay precio de referencia. Los productos similares de abajo no son el mismo producto.
                  </p>
                </div>
              </div>
            )}

            {cloudError && (
              <div role="alert" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                {cloudError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="relative size-24 sm:size-28 shrink-0 rounded-xl bg-white border border-zinc-200 dark:border-zinc-700 p-2 overflow-hidden shadow-sm">
                {result.targetProduct.thumbnail ? (
                  <img
loading="lazy" decoding="async"                     src={result.targetProduct.thumbnail}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <PackageSearch className="m-auto size-8 text-zinc-500 dark:text-zinc-400" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <a
                  href={result.targetProduct.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-1.5 text-base sm:text-lg font-black text-zinc-900 dark:text-zinc-100 hover:text-black dark:hover:text-white"
                >
                  <span className="line-clamp-2 leading-snug">
                    {result.targetProduct.title}
                  </span>
                  <ExternalLink className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400 group-hover:text-black dark:group-hover:text-white transition-colors" />
                </a>

                <div className="mt-3.5 flex flex-wrap items-center gap-4 border-t border-zinc-100 dark:border-zinc-800/80 pt-3">
                  <div>
                    <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                      PRECIO DE REFERENCIA (OFERTA MÁS BARATA)
                    </span>
                    {targetIsAvailable ? (
                      <PriceWithEquivalent
                        amount={result.targetProduct.price}
                        currency={result.targetProduct.currency}
                        rate={rate}
                        className="num text-2xl font-black text-black dark:text-white"
                        equivalentClassName="text-xs font-semibold text-zinc-600 dark:text-zinc-400"
                      />
                    ) : (
                      <span className="text-2xl font-black text-black dark:text-white">Sin precio activo</span>
                    )}
                  </div>

                  {targetIsAvailable && (
                    <div className="min-w-0 border-l border-zinc-200 dark:border-zinc-800 pl-4">
                      <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                        VENDEDOR DE ESA OFERTA
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 mt-0.5">
                        <Store className="size-3.5 text-zinc-500 dark:text-zinc-400" aria-hidden />
                        <span className="break-words">{result.targetProduct.seller ?? "no disponible"}</span>
                        {result.targetProduct.sellerCity && (
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">({result.targetProduct.sellerCity})</span>
                        )}
                      </div>
                    </div>
                  )}

                  {targetIsAvailable && result.targetProduct.freeShipping && (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-black uppercase text-emerald-700 dark:text-emerald-400">
                      <Truck className="size-3" /> Envío Gratis
                    </span>
                  )}
                </div>
              </div>
            </div>

            {rateChangedSinceAnalysis && rate && result.rateUsed && (
              <p
                role="status"
                className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
              >
                Este enlace se auditó con el dólar a{" "}
                <span className="num font-bold">{formatRate(result.rateUsed)}</span>; la cotización en uso ahora es{" "}
                <span className="num font-bold">{formatRate(rate.rate)}</span>. Los precios en pantalla ya usan la
                cotización vigente; el rango que se guarda en la nube es el del momento de la auditoría: volvé a
                auditar el enlace antes de guardar.
              </p>
            )}

            {result.unsupported && result.unsupported.length > 0 && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
              >
                <p className="font-bold">
                  {result.unsupported.length}{" "}
                  {result.unsupported.length === 1 ? "publicación quedó" : "publicaciones quedaron"} fuera del cálculo
                  por estar en una moneda que UyMargin no convierte.
                </p>
                <ul className="mt-1.5 space-y-0.5 pl-4">
                  {result.unsupported.slice(0, 5).map((u) => (
                    <li key={u.id}>
                      {u.title}: <span className="num font-bold">{u.currency || "moneda sin indicar"} {u.price}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* El rango de mercado tiene una sola fuente: las ofertas del producto exacto, en la sección de abajo. */}
            {result.exact.offers.length > 0 && (
              <p className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-semibold leading-relaxed text-zinc-600 dark:text-zinc-400">
                Rango de mercado: es el mínimo, la mediana y el máximo de las{" "}
                <span className="num">{result.exact.offers.length}</span>{" "}
                {result.exact.offers.length === 1 ? "oferta activa" : "ofertas activas"} de este mismo producto, sin
                excluir ninguna. Está en “Productos exactos”, acá abajo. Los similares no entran a ese rango.
              </p>
            )}
          </div>

          {/* Section 1: Productos exactos (mismo product_id de catálogo) */}
          <ExactOffersSection
            exact={result.exact}
            rate={rate}
            onSimulate={(priceUyu, title, image) => onSimulatePrice(priceUyu, title, image)}
            onChooseAlternative={(candidate) => handleAnalyze(candidate.permalink)}
          />

          {/* Section 2: Similares (otros productos de catálogo del mismo tipo con ofertas activas) */}
          {result.similarCriteria && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
              <div className="mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PackageSearch className="size-4 text-zinc-600 dark:text-zinc-400" />
                    <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                      Similares del mismo tipo en Mercado Libre Uruguay
                    </h3>
                  </div>
                  <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                    <span className="num">{result.similarProducts.length}</span>{" "}
                    {result.similarProducts.length === 1 ? "producto con ofertas activas" : "productos con ofertas activas"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  No son el mismo producto ni entran al rango de mercado.{" "}
                  {result.similarCriteria.typeWords.length > 0 ? (
                    <>
                      Mismo tipo = están en la misma categoría de Mercado Libre que el producto auditado y su nombre
                      menciona {result.similarCriteria.typeWords.map((w) => `«${w}»`).join(" y ")}.
                    </>
                  ) : (
                    <>No se pudo determinar el tipo de producto con los datos de Mercado Libre.</>
                  )}{" "}
                  {result.similarCriteria.discarded > 0 &&
                    `Se ${result.similarCriteria.discarded === 1 ? "descartó 1 producto" : `descartaron ${result.similarCriteria.discarded} productos`} de la categoría por ser de otro tipo. `}
                  {result.similarProducts.length > 0 &&
                    "Ordenados por cantidad de ofertas activas; a igual cantidad, primero el más barato. El precio de cada tarjeta es el de la oferta activa más barata de ese producto y el vendedor es el de esa oferta."}
                </p>
                {farSimilarCount > 0 && exactMedian !== null && (
                  <p role="status" className="mt-1 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                    <strong className="font-bold">
                      {farSimilarCount === 1 ? "1 similar tiene" : `${farSimilarCount} similares tienen`} un precio muy
                      distinto a la mediana del producto auditado
                    </strong>{" "}
                    (más de {FAR_FROM_MEDIAN_FACTOR} veces {formatUyu(exactMedian)} o menos de un tercio), de{" "}
                    {result.similarProducts.length} que se muestran.{" "}
                    {farSimilarCount === 1 ? "Está marcado" : "Están marcados"} en la tarjeta; ningún similar entra al
                    rango de mercado.
                  </p>
                )}
              </div>

              {result.similarProducts.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
                  {result.similarProducts.map((item) => (
                    <CatalogProductCard
                      key={item.id}
                      item={item}
                      rate={rate}
                      onSimulate={(priceUyu, image) => onSimulatePrice(priceUyu, item.title, image)}
                      farFromMedian={similarIsFar(item)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-xs text-zinc-600 dark:text-zinc-400">
                  No encontramos otros productos del mismo tipo con ofertas activas en Uruguay. No se muestran productos
                  de otro tipo para completar la lista.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
