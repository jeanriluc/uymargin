import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { GoogleLinks, LINK_BUTTON, URUGUAY_STYLES } from "@/components/search/WebSellers";
import { URUGUAY_LABELS } from "@/lib/web/sellers";
import {
  VISUAL_GROUP_LABELS,
  VISUAL_LIMITS,
  VISUAL_MESSAGES,
  formatVisualPrice,
  parseVisualResponse,
  type VisualGroup,
  type VisualMatch,
  type VisualSearchResponse,
} from "@/lib/photo/visual";

export type VisualState =
  | { status: "idle"; notice?: string }
  | { status: "loading" }
  | { status: "done"; data: VisualSearchResponse }
  | { status: "error"; message: string; code: string | null; canRetry: boolean };

/** ¿Conviene ofrecer la identificación con IA? Cuando la búsqueda visual falló o trajo poco de Uruguay. */
export function needsAiFallback(state: VisualState): boolean {
  return state.status === "error" || (state.status === "done" && state.data.uruguayCount < VISUAL_LIMITS.minUruguayResults);
}

/** Estado de la búsqueda visual. Vive en quien lo usa, así se conserva aunque el panel esté oculto. */
export function useVisualSearch() {
  const [state, setState] = useState<VisualState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Manda la foto. Devuelve los resultados, o null si falló, se canceló o la reemplazó otra búsqueda. */
  async function search(photo: Blob): Promise<VisualSearchResponse | null> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading" });
    try {
      const res = await apiFetch("/api/visual-search", {
        method: "POST",
        headers: { "Content-Type": photo.type },
        body: photo,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (abortRef.current !== controller) return null;
      if (!res.ok || !data?.ok) {
        const message = typeof data?.message === "string" && data.message ? data.message : VISUAL_MESSAGES.unavailable;
        const code = typeof data?.code === "string" ? data.code : null;
        // Cada intento se paga: solo se ofrece repetir cuando el servicio no respondió.
        const canRetry = code === "VISUAL_SEARCH_UNAVAILABLE" || (code === null && res.status >= 500);
        setState({ status: "error", message, code, canRetry });
        return null;
      }
      // La respuesta se valida de nuevo acá: a la pantalla solo llegan los campos esperados y enlaces https.
      const parsed = parseVisualResponse(data);
      if (!parsed || parsed.results.length === 0) {
        setState({ status: "error", message: VISUAL_MESSAGES.unavailable, code: null, canRetry: true });
        return null;
      }
      setState({ status: "done", data: parsed });
      return parsed;
    } catch {
      if (abortRef.current !== controller) return null;
      setState({ status: "error", message: VISUAL_MESSAGES.network, code: null, canRetry: true });
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle", notice: "Cancelaste la búsqueda. La foto sigue cargada." });
  }

  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }

  return { state, search, cancel, reset };
}

function MatchCard({ match }: { match: VisualMatch }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <li
      data-visual-match={match.site}
      className="flex min-w-0 gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
    >
      {match.thumbnail && !thumbFailed && (
        // Sin referrer: a quien sirve la miniatura no le llega desde qué página se pidió.
        <img
          src={match.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
          className="size-14 shrink-0 rounded border border-zinc-200 dark:border-zinc-800 bg-white object-contain"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 break-all text-xs font-black text-zinc-900 dark:text-zinc-100">{match.site}</span>
          {match.group === "uy_stores" && match.uruguay && (
            <span data-visual-uruguay={match.uruguay} className={`rounded border px-2 py-0.5 text-[11px] font-bold ${URUGUAY_STYLES[match.uruguay]}`}>
              {URUGUAY_LABELS[match.uruguay]}
            </span>
          )}
        </div>
        <p className="break-words text-sm font-semibold text-zinc-800 dark:text-zinc-200">{match.title}</p>
        {match.price && (
          <p data-visual-price className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            <strong className="font-mono text-sm font-black text-zinc-900 dark:text-zinc-100">{formatVisualPrice(match.price)}</strong>{" "}
            <span>({VISUAL_MESSAGES.priceNote})</span>
          </p>
        )}
        <div className="mt-1 flex justify-end">
          <a
            href={match.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 underline underline-offset-2 hover:no-underline"
          >
            Ver en el sitio
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="visually-hidden"> {match.site} (se abre en otra pestaña)</span>
          </a>
        </div>
      </div>
    </li>
  );
}

function MatchList({ matches }: { matches: VisualMatch[] }) {
  return (
    <ul className="grid min-w-0 gap-2.5 lg:grid-cols-2">
      {matches.map((match) => (
        <MatchCard key={match.url} match={match} />
      ))}
    </ul>
  );
}

const HEADING = "text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400";

interface VisualMatchesPanelProps {
  /** Nombre que está en el campo: con él se arman los botones de Google cuando la búsqueda falla. */
  name: string;
  state: VisualState;
  onRetry: () => void;
}

/** Resultados de la búsqueda visual, por grupo. El botón que la lanza y el de cancelar están en PhotoAnalyzer. */
export function VisualMatchesPanel({ name, state, onRetry }: VisualMatchesPanelProps) {
  if (state.status === "error") {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <div
          role="alert"
          data-visual-error={state.code ?? "error"}
          className={`flex flex-wrap items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
            state.canRetry
              ? "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          }`}
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 break-words">
            {state.message} Podés escribir el nombre acá arriba, identificarlo con IA o usar los botones de Google.
          </p>
          {state.canRetry && (
            <button type="button" onClick={onRetry} data-visual-retry className={LINK_BUTTON}>
              Reintentar
            </button>
          )}
        </div>
        <GoogleLinks name={name} />
      </div>
    );
  }
  if (state.status !== "done") return null;

  const { results, mlCount, uruguayCount } = state.data;
  const of = (group: VisualGroup) => results.filter((m) => m.group === group);
  const ml = of("ml_uy");
  const stores = of("uy_stores");
  const abroad = of("abroad");
  const others = of("others");

  return (
    <div className="flex min-w-0 flex-col gap-4" data-visual-results>
      <div className="flex flex-col gap-1">
        <p role="status" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {uruguayCount === 0
            ? "No encontré esta foto en sitios de Uruguay. Mirá los otros resultados acá abajo."
            : `${uruguayCount === 1 ? "1 resultado" : `${uruguayCount} resultados`} de Uruguay para esta foto.`}
        </p>
        <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{VISUAL_MESSAGES.notice}</p>
      </div>

      {ml.length > 0 && (
        <section data-visual-group="ml_uy" className="flex min-w-0 flex-col gap-2">
          <h3 className={HEADING}>
            {VISUAL_GROUP_LABELS.ml_uy} ({mlCount})
          </h3>
          <MatchList matches={ml} />
          <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {mlCount > ml.length ? `Se muestran ${ml.length} de ${mlCount} publicaciones. ` : ""}
            Para ver los precios reales de Mercado Libre, usá «Analizar en Radar».
          </p>
        </section>
      )}

      {stores.length > 0 && (
        <section data-visual-group="uy_stores" className="flex min-w-0 flex-col gap-2">
          <h3 className={HEADING}>
            {VISUAL_GROUP_LABELS.uy_stores} ({stores.length})
          </h3>
          <MatchList matches={stores} />
        </section>
      )}

      {abroad.length > 0 && (
        <details data-visual-group="abroad" className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
          <summary className="cursor-pointer text-xs font-bold text-zinc-800 dark:text-zinc-200">
            {VISUAL_GROUP_LABELS.abroad}: confirmá que envían a Uruguay ({abroad.length})
          </summary>
          <div className="mt-3">
            <MatchList matches={abroad} />
          </div>
        </details>
      )}

      {others.length > 0 && (
        <details data-visual-group="others" className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
          <summary className="cursor-pointer text-xs font-bold text-zinc-800 dark:text-zinc-200">
            {VISUAL_GROUP_LABELS.others} ({others.length})
          </summary>
          <div className="mt-3">
            <MatchList matches={others} />
          </div>
        </details>
      )}
    </div>
  );
}
