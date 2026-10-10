import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Globe, Loader2, ShoppingCart } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  URUGUAY_LABELS,
  WEB_LIMITS,
  WEB_MESSAGES,
  googleSearchUrl,
  googleShoppingUrl,
  isForeignSite,
  isMainSeller,
  webQueryKey,
  parseWebSellersResponse,
  type UruguayStatus,
  type WebSeller,
  type WebSellersResponse,
} from "@/lib/web/sellers";

export type WebSellersState =
  | { status: "idle"; notice?: string }
  | { status: "loading"; query: string }
  | { status: "done"; data: WebSellersResponse }
  | { status: "error"; query: string; message: string; code: string | null; canRetry: boolean };

/** Estado de la búsqueda web. Vive en quien lo usa, así se conserva aunque el panel esté oculto. */
export function useWebSellers() {
  const [state, setState] = useState<WebSellersState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function search(name: string) {
    const query = name.replace(/\s+/g, " ").trim();
    if (query.length < WEB_LIMITS.queryMin) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading", query });
    try {
      const res = await apiFetch("/api/web-sellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (abortRef.current !== controller) return;
      if (!res.ok || !data?.ok) {
        const message = typeof data?.message === "string" && data.message ? data.message : WEB_MESSAGES.unavailable;
        const code = typeof data?.code === "string" ? data.code : null;
        // Sin token o sin crédito, reintentar no cambia nada: solo se ofrece cuando el servicio no respondió.
        const canRetry = code !== "WEB_SEARCH_NOT_CONFIGURED" && code !== "WEB_SEARCH_NO_CREDIT" && res.status !== 429 && res.status !== 400;
        setState({ status: "error", query, message, code, canRetry });
        return;
      }
      // La respuesta se valida de nuevo acá: a la pantalla solo llegan los campos esperados y enlaces https.
      const parsed = parseWebSellersResponse(data);
      setState(parsed ? { status: "done", data: parsed } : { status: "error", query, message: WEB_MESSAGES.unavailable, code: null, canRetry: true });
    } catch {
      if (abortRef.current !== controller) return;
      setState({ status: "error", query, message: WEB_MESSAGES.network, code: null, canRetry: true });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle", notice: "Cancelaste la búsqueda web." });
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }

  return { state, search, cancel, reset };
}

export const URUGUAY_STYLES: Record<UruguayStatus, string> = {
  confirmado: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  probable: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  no_confirmado: "border-zinc-400/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

export const LINK_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer";

/** Línea chica que guarda, plegados, los resultados de sitios del exterior. Sin ocultados no se muestra. */
function HiddenForeign({ sellers }: { sellers: WebSeller[] }) {
  if (sellers.length === 0) return null;
  return (
    <details data-hidden-foreign className="min-w-0">
      <summary className="cursor-pointer text-[11px] text-zinc-600 dark:text-zinc-400">
        {sellers.length === 1 ? "Se ocultó 1 resultado de otros países" : `Se ocultaron ${sellers.length} resultados de otros países`}.{" "}
        <span className="font-bold underline underline-offset-2">Ver</span>
      </summary>
      <ul className="mt-3 grid min-w-0 gap-2.5 lg:grid-cols-2">
        {sellers.map((seller) => (
          <SellerCard key={seller.url} seller={seller} />
        ))}
      </ul>
    </details>
  );
}

function SellerCard({ seller }: { seller: WebSeller }) {
  return (
    <li
      data-web-seller={seller.site}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-all text-xs font-black text-zinc-900 dark:text-zinc-100">{seller.site}</span>
        {/* A lo que no es una tienda no se le pone el indicador de Uruguay: no vende. */}
        {seller.kind === "store" && (
          <span data-web-uruguay={seller.uruguay} className={`rounded border px-2 py-0.5 text-[11px] font-bold ${URUGUAY_STYLES[seller.uruguay]}`}>
            {URUGUAY_LABELS[seller.uruguay]}
          </span>
        )}
      </div>
      <p className="break-words text-sm font-semibold text-zinc-800 dark:text-zinc-200">{seller.title}</p>
      {seller.why && <p className="break-words text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{seller.why}</p>}
      <div className="mt-1 flex justify-end">
        <a
          href={seller.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 underline underline-offset-2 hover:no-underline"
        >
          Ver en el sitio
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="visually-hidden"> {seller.site} (se abre en otra pestaña)</span>
        </a>
      </div>
    </li>
  );
}

/** Botones gratuitos de Google Uruguay para un nombre. No gastan nada: abren la búsqueda en otra pestaña. */
export function GoogleLinks({ name }: { name: string }) {
  const usable = name.trim().length >= WEB_LIMITS.queryMin;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Gratis, en otra pestaña:</span>
      {usable ? (
        <>
          <a href={googleSearchUrl(name)} target="_blank" rel="noopener noreferrer" data-google="search" className={LINK_BUTTON}>
            <Globe className="size-3.5" aria-hidden />
            <span>Buscar en Google Uruguay</span>
            <span className="visually-hidden"> (se abre en otra pestaña)</span>
          </a>
          <a href={googleShoppingUrl(name)} target="_blank" rel="noopener noreferrer" data-google="shopping" className={LINK_BUTTON}>
            <ShoppingCart className="size-3.5" aria-hidden />
            <span>Google Shopping Uruguay</span>
            <span className="visually-hidden"> (se abre en otra pestaña)</span>
          </a>
        </>
      ) : (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Escribí el nombre del producto para armar la búsqueda.</span>
      )}
    </div>
  );
}

/** ¿El estado de la búsqueda web corresponde a este nombre? */
function isSearchFor(state: WebSellersState, name: string): boolean {
  const query = state.status === "done" ? state.data.query : state.status === "idle" ? null : state.query;
  return query !== null && webQueryKey(query) === webQueryKey(name);
}

interface NameSearchResultsProps {
  /** Nombre con el que se lanzó sola la búsqueda (el que propuso la IA). */
  name: string;
  state: WebSellersState;
  /** Lanza a mano la búsqueda por nombre, con lo que haya en el campo. */
  onSearch: () => void;
  canSearch: boolean;
}

/**
 * Búsqueda por nombre que se lanzó sola porque la foto trajo poco de Uruguay. Muestra, en la misma vista de
 * la foto, solo las tiendas de Uruguay; el resto está en «En la web (Uruguay)». Nunca reintenta por su cuenta.
 */
export function NameSearchResults({ name, state, onSearch, canSearch }: NameSearchResultsProps) {
  if (!isSearchFor(state, name)) return null;
  const main = state.status === "done" ? state.data.results.filter((s) => !isForeignSite(s.site) && isMainSeller(s)) : [];
  const rest = state.status === "done" ? state.data.results.length - main.length : 0;
  return (
    <section data-auto-web className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
        Búsqueda por nombre en Google Uruguay (nombre sugerido por IA)
      </h3>
      {state.status === "loading" && (
        <p role="status" className="flex items-center gap-2 text-xs font-bold text-zinc-800 dark:text-zinc-200">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Buscando «{name}» en Google Uruguay…
        </p>
      )}
      {state.status === "error" && (
        <div role="status" data-auto-web-error={state.code ?? "error"} className="flex flex-wrap items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
          <p className="min-w-0 flex-1 break-words">{state.message}</p>
          {/* No se reintenta sola: si tiene sentido repetirla, queda el botón. */}
          {(state.canRetry || state.code === "RATE_LIMITED") && (
            <button type="button" onClick={onSearch} disabled={!canSearch} data-auto-web-manual className={LINK_BUTTON}>
              Buscar por nombre
            </button>
          )}
        </div>
      )}
      {state.status === "done" && (
        <>
          <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {main.length === 0
              ? `La búsqueda de «${state.data.query}» no encontró tiendas de Uruguay.`
              : `${main.length === 1 ? "1 tienda" : `${main.length} tiendas`} de Uruguay para «${state.data.query}».`}
            {rest > 0 ? " El resto de los resultados está en la vista «En la web (Uruguay)»." : ""}
          </p>
          {main.length > 0 && (
            <ul className="grid min-w-0 gap-2.5 lg:grid-cols-2">
              {main.map((seller) => (
                <SellerCard key={seller.url} seller={seller} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

interface WebSellersPanelProps {
  /** Nombre que está en el campo: con él se arman los botones de Google. */
  name: string;
  state: WebSellersState;
  onCancel: () => void;
  /** Repite la última búsqueda que falló. */
  onRetry: (query: string) => void;
}

/** Vista "En la web (Uruguay)". El botón que lanza la búsqueda está junto al nombre, en PhotoAnalyzer. */
export function WebSellersPanel({ name, state, onCancel, onRetry }: WebSellersPanelProps) {
  const all = state.status === "done" ? state.data.results : [];
  // Los sitios del exterior (lista de sellers.ts) no se muestran: quedan detrás de "Se ocultaron N".
  const hidden = all.filter((s) => isForeignSite(s.site));
  const results = all.filter((s) => !isForeignSite(s.site));
  const main = results.filter(isMainSeller);
  // Tiendas que no se pudo ubicar en Uruguay, y aparte lo que no es una tienda.
  const unconfirmed = results.filter((s) => s.kind === "store" && !isMainSeller(s));
  const nonStores = results.filter((s) => s.kind === "other");

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{WEB_MESSAGES.notice}</p>

      <GoogleLinks name={name} />

      {state.status === "idle" && state.notice && (
        <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {state.notice}
        </p>
      )}

      {state.status === "loading" && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="flex items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Buscando en la web…
          </p>
          <button type="button" onClick={onCancel} className={LINK_BUTTON}>
            Cancelar
          </button>
        </div>
      )}

      {state.status === "error" && (
        <div
          role="alert"
          data-web-error={state.code ?? "error"}
          className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
            state.canRetry
              ? "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          }`}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 break-words">
            {state.message}
            {state.code === "WEB_SEARCH_NO_CREDIT" && ". Los botones de Google de acá arriba siguen funcionando."}
          </p>
          {state.canRetry && (
            <button type="button" onClick={() => onRetry(state.query)} data-web-retry className={LINK_BUTTON}>
              Reintentar
            </button>
          )}
        </div>
      )}

      {state.status === "done" && (
        <div className="flex min-w-0 flex-col gap-3" data-web-results>
          <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {all.length === 0
              ? WEB_MESSAGES.empty
              : main.length === 0
                ? `No encontré tiendas de Uruguay para «${state.data.query}».${results.length > 0 ? " Mirá los otros resultados acá abajo." : ""}`
                : `${main.length === 1 ? "1 resultado" : `${main.length} resultados`} de tiendas para «${state.data.query}».`}
          </p>

          {main.length > 0 && (
            <ul className="grid min-w-0 gap-2.5 lg:grid-cols-2" aria-label="Tiendas de Uruguay">
              {main.map((seller) => (
                <SellerCard key={seller.url} seller={seller} />
              ))}
            </ul>
          )}

          <HiddenForeign sellers={hidden} />

          {unconfirmed.length > 0 && (
            <details data-web-others className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <summary className="cursor-pointer text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Sin confirmar: confirmá que envían a Uruguay ({unconfirmed.length})
              </summary>
              <ul className="mt-3 grid min-w-0 gap-2.5 lg:grid-cols-2">
                {unconfirmed.map((seller) => (
                  <SellerCard key={seller.url} seller={seller} />
                ))}
              </ul>
            </details>
          )}

          {nonStores.length > 0 && (
            <details data-web-non-stores className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <summary className="cursor-pointer text-xs font-bold text-zinc-800 dark:text-zinc-200">
                Otros resultados: no son tiendas ({nonStores.length})
              </summary>
              <ul className="mt-3 grid min-w-0 gap-2.5 lg:grid-cols-2">
                {nonStores.map((seller) => (
                  <SellerCard key={seller.url} seller={seller} />
                ))}
              </ul>
            </details>
          )}

          {state.data.searchQueries.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="font-bold">Se buscó en Google:</span>
              {state.data.searchQueries.map((q) => (
                <a key={q} href={googleSearchUrl(q)} target="_blank" rel="noopener noreferrer" className="break-words underline underline-offset-2 hover:no-underline">
                  {q}
                </a>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
