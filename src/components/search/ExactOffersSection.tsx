import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AlertTriangle, ExternalLink, Loader2, PackageSearch, SlidersHorizontal, Store, Truck } from "lucide-react";
import { PriceWithEquivalent } from "@/components/ui/PriceWithEquivalent";
import { convertToUyu, type ExchangeRate } from "@/lib/currency";
import { formatUyu } from "@/lib/format";
import type { CatalogCandidate, ExactOffer, ExactProductBlock, ExactSelection } from "@/lib/mlu/types";
import { CONDITION, POWER_SELLER, REPUTATION } from "@/lib/mlu/sellerLabels";

interface ExactOffersSectionProps {
  /** null = no disponible (sin coincidencia en el catálogo o Mercado Libre no respondió). */
  exact: ExactProductBlock | null;
  /** Búsqueda por nombre: cómo se eligió el producto, o por qué no se eligió ninguno. */
  selection?: ExactSelection | null;
  /** Cotización en uso: los equivalentes y las estadísticas se calculan con la vigente. */
  rate: ExchangeRate | null;
  /** `image`: foto del producto de catálogo (null si no tiene). */
  onSimulate: (priceUyu: number, title: string, image: string | null) => void;
  /** Si se pasa, elegir otro candidato lo resuelve quien usa la sección (p. ej. volver a auditar el enlace). */
  onChooseAlternative?: (candidate: CatalogCandidate) => void;
}

type SortKey = "price_asc" | "price_desc" | "transactions";
type CurrencyFilter = "all" | "UYU" | "USD";

function median(sorted: number[]): number {
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
}

function offersLabel(count: number | null): string {
  if (count === null) return "Ofertas sin consultar";
  if (count === 0) return "Sin ofertas activas";
  return `${count} ${count === 1 ? "oferta activa" : "ofertas activas"}`;
}

