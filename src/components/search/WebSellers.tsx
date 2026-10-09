import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Globe, Loader2, ShoppingCart } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  URUGUAY_LABELS,
  WEB_LIMITS,
  WEB_MESSAGES,
  googleSearchUrl,
  googleShoppingUrl,
  isMainSeller,
  parseWebSellersResponse,
  type UruguayStatus,
  type WebConfidence,
  type WebSeller,
  type WebSellersResponse,
} from "@/lib/web/sellers";

export type WebSellersState =
  | { status: "idle"; notice?: string }
  | { status: "loading"; query: string }
  | { status: "done"; data: WebSellersResponse }
  | { status: "error"; query: string; message: string; billing: boolean };

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
        const message = typeof data?.message === "string" && data.message ? data.message : WEB_MESSAGES.provider;
        setState({ status: "error", query, message, billing: data?.code === "WEB_SEARCH_NEEDS_BILLING" });
        return;
      }
      // La respuesta se valida de nuevo acá: a la pantalla solo llegan los campos esperados y enlaces https.
      const parsed = parseWebSellersResponse(data);
      setState(parsed ? { status: "done", data: parsed } : { status: "error", query, message: WEB_MESSAGES.provider, billing: false });
    } catch {
      if (abortRef.current !== controller) return;
      setState({ status: "error", query, message: WEB_MESSAGES.network, billing: false });
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

const URUGUAY_STYLES: Record<UruguayStatus, string> = {
  confirmado: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  probable: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  no_confirmado: "border-zinc-400/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

const CONFIDENCE_TEXT: Record<WebConfidence, string> = {
  alta: "Parece el mismo producto",
  media: "Producto parecido",
  baja: "Coincidencia dudosa",
};

const LINK_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer";

function SellerCard({ seller }: { seller: WebSeller }) {
  return (
    <li
      data-web-seller={seller.site}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-all text-xs font-black text-zinc-900 dark:text-zinc-100">{seller.site}</span>
        <span data-web-uruguay={seller.uruguay} className={`rounded border px-2 py-0.5 text-[11px] font-bold ${URUGUAY_STYLES[seller.uruguay]}`}>
          {URUGUAY_LABELS[seller.uruguay]}
        </span>
      </div>
      <p className="break-words text-sm font-semibold text-zinc-800 dark:text-zinc-200">{seller.title}</p>
      {seller.why && <p className="break-words text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{seller.why}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{CONFIDENCE_TEXT[seller.confidence]}</span>
        {seller.url ? (
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
        ) : (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Sin enlace directo: buscá el sitio por su nombre.</span>
        )}
      </div>
    </li>
  );
}

interface WebSellersPanelProps {
  /** Nombre que está en el campo: con él se arman los botones de Google. */
  name: string;
  state: WebSellersState;
  onCancel: () => void;
}

/** Vista "En la web (Uruguay)". El botón que lanza la búsqueda está junto al nombre, en PhotoAnalyzer. */
export function WebSellersPanel({ name, state, onCancel }: WebSellersPanelProps) {
  const usable = name.trim().length >= WEB_LIMITS.queryMin;
  const results = state.status === "done" ? state.data.results : [];
  const main = results.filter(isMainSeller);
  const others = results.filter((s) => !isMainSeller(s));
  const onlyInternational = others.every((s) => s.international);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{WEB_MESSAGES.notice}</p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Sin usar la IA:</span>
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
          data-web-error={state.billing ? "billing" : "error"}
          className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
            state.billing
              ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
              : "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300"
          }`}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 break-words">
            {state.message}
            {state.billing && " Mientras tanto podés usar los botones de Google de acá arriba."}
          </p>
        </div>
      )}

      {state.status === "done" && (
        <div className="flex min-w-0 flex-col gap-3" data-web-results>
          <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {results.length === 0
              ? WEB_MESSAGES.empty
              : main.length === 0
                ? `No encontré sitios de Uruguay para «${state.data.query}». Hay ${others.length} para revisar acá abajo.`
                : `${main.length === 1 ? "1 sitio" : `${main.length} sitios`} para «${state.data.query}». Son fuentes de la búsqueda de Google, sin precios.`}
          </p>

          {main.length > 0 && (
            <ul className="grid min-w-0 gap-2.5 lg:grid-cols-2" aria-label="Sitios de Uruguay">
              {main.map((seller) => (
                <SellerCard key={seller.site} seller={seller} />
              ))}
            </ul>
          )}

          {others.length > 0 && (
            <details data-web-others className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <summary className="cursor-pointer text-xs font-bold text-zinc-800 dark:text-zinc-200">
                {onlyInternational ? "Internacionales" : "Internacionales y sin confirmar"}: confirmá que envían a Uruguay ({others.length})
              </summary>
              <ul className="mt-3 grid min-w-0 gap-2.5 lg:grid-cols-2">
                {others.map((seller) => (
                  <SellerCard key={seller.site} seller={seller} />
                ))}
              </ul>
            </details>
          )}

          {state.data.searchQueries.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="font-bold">Google buscó:</span>
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
