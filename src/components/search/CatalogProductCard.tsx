import { ExternalLink, PackageSearch, Store, Truck } from "lucide-react";
import { PriceWithEquivalent } from "@/components/ui/PriceWithEquivalent";
import { convertToUyu, type ExchangeRate } from "@/lib/currency";
import { CONDITION, POWER_SELLER, REPUTATION, activeOffersLabel } from "@/lib/mlu/sellerLabels";
import type { MluItem } from "@/lib/mlu/types";

interface CatalogProductCardProps {
  key?: string;
  item: MluItem;
  rate: ExchangeRate | null;
  /** Recibe el precio en pesos con la cotización vigente. */
  onSimulate: (priceUyu: number) => void;
  /** Aclaración corta bajo el nombre (por ejemplo, qué le falta para coincidir con la búsqueda). */
  note?: string;
}

/**
 * Tarjeta de un producto de catálogo del radar o de "Similares". Muestra solo lo que informa
 * Mercado Libre: precio de su oferta activa más barata, cantidad de ofertas activas y datos de ese vendedor.
 */
export function CatalogProductCard({ item, rate, onSimulate, note }: CatalogProductCardProps) {
  const conversion = convertToUyu(item.price, item.currency, rate);
  const canSimulate = conversion.status === "ok";
  const seller = item.seller ?? null;
  const reputation = seller?.reputationLevel ? REPUTATION[seller.reputationLevel] : null;

  return (
    <div className="group flex min-w-0 flex-col justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/40 p-3 transition-all hover:border-black dark:hover:border-white hover:shadow-sm">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
          {item.activeSellersCount != null && (
            <span className="whitespace-nowrap text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300">
              {activeOffersLabel(item.activeSellersCount)}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-1">
            {item.isOfficialStore && (
              <span className="inline-flex items-center gap-1 rounded border border-indigo-500/20 bg-indigo-500/10 px-1.5 text-[11px] font-black uppercase text-indigo-700 dark:text-indigo-300">
                <Store className="size-3" aria-hidden /> Tienda oficial
              </span>
            )}
            {seller?.powerSellerStatus && (
              <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[11px] font-black uppercase text-emerald-700 dark:text-emerald-400">
                {POWER_SELLER[seller.powerSellerStatus]}
              </span>
            )}
          </div>
        </div>

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
            {note && (
              <p className="mt-1 text-[11px] font-semibold leading-snug text-amber-800 dark:text-amber-300">{note}</p>
            )}
          </div>
        </div>

        {/* Vendedor de la oferta mostrada: datos de /users de Mercado Libre */}
        <div className="mt-2.5 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 text-[11px] text-zinc-600 dark:text-zinc-400">
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vendedor</span>
            <span className="min-w-0 truncate font-bold text-zinc-800 dark:text-zinc-200" title={seller?.nickname ?? undefined}>
              {seller?.nickname ?? <span className="font-semibold text-zinc-500 dark:text-zinc-400">no disponible</span>}
            </span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {seller ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {reputation && <span className={`size-2 rounded-full ${reputation.dot}`} aria-hidden />}
                  Reputación: {reputation ? reputation.label : seller.reputationLevel ?? "sin nivel asignado"}
                </span>
                {seller.transactionsTotal !== null && (
                  <span>
                    <span className="num font-bold">{seller.transactionsTotal.toLocaleString("es-UY")}</span>{" "}
                    {seller.transactionsTotal === 1 ? "transacción" : "transacciones"}
                  </span>
                )}
              </>
            ) : (
              <span>Reputación y transacciones no disponibles</span>
            )}
            {item.sellerCity && <span>{item.sellerCity}</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-zinc-200/60 dark:border-zinc-800/60 pt-2">
        <div className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Oferta más barata
          </span>
          <PriceWithEquivalent amount={item.price} currency={item.currency} rate={rate} />
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
            {item.freeShipping && (
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-black uppercase text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 px-1 rounded">
                <Truck className="size-2" aria-hidden /> Envío gratis
              </span>
            )}
            {item.condition && <span>{CONDITION[item.condition]}</span>}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={!canSimulate}
            onClick={() => {
              // El simulador trabaja en pesos: una publicación en dólares entra convertida.
              if (conversion.status === "ok") onSimulate(Math.round(conversion.amountUyu));
            }}
            title={
              canSimulate
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
  );
}