function FilterChip({
  label,
  count,
  total,
  active,
  onToggle,
  unavailable = false,
}: {
  label: string;
  count: number;
  total: number;
  active: boolean;
  onToggle: () => void;
  unavailable?: boolean;
}) {
  // Un filtro que deja todas las ofertas o ninguna no filtra: se muestra, pero deshabilitado y con el motivo.
  const useless = unavailable || count === 0 || count === total;
  const title = unavailable
    ? "No disponible: Mercado Libre no informó los datos de los vendedores"
    : count === 0
      ? "Ninguna oferta cumple esta condición"
      : count === total
        ? "Todas las ofertas cumplen esta condición"
        : undefined;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={useless && !active}
      title={title}
      onClick={onToggle}
      className={`tap-target rounded px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {label} <span className="num">({unavailable ? "no disponible" : count})</span>
    </button>
  );
}

export function ExactOffersSection({
  exact: exactProp,
  selection = null,
  rate,
  onSimulate,
  onChooseAlternative,
}: ExactOffersSectionProps) {
  // Candidato elegido a mano en el radar: reemplaza el producto y sus ofertas sin repetir la búsqueda.
  const [override, setOverride] = useState<ExactProductBlock | null>(null);
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);

  const [onlyOfficial, setOnlyOfficial] = useState(false);
  const [onlyLeader, setOnlyLeader] = useState(false);
  const [onlyFreeShipping, setOnlyFreeShipping] = useState(false);
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>("all");
  const [sort, setSort] = useState<SortKey>("price_asc");

  useEffect(() => {
    setOverride(null);
    setChoosingId(null);
    setChooseError(null);
  }, [exactProp, selection]);

  const exact = override ?? exactProp;
  const productId = exact?.match.productId;

  useEffect(() => {
    setOnlyOfficial(false);
    setOnlyLeader(false);
    setOnlyFreeShipping(false);
    setCurrencyFilter("all");
    setSort("price_asc");
  }, [productId]);

  const rows = useMemo(() => {
    return (exact?.offers ?? []).map((offer) => {
      const c = convertToUyu(offer.price, offer.currency, rate);
      return { offer, uyu: c.status === "ok" ? c.amountUyu : null };
    });
  }, [exact, rate]);

  // Mínimo, mediana y máximo de las ofertas exactas con la cotización vigente, sin excluir ninguna.
  const stats = useMemo(() => {
    const prices = rows.flatMap((r) => (r.uyu !== null ? [r.uyu] : [])).sort((a, b) => a - b);
    if (prices.length === 0) return null;
    return { min: prices[0], median: median(prices), max: prices[prices.length - 1], priced: prices.length };
  }, [rows]);

  const total = rows.length;
  const counts = useMemo(
    () => ({
      official: rows.filter((r) => r.offer.isOfficialStore).length,
      leader: rows.filter((r) => r.offer.seller?.powerSellerStatus).length,
      freeShipping: rows.filter((r) => r.offer.freeShipping).length,
      uyu: rows.filter((r) => r.offer.currency === "UYU").length,
      usd: rows.filter((r) => r.offer.currency === "USD").length,
      withSeller: rows.filter((r) => r.offer.seller).length,
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const list = rows.filter(
      ({ offer }) =>
        (!onlyOfficial || offer.isOfficialStore) &&
        (!onlyLeader || !!offer.seller?.powerSellerStatus) &&
        (!onlyFreeShipping || offer.freeShipping) &&
        (currencyFilter === "all" || offer.currency === currencyFilter)
    );
    const byPrice = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (a.uyu ?? Infinity) - (b.uyu ?? Infinity);
    if (sort === "price_desc") list.sort((a, b) => (b.uyu ?? -Infinity) - (a.uyu ?? -Infinity));
    else if (sort === "transactions") {
      list.sort(
        (a, b) => (b.offer.seller?.transactionsTotal ?? -1) - (a.offer.seller?.transactionsTotal ?? -1) || byPrice(a, b)
      );
    } else list.sort(byPrice);
    return list;
  }, [rows, onlyOfficial, onlyLeader, onlyFreeShipping, currencyFilter, sort]);

  const filtersActive = onlyOfficial || onlyLeader || onlyFreeShipping || currencyFilter !== "all";
  const clearFilters = () => {
    setOnlyOfficial(false);
    setOnlyLeader(false);
    setOnlyFreeShipping(false);
    setCurrencyFilter("all");
  };

  // Candidatos entre los que se puede elegir a mano: los del bloque o, si no se eligió ninguno, los de la selección.
  const baseCandidates = exactProp?.candidates ?? selection?.candidates ?? [];

  async function chooseCandidate(candidate: CatalogCandidate) {
    if (onChooseAlternative) {
      onChooseAlternative(candidate);
      return;
    }
    setChoosingId(candidate.productId);
    setChooseError(null);
    try {
      const res = await apiFetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate.permalink, rate: rate?.rate, exactOnly: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.exact) {
        const next = data.exact as ExactProductBlock;
        setOverride({
          ...next,
          candidates: baseCandidates,
          match: { ...next.match, source: "elegido", confidence: "exacta", reasons: [] },
        });
      } else {
        setChooseError(data.message || "No se pudieron traer las ofertas de ese producto.");
      }
    } catch {
      setChooseError("Error de red al consultar ese producto.");
    } finally {
      setChoosingId(null);
    }
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
      <div className="min-w-0">
        <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
          Productos exactos
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
          Ofertas del mismo producto de catálogo en Mercado Libre Uruguay, de menor a mayor precio.
        </p>
      </div>
      {exact && (
        <span className="num rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          {exact.match.productId}
        </span>
      )}
    </div>
  );

  const candidateList = (list: CatalogCandidate[]) => (
    <>
    <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
      {list.map((candidate) => (
        <li
          key={candidate.productId}
          className="flex min-w-0 items-center gap-2.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2"
        >
          <div className="size-10 shrink-0 overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 bg-white p-0.5">
            {candidate.thumbnail ? (
              <img loading="lazy" decoding="async" src={candidate.thumbnail} alt="" className="size-full object-contain" />
            ) : (
              <PackageSearch className="m-auto mt-2 size-4 text-zinc-500" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={candidate.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="line-clamp-2 text-xs font-bold leading-snug text-zinc-800 dark:text-zinc-200 hover:underline"
              title={candidate.title}
            >
              {candidate.title}
            </a>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{offersLabel(candidate.offersCount)}</p>
          </div>
          <button
            type="button"
            disabled={choosingId !== null}
            onClick={() => chooseCandidate(candidate)}
            className="tap-target inline-flex shrink-0 items-center gap-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white cursor-pointer disabled:opacity-50"
          >
            {choosingId === candidate.productId && <Loader2 className="size-3 animate-spin" aria-hidden />}
            Usar este
          </button>
        </li>
      ))}
    </ul>
    {chooseError && (
      <p role="alert" className="mt-2 text-xs font-bold text-red-600 dark:text-red-400">
        {chooseError}
      </p>
    )}
    </>
  );

  if (!exact) {
    const noun = (n: number) => `${n} ${n === 1 ? "producto de catálogo" : "productos de catálogo"}`;
    return (
      <section
        aria-label="Productos exactos"
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm"
      >
        {header}
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {selection?.status === "generica" ? (
            <>
              <p>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">
                  No se eligió un producto exacto: la búsqueda es genérica.
                </span>{" "}
                Coinciden {noun(selection.candidatesWithOffers)} con ofertas activas, de {selection.brands.length}{" "}
                marcas distintas ({selection.brands.slice(0, 5).join(", ")}
                {selection.brands.length > 5 ? "…" : ""}): no son un mismo producto. Agregá marca y modelo a la
                búsqueda, o elegí uno de la lista para ver sus ofertas. El radar de abajo sigue mostrando todos.
              </p>
              {candidateList(selection.candidates)}
            </>
          ) : selection?.status === "sin_ofertas" ? (
            <p>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                No hay un producto exacto con ofertas activas.
              </span>{" "}
              {selection.candidatesWithoutOffers === 1
                ? "1 producto de catálogo coincide con tu búsqueda, pero Mercado Libre no informa ofertas activas en Uruguay para él."
                : `${selection.candidatesWithoutOffers} productos de catálogo coinciden con tu búsqueda, pero Mercado Libre no informa ofertas activas en Uruguay para ninguno.`}{" "}
              No se muestra un producto sin ofertas; el radar de abajo lista los relacionados que sí tienen.
            </p>
          ) : selection?.status === "sin_coincidencias" ? (
            <p>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">No hay un producto exacto.</span> Ningún
              producto de catálogo menciona todo lo que buscaste. Probá con menos palabras; el radar de abajo lista los
              relacionados.
            </p>
          ) : (
            <p>
              No disponible: no encontramos un producto de catálogo que coincida con la búsqueda, o Mercado Libre no
              respondió. Los similares de abajo no son el mismo producto.
            </p>
          )}
        </div>
      </section>
    );
  }

  const { match } = exact;
  const others = exact.candidates.filter((c) => c.productId !== match.productId);
  const doubtful = match.confidence === "dudosa";
  const unpriced = total - (stats?.priced ?? 0);

  return (
    <section
      aria-label="Productos exactos"
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 sm:p-6 shadow-sm"
    >
      {header}

      {/* Producto de catálogo tomado como coincidencia (cuando no vino en el enlace) */}
      {match.source !== "enlace" && (
        <div
          className={`mb-4 rounded-lg border p-3 ${
            doubtful
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="size-14 shrink-0 overflow-hidden rounded border border-zinc-200 dark:border-zinc-700 bg-white p-0.5">
              {match.thumbnail ? (
                <img loading="lazy" decoding="async" src={match.thumbnail} alt="" className="size-full object-contain" />
              ) : (
                <PackageSearch className="m-auto mt-3 size-6 text-zinc-500" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                {match.source === "elegido" ? "Producto que elegiste" : "Producto tomado como coincidencia"}
              </p>
              <a
                href={match.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-start gap-1.5 text-sm font-black leading-snug text-zinc-900 dark:text-zinc-100 hover:underline"
              >
                <span className="min-w-0 break-words">{match.title}</span>
                <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              </a>
              {doubtful ? (
                <div role="alert" className="mt-1.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                  <p className="flex items-start gap-1.5 font-bold">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Coincidencia dudosa: revisá que sea el producto que buscás antes de usar estos precios.
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {match.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {match.source === "elegido"
                    ? "Lo elegiste entre los resultados del catálogo."
                    : selection?.status === "elegido" && selection.chosenOffers !== null
                      ? `Se eligió porque es el que más ofertas activas tiene (${selection.chosenOffers}) entre ${
                          selection.candidatesWithOffers === 1
                            ? "1 producto de catálogo que coincide"
                            : `${selection.candidatesWithOffers} productos de catálogo que coinciden`
                        } con tu búsqueda y tienen ofertas${
                          selection.brands.length === 1 ? `, todos de la marca ${selection.brands[0]}` : ""
                        }.${
                          selection.tiedWith > 0
                            ? ` Hay ${selection.tiedWith === 1 ? "otro" : `otros ${selection.tiedWith}`} con la misma cantidad de ofertas: se tomó el más barato.`
                            : ""
                        }${
                          selection.candidatesWithoutOffers > 0
                            ? ` Otros ${selection.candidatesWithoutOffers} coinciden pero no tienen ofertas activas en Uruguay.`
                            : ""
                        } Abrí el enlace para confirmar que es el que buscás.`
                      : "Coincide con todas las palabras de tu búsqueda. Abrí el enlace para confirmar que es el que buscás."}
                </p>
              )}
            </div>
          </div>

          {others.length > 0 && (
            <details className="group mt-3 border-t border-zinc-200/70 dark:border-zinc-700/70 pt-2.5" open={doubtful || undefined}>
              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Otros candidatos con ofertas ({others.length})
              </summary>
              {candidateList(others)}
            </details>
          )}
        </div>
      )}

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-bold text-zinc-900 dark:text-zinc-100">0 ofertas activas.</span> Mercado Libre no informa
          ninguna publicación activa de este producto en Uruguay en este momento.
        </p>
      ) : (
        <>
          {/* Mínimo, mediana y máximo solo de estas ofertas */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-2.5">
            {(
              [
                { key: "min", label: "Mínimo", value: stats?.min },
                { key: "median", label: "Mediana", value: stats?.median },
                { key: "max", label: "Máximo", value: stats?.max },
              ] as const
            ).map((card) => (
              <button
                key={card.key}
                type="button"
                disabled={card.value == null}
                onClick={() => card.value != null && onSimulate(Math.round(card.value), match.title, match.thumbnail ?? null)}
                title={card.value != null ? "Simular con este precio de venta" : undefined}
                className={`rounded-lg border p-3 text-left transition-colors enabled:cursor-pointer ${
                  card.key === "median"
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 text-zinc-900 dark:text-zinc-100 enabled:hover:border-black dark:enabled:hover:border-white"
                }`}
              >
                <span className="block text-[11px] font-black uppercase tracking-wider opacity-80">{card.label}</span>
                <span className="num mt-1 block text-lg font-black">
                  {card.value != null ? formatUyu(card.value) : "No disponible"}
                </span>
              </button>
            ))}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3 text-zinc-900 dark:text-zinc-100">
              <span className="block text-[11px] font-black uppercase tracking-wider opacity-80">Ofertas</span>
              <span className="num mt-1 block text-lg font-black">{total}</span>
            </div>
          </div>

          {unpriced > 0 && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {unpriced} {unpriced === 1 ? "oferta en dólares quedó" : "ofertas en dólares quedaron"} fuera del mínimo, la
              mediana y el máximo porque falta la cotización.
            </p>
          )}

          {exact.unsupported.length > 0 && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {exact.unsupported.length}{" "}
              {exact.unsupported.length === 1 ? "oferta quedó afuera" : "ofertas quedaron afuera"} por estar en una moneda
              que UyMargin no convierte.
            </p>
          )}

          {/* Filtros y orden: solo con datos que informa Mercado Libre */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                <SlidersHorizontal className="size-3" aria-hidden /> Filtrar:
              </span>
              <FilterChip
                label="Tienda oficial"
                count={counts.official}
                total={total}
                active={onlyOfficial}
                onToggle={() => setOnlyOfficial((v) => !v)}
              />
              <FilterChip
                label="MercadoLíder"
                count={counts.leader}
                total={total}
                active={onlyLeader}
                unavailable={counts.withSeller === 0}
                onToggle={() => setOnlyLeader((v) => !v)}
              />
              <FilterChip
                label="Envío gratis"
                count={counts.freeShipping}
                total={total}
                active={onlyFreeShipping}
                onToggle={() => setOnlyFreeShipping((v) => !v)}
              />
              {counts.uyu > 0 && counts.usd > 0 && (
                <>
                  <FilterChip
                    label="En pesos"
                    count={counts.uyu}
                    total={total}
                    active={currencyFilter === "UYU"}
                    onToggle={() => setCurrencyFilter((v) => (v === "UYU" ? "all" : "UYU"))}
                  />
                  <FilterChip
                    label="En dólares"
                    count={counts.usd}
                    total={total}
                    active={currencyFilter === "USD"}
                    onToggle={() => setCurrencyFilter((v) => (v === "USD" ? "all" : "USD"))}
                  />
                </>
              )}
            </div>

            <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              Ordenar:
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-8 min-w-0 max-w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-[11px] font-bold normal-case tracking-normal text-zinc-800 dark:text-zinc-200 outline-none"
              >
                <option value="price_asc">Menor precio</option>
                <option value="price_desc">Mayor precio</option>
                <option value="transactions" disabled={counts.withSeller === 0}>
                  Más transacciones del vendedor{counts.withSeller === 0 ? " (no disponible)" : ""}
                </option>
              </select>
            </label>
          </div>

          <p aria-live="polite" className="mt-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
            Mostrando <span className="num">{visible.length}</span> de <span className="num">{total}</span> ofertas.
            {filtersActive && (
              <>
                {" "}
                <button type="button" onClick={clearFilters} className="font-bold underline underline-offset-2 cursor-pointer">
                  Quitar filtros
                </button>
              </>
            )}
          </p>

          {exact.sellerData.status !== "ok" && (
            <p className="mt-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              Datos del vendedor no disponibles en {exact.sellerData.withoutData} de {total} ofertas (Mercado Libre no
              respondió o se superó el tope de {exact.sellerData.cap} vendedores por producto).
            </p>
          )}

          {visible.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-center text-xs text-zinc-600 dark:text-zinc-400">
              Ninguna oferta cumple todos los filtros elegidos.
            </p>
          ) : (
            <ol className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {visible.map(({ offer, uyu }) => (
                <OfferRow
                  key={offer.itemId || offer.permalink}
                  offer={offer}
                  uyu={uyu}
                  minUyu={stats?.min ?? null}
                  rate={rate}
                  onSimulate={() => uyu !== null && onSimulate(Math.round(uyu), match.title, match.thumbnail ?? null)}
                />
              ))}
            </ol>
          )}

          <p className="mt-3 border-t border-zinc-100 dark:border-zinc-800 pt-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Vendedor, reputación, MercadoLíder y transacciones son los que informa Mercado Libre para la cuenta; la
            página de la publicación puede mostrar otro nombre. Mercado Libre no informa por esta vía estrellas,
            opiniones ni unidades en stock, así que no se muestran.
          </p>
        </>
      )}
    </section>
  );
}

