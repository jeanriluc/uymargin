import { useState, useMemo } from "react";
import {
  Link as LinkIcon,
  Search,
  Loader2,
  ExternalLink,
  Users,
  Store,
  Truck,
  TrendingDown,
  TrendingUp,
  Calculator,
  Cloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Package,
  PackageSearch,
  Star,
  Award,
  ShieldCheck,
  Check,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { formatMoney, formatUyu } from "@/lib/format";
import { StepHeader } from "@/components/ui/StepHeader";
import { PriceWithEquivalent } from "@/components/ui/PriceWithEquivalent";
import { convertToUyu, type ExchangeRate } from "@/lib/currency";
import type { UnsupportedListing } from "@/lib/mlu/types";
import { formatRate } from "@/lib/format";
import { saveAuditToCloud, isSupabaseConfigured, type CloudAuditRecord } from "@/lib/supabase";

export interface AnalyzedProductData {
  id: string;
  title: string;
  price: number;
  priceUyu: number;
  currency: "UYU" | "USD";
  thumbnail: string | null;
  permalink: string;
  seller: string;
  sellerCity: string;
  condition: "new" | "used" | "other";
  freeShipping: boolean;
  isAvailable?: boolean;
  stockStatus?: string;
  salesVolume?: string;
  sellerBadge?: "Tienda Oficial" | "MercadoLíder Platinum" | "MercadoLíder Gold" | "Vendedor Destacado";
  sellerReputation?: string;
  positivePercentage?: number;
  ratingAverage?: number;
  reviewsCount?: number;
  activeSellersCount?: number;
}

export interface SameProductSeller {
  id: string;
  price: number;
  priceUyu: number;
  currency: "UYU" | "USD";
  seller: string;
  sellerCity: string;
  permalink: string;
  freeShipping: boolean;
  differencePercent?: number;
  isAvailable?: boolean;
  stockStatus?: string;
  salesVolume?: string;
  sellerBadge?: "Tienda Oficial" | "MercadoLíder Platinum" | "MercadoLíder Gold" | "Vendedor Destacado";
  sellerReputation?: string;
  positivePercentage?: number;
  ratingAverage?: number;
  reviewsCount?: number;
  isOfficialStore?: boolean;
  isTopSeller?: boolean;
}

export interface SimilarProductItem {
  id: string;
  title: string;
  price: number;
  currency: "UYU" | "USD";
  thumbnail: string | null;
  permalink: string;
  freeShipping: boolean;
  seller: string | null;
  isAvailable?: boolean;
  stockStatus?: string;
  salesVolume?: string;
  sellerBadge?: string;
  sellerReputation?: string;
  positivePercentage?: number;
  ratingAverage?: number;
  reviewsCount?: number;
  isTopChoice?: boolean;
}

export interface UrlAuditResponse {
  ok: boolean;
  url: string;
  /** Cotización con la que el servidor calculó comparaciones y rango de mercado. */
  rateUsed?: number;
  /** Publicaciones en una moneda no soportada: se informan, no se calculan. */
  unsupported?: UnsupportedListing[];
  targetProduct: AnalyzedProductData;
  sameProductSellers: SameProductSeller[];
  similarProducts: SimilarProductItem[];
  marketStats: {
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
  onSimulatePrice: (price: number, productName: string) => void;
  onOpenCloudSettings: () => void;
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
  onOpenCloudSettings,
}: UrlAnalyzerProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UrlAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingToCloud, setSavingToCloud] = useState(false);
  const [cloudSavedSuccess, setCloudSavedSuccess] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // Filters & Sorting for sellers
  const [sellerFilter, setSellerFilter] = useState<"all" | "official_leader" | "free_shipping">("all");
  const [sellerSort, setSellerSort] = useState<"top" | "price_asc" | "diff">("top");

  async function handleAnalyze(targetUrl?: string) {
    const inputUrl = (targetUrl ?? url).trim();
    if (!inputUrl) return;

    setLoading(true);
    setError(null);
    setCloudSavedSuccess(false);
    setCloudError(null);

    try {
      const res = await fetch("/api/analyze-url", {
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
    if (!isSupabaseConfigured()) {
      onOpenCloudSettings();
      return;
    }

    setSavingToCloud(true);
    setCloudError(null);

    const record: CloudAuditRecord = {
      title: result.targetProduct.title,
      product_url: result.targetProduct.permalink,
      thumbnail: result.targetProduct.thumbnail,
      target_price: result.targetProduct.price,
      target_currency: result.targetProduct.currency,
      target_price_uyu: result.targetProduct.priceUyu,
      competitor_min: result.marketStats.min,
      competitor_median: result.marketStats.median,
      competitor_max: result.marketStats.max,
      competitor_count: result.sameProductSellers.length + result.similarProducts.length,
      same_product_sellers: result.sameProductSellers.map((s) => ({
        seller: s.seller,
        price: s.price,
        currency: s.currency,
        priceUyu: s.priceUyu,
        permalink: s.permalink,
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

  // Filter and sort same-product sellers
  const filteredSellers = useMemo(() => {
    if (!result) return [];
    let list = [...result.sameProductSellers];

    if (sellerFilter === "official_leader") {
      list = list.filter(
        (s) =>
          s.sellerBadge === "Tienda Oficial" ||
          s.sellerBadge === "MercadoLíder Platinum" ||
          s.sellerBadge === "MercadoLíder Gold"
      );
    } else if (sellerFilter === "free_shipping") {
      list = list.filter((s) => s.freeShipping);
    }

    if (sellerSort === "price_asc") {
      list.sort((a, b) => a.priceUyu - b.priceUyu);
    } else if (sellerSort === "diff") {
      list.sort((a, b) => (a.differencePercent ?? 0) - (b.differencePercent ?? 0));
    } else {
      // "top": official first, then platinum, then rating
      list.sort((a, b) => {
        const aScore = (a.sellerBadge === "Tienda Oficial" ? 50 : a.sellerBadge === "MercadoLíder Platinum" ? 30 : 10) + (a.ratingAverage ?? 4.5) * 5;
        const bScore = (b.sellerBadge === "Tienda Oficial" ? 50 : b.sellerBadge === "MercadoLíder Platinum" ? 30 : 10) + (b.ratingAverage ?? 4.5) * 5;
        return bScore - aScore;
      });
    }

    return list;
  }, [result, sellerFilter, sellerSort]);

  const targetIsAvailable = result?.targetProduct.isAvailable !== false && (result?.targetProduct.priceUyu ?? 0) > 0;

  // Pesos con la cotización vigente (no la del momento del análisis). Null si no se puede convertir.
  const uyuOf = (price: number, currency: string): number | null => {
    const c = convertToUyu(price, currency, rate);
    return c.status === "ok" ? Math.round(c.amountUyu) : null;
  };
  const simulate = (price: number, currency: string, title: string) => {
    const uyu = uyuOf(price, currency);
    if (uyu !== null) onSimulatePrice(uyu, title);
  };
  const rateChangedSinceAnalysis =
    !!result?.rateUsed && !!rate && Math.abs(result.rateUsed - rate.rate) > 0.005;

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
        <StepHeader title="Auditor de publicación por enlace (MLU)" aside="Solo con stock activo" />

        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
          Pegá el link de cualquier publicación de Mercado Libre Uruguay. UyMargin audita al instante si tiene stock activo, quién más vende el mismo producto en Uruguay, la reputación de cada tienda (ventas, calificaciones y opiniones positivas) y las mejores alternativas disponibles.
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
              className="h-12 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 pl-10 text-xs font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 outline-none transition-all hover:border-zinc-500 focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white"
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
            PROBAR EJEMPLOS CON STOCK ACTIVO:
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
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    En Stock Disponible ({result.sameProductSellers.length || 1} en UY)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-red-600 dark:text-red-400">
                    <AlertTriangle className="size-3" />
                    Pausada / Sin Stock en Uruguay
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
                      simulate(result.targetProduct.price, result.targetProduct.currency, result.targetProduct.title)
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
                    Atención: Publicación sin stock disponible actualmente
                  </p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    Esta publicación específica se encuentra pausada o sin vendedores con entrega inmediata en Uruguay. Para realizar tu estudio de rentabilidad, revisá la tabla de competidores y productos similares con stock verificado a continuación.
                  </p>
                </div>
              </div>
            )}

            {cloudError && (
              <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                <span>{cloudError}</span>
                <button
                  onClick={onOpenCloudSettings}
                  className="underline font-bold"
                >
                  Configurar Supabase
                </button>
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

                {/* Pre-Click Seller Quality, Volume & Reviews Bar */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* Seller badge */}
                  {result.targetProduct.sellerBadge === "Tienda Oficial" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                      <Store className="size-3" /> Tienda Oficial
                    </span>
                  ) : result.targetProduct.sellerBadge === "MercadoLíder Platinum" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      <Award className="size-3" /> MercadoLíder Platinum
                    </span>
                  ) : result.targetProduct.sellerBadge === "MercadoLíder Gold" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      <Award className="size-3" /> MercadoLíder Gold
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                      <ShieldCheck className="size-3 text-emerald-500" /> Vendedor Destacado
                    </span>
                  )}

                  {/* Rating with stars */}
                  {result.targetProduct.ratingAverage != null && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:text-amber-300">
                    <Star className="size-3 fill-amber-500 text-amber-500" />
                    <span>{result.targetProduct.ratingAverage}</span>
                    {result.targetProduct.reviewsCount != null && (
                      <span className="text-[11px] font-normal text-amber-700 dark:text-amber-400">({result.targetProduct.reviewsCount} opiniones)</span>
                    )}
                  </span>
                  )}

                  {/* Sales Volume badge */}
                  {result.targetProduct.salesVolume && (
                  <span className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                    <Package className="size-3" aria-hidden /> {result.targetProduct.salesVolume}
                  </span>
                  )}

                  {/* Positive reputation % */}
                  {result.targetProduct.positivePercentage != null && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3 text-emerald-500" />
                    {result.targetProduct.positivePercentage}% opiniones positivas
                  </span>
                  )}
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-4 border-t border-zinc-100 dark:border-zinc-800/80 pt-3">
                  <div>
                    <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                      PRECIO DE REFERENCIA
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
                      <span className="text-2xl font-black text-black dark:text-white">Sin Precio Activo</span>
                    )}
                  </div>

                  <div className="border-l border-zinc-200 dark:border-zinc-800 pl-4">
                    <span className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block">
                      TIENDA / VENDEDOR
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 mt-0.5">
                      <Store className="size-3.5 text-zinc-500 dark:text-zinc-400" />
                      <span>{result.targetProduct.seller}</span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">({result.targetProduct.sellerCity})</span>
                    </div>
                  </div>

                  {result.targetProduct.freeShipping && (
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
                El rango de mercado y las diferencias porcentuales de abajo se calcularon con el dólar a{" "}
                <span className="num font-bold">{formatRate(result.rateUsed)}</span>; la cotización en uso ahora es{" "}
                <span className="num font-bold">{formatRate(rate.rate)}</span>. Volvé a auditar el enlace para
                actualizarlos. Los precios de cada publicación sí usan la cotización vigente.
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

            {/* Benchmark Cards */}
            <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-2.5">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
                  MÍNIMO ENCONTRADO
                </span>
                <p className="num text-lg font-black text-zinc-900 dark:text-zinc-100 mt-1">
                  {formatUyu(result.marketStats.min)}
                </p>
              </div>

              <div className="rounded-lg border border-black dark:border-white bg-black dark:bg-white text-white dark:text-black p-3 shadow-sm">
                <span className="text-[11px] font-black uppercase tracking-wider opacity-80">
                  MEDIANA DE MERCADO
                </span>
                <p className="num text-lg font-black mt-1">
                  {formatUyu(result.marketStats.median)}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
                  PROMEDIO
                </span>
                <p className="num text-lg font-black text-zinc-900 dark:text-zinc-100 mt-1">
                  {formatUyu(result.marketStats.average)}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3">
                <span className="text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
                  MÁXIMO ENCONTRADO
                </span>
                <p className="num text-lg font-black text-zinc-900 dark:text-zinc-100 mt-1">
                  {formatUyu(result.marketStats.max)}
                </p>
              </div>
            </div>
          </div>

          {/* Section 1: Same Product Sold by Other Sellers */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-zinc-600 dark:text-zinc-400" />
                <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                  Mismo Producto: Tiendas que lo venden con Stock en Uruguay
                </h3>
              </div>
              <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                {result.sameProductSellers.length} VENDEDORES ACTIVOS EN UY
              </span>
            </div>

            {/* Filters & Sorting bar */}
            {result.sameProductSellers.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 bg-zinc-50 dark:bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mr-1 flex items-center gap-1">
                    <SlidersHorizontal className="size-3" /> FILTRAR:
                  </span>
                  <button
                    type="button"
                    onClick={() => setSellerFilter("all")}
                    className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                      sellerFilter === "all"
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    Todos ({result.sameProductSellers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellerFilter("official_leader")}
                    className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                      sellerFilter === "official_leader"
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Star className="size-3" aria-hidden /> Tiendas Oficiales & MercadoLíder
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellerFilter("free_shipping")}
                    className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                      sellerFilter === "free_shipping"
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Truck className="size-3" aria-hidden /> Envío Gratis
                  </button>
                </div>

                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    ORDENAR:
                  </span>
                  <select
                    value={sellerSort}
                    onChange={(e: any) => setSellerSort(e.target.value)}
                    className="h-7 min-w-0 max-w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-[11px] font-bold text-zinc-800 dark:text-zinc-200 outline-none"
                  >
                    <option value="top">Top Reputación & Ventas</option>
                    <option value="price_asc">Menor Precio en $U</option>
                    <option value="diff">Mayor Descuento vs. Ref</option>
                  </select>
                </div>
              </div>
            )}

            {filteredSellers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-6 text-center text-xs text-zinc-600 dark:text-zinc-400">
                {result.sameProductSellers.length === 0
                  ? "No se detectaron vendedores adicionales para este código de publicación específico."
                  : "No hay vendedores que coincidan con los filtros seleccionados."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-black uppercase text-zinc-500 dark:text-zinc-400 tracking-wider">
                      <th className="pb-2.5">Tienda / Vendedor</th>
                      <th className="pb-2.5">Calidad & Ventas</th>
                      <th className="pb-2.5">Disponibilidad</th>
                      <th className="pb-2.5">Precio de Venta</th>
                      <th className="pb-2.5">vs. Referencia</th>
                      <th className="pb-2.5">Envío</th>
                      <th className="pb-2.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-medium">
                    {filteredSellers.map((seller, idx) => (
                      <tr
                        key={seller.id + idx}
                        className="hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30 transition-colors"
                      >
                        {/* Tienda & Badge */}
                        <td className="py-3">
                          <div className="flex items-start gap-2">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-[11px] font-bold mt-0.5">
                              {idx + 1}
                            </span>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-black text-zinc-900 dark:text-zinc-100">
                                  {seller.seller}
                                </p>
                                {seller.sellerBadge === "Tienda Oficial" ? (
                                  <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 text-[11px] font-black text-indigo-600 dark:text-indigo-400 uppercase">
                                    Oficial
                                  </span>
                                ) : seller.sellerBadge === "MercadoLíder Platinum" ? (
                                  <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 text-[11px] font-black text-emerald-700 dark:text-emerald-400 uppercase">
                                    Platinum
                                  </span>
                                ) : seller.sellerBadge === "MercadoLíder Gold" ? (
                                  <span className="rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 text-[11px] font-black text-amber-700 dark:text-amber-400 uppercase">
                                    Gold
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {seller.sellerCity}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Calidad & Reviews (Pre-click insight) */}
                        <td className="py-3">
                          <div>
                            {seller.ratingAverage != null ? (
                              <div className="flex items-center gap-1 text-[11px] font-black text-amber-700 dark:text-amber-400">
                                <Star className="size-3 fill-amber-500 text-amber-500" />
                                <span>{seller.ratingAverage}</span>
                                {seller.reviewsCount != null && (
                                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-semibold">
                                    ({seller.reviewsCount})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Sin datos</span>
                            )}
                            {(seller.salesVolume || seller.positivePercentage != null) && (
                              <div className="flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                                {seller.salesVolume && (
                                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{seller.salesVolume}</span>
                                )}
                                {seller.positivePercentage != null && <span>{seller.positivePercentage}% pos.</span>}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Disponibilidad */}
                        <td className="py-3">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <span className="size-1.5 rounded-full bg-emerald-500"></span>
                            En Stock UY
                          </span>
                        </td>

                        {/* Precios */}
                        <td className="py-3 font-bold num text-zinc-900 dark:text-zinc-100">
                          <PriceWithEquivalent amount={seller.price} currency={seller.currency} rate={rate} />
                        </td>

                        {/* Diferencia % */}
                        <td className="py-3">
                          {seller.differencePercent !== undefined &&
                          seller.differencePercent !== 0 ? (
                            <span
                              className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold num ${
                                seller.differencePercent < 0
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "bg-red-500/10 text-red-600 dark:text-red-400"
                              }`}
                            >
                              {seller.differencePercent < 0 ? (
                                <TrendingDown className="size-3" />
                              ) : (
                                <TrendingUp className="size-3" />
                              )}
                              {seller.differencePercent > 0 ? "+" : ""}
                              {seller.differencePercent}%
                            </span>
                          ) : (
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-bold uppercase">
                              Igual
                            </span>
                          )}
                        </td>

                        {/* Envío */}
                        <td className="py-3">
                          {seller.freeShipping ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                              <Truck className="size-3" /> Gratis
                            </span>
                          ) : (
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              A cargo comprador
                            </span>
                          )}
                        </td>

                        {/* Acción */}
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              disabled={uyuOf(seller.price, seller.currency) === null}
                              onClick={() =>
                                simulate(seller.price, seller.currency, `${result.targetProduct.title} (${seller.seller})`)
                              }
                              title="Simular margen con este precio de venta"
                              className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white cursor-pointer"
                            >
                              Simular
                            </button>
                            <a
                              href={seller.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded p-1 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                              title="Ver publicación directa en Mercado Libre Uruguay"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Similar Competing Products in the Market (Verified In-Stock) */}
          {result.similarProducts.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <PackageSearch className="size-4 text-zinc-600 dark:text-zinc-400" />
                  <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
                    Productos Similares y Tops Verificados en Uruguay
                  </h3>
                </div>
                <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <span className="size-2 rounded-full bg-emerald-500"></span>
                  {result.similarProducts.length} alternativas con stock activo
                </span>
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
                {result.similarProducts.map((item) => (
                  <div
                    key={item.id}
                    className="group flex flex-col justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 p-3 transition-all hover:border-black dark:hover:border-white shadow-sm"
                  >
                    <div>
                      {/* Top Choice Badge & Stock */}
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500"></span>
                          En Stock
                        </span>
                        {item.isTopChoice && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-black text-white dark:bg-white dark:text-black px-1.5 py-0.2 text-[11px] font-black uppercase tracking-wider">
                            <Sparkles className="size-2.5" /> TOP
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-2.5">
                        <div className="relative size-12 shrink-0 rounded bg-white border border-zinc-200 dark:border-zinc-700 p-0.5 overflow-hidden">
                          {item.thumbnail ? (
                            <img
loading="lazy" decoding="async"                               src={item.thumbnail}
                              alt=""
                              className="size-full object-contain"
                            />
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
                          >
                            {item.title}
                          </a>
                        </div>
                      </div>

                      {/* Seller & Reviews Pre-click summary */}
                      <div className="mt-2.5 pt-2 border-t border-zinc-200/50 dark:border-zinc-800/50 flex flex-wrap items-center justify-between gap-1">
                        <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-medium min-w-0 flex-1 truncate">
                          {item.seller || "Vendedor sin identificar"}
                        </span>
                        {item.ratingAverage != null && (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                          <Star className="size-2.5 fill-amber-500 text-amber-500" />
                          <span>{item.ratingAverage}</span>
                          {item.reviewsCount != null && <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">({item.reviewsCount})</span>}
                        </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-zinc-200/60 dark:border-zinc-800/60 pt-2">
                      <div className="min-w-0">
                        <PriceWithEquivalent amount={item.price} currency={item.currency} rate={rate} />
                        {item.salesVolume && (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            {item.salesVolume}
                          </span>
                        )}
                      </div>

                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={uyuOf(item.price, item.currency) === null}
                          onClick={() => simulate(item.price, item.currency, item.title)}
                          title="Simular rentabilidad con este competidor"
                          className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white"
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
      )}
    </div>
  );
}