function OfferRow({
  offer,
  uyu,
  minUyu,
  rate,
  onSimulate,
}: {
  key?: string;
  offer: ExactOffer;
  uyu: number | null;
  minUyu: number | null;
  rate: ExchangeRate | null;
  onSimulate: () => void;
}) {
  const seller = offer.seller;
  const reputation = seller?.reputationLevel ? REPUTATION[seller.reputationLevel] : null;
  const overMin = uyu !== null && minUyu !== null && minUyu > 0 ? Math.round(((uyu - minUyu) / minUyu) * 100) : null;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Vendedor</span>
          <span className="min-w-0 break-words text-xs font-black text-zinc-900 dark:text-zinc-100">
            {seller?.nickname ?? <span className="font-semibold text-zinc-500 dark:text-zinc-400">no disponible</span>}
          </span>
          {offer.isOfficialStore && (
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
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
          <span>{offer.sellerCity ?? "Ubicación no disponible"}</span>
          {seller ? (
            <>
              <span className="inline-flex items-center gap-1">
                {reputation && <span className={`size-2 rounded-full ${reputation.dot}`} aria-hidden />}
                Reputación: {reputation ? reputation.label : seller.reputationLevel ?? "sin nivel asignado"}
              </span>
              <span>
                {seller.transactionsTotal !== null ? (
                  <>
                    <span className="num font-bold">{seller.transactionsTotal.toLocaleString("es-UY")}</span>{" "}
                    {seller.transactionsTotal === 1 ? "transacción" : "transacciones"}
                  </>
                ) : (
                  "Transacciones no disponibles"
                )}
              </span>
            </>
          ) : (
            <span>Reputación y transacciones no disponibles</span>
          )}
        </p>
      </div>

      <div className="flex min-w-0 flex-[1_1_13rem] items-center justify-between gap-3">
        <div className="min-w-0">
          <PriceWithEquivalent amount={offer.price} currency={offer.currency} rate={rate} />
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
            {overMin !== null &&
              (overMin === 0 ? (
                <span className="font-black text-emerald-700 dark:text-emerald-400">Precio mínimo</span>
              ) : (
                <span className="font-bold">
                  <span className="num">+{overMin} %</span> sobre el mínimo
                </span>
              ))}
            {offer.freeShipping && (
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-bold">
                <Truck className="size-3" aria-hidden /> Envío gratis
              </span>
            )}
            <span>{offer.condition ? CONDITION[offer.condition] : "Condición no disponible"}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={uyu === null}
            onClick={onSimulate}
            title={
              uyu !== null
                ? "Simular con este precio de venta (en pesos)"
                : "No se puede simular: falta la cotización"
            }
            className="tap-target rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
          >
            Simular
          </button>
          <a
            href={offer.permalink}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver esta oferta en Mercado Libre"
            aria-label={`Ver la oferta de ${seller?.nickname ?? "este vendedor"} en Mercado Libre`}
            className="tap-target inline-flex size-8 items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </li>
  );
}
