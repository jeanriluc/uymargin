import type { RequestHandler, Response } from "express";
import {
  WEB_MESSAGES,
  buildSearchQuery,
  buildWebSellers,
  cleanWebQuery,
  isVerifiableSeller,
  parseSearchItems,
  webQueryKey,
  type RawSearchResult,
  type WebSearchErrorCode,
  type WebSeller,
} from "../src/lib/web/sellers.js";

/**
 * /api/web-sellers: qué sitios venden un producto, según una búsqueda en Google Uruguay hecha con Apify
 * (actor apify/google-search-scraper). El servidor solo habla con la API de Apify: nunca visita los
 * enlaces que devuelve la búsqueda, solo los valida y los muestra. No se guardan ni se registran la
 * consulta ni los resultados. El buscador se inyecta, así los tests no llaman a nadie.
 */

export const APIFY_SEARCH_URL = "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items";
/** Espera máxima por búsqueda. La función de Vercel tiene 60 s (vercel.json). */
export const WEB_SEARCH_TIMEOUT_MS = 45_000;

/** Memoria de respuestas, para no pagar dos veces la misma búsqueda. */
export const WEB_CACHE = { ttlMs: 30 * 60 * 1000, maxEntries: 100 } as const;

/** Hace la búsqueda y devuelve los resultados orgánicos de Google. Lanza WebSearchError si no se pudo. */
export type WebSearchProvider = (searchQuery: string) => Promise<RawSearchResult[]>;

/** La búsqueda web falló por un motivo que la pantalla sabe explicar. */
export class WebSearchError extends Error {
  constructor(
    readonly code: WebSearchErrorCode,
    /** Dato corto para el log: el estado HTTP o el tipo de falla. Nunca lleva el token ni la consulta. */
    readonly detail: string
  ) {
    super(code);
  }
}

export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Tipos de error de Apify que significan "no hay crédito o se llegó al límite de uso de la cuenta". */
export const NO_CREDIT_TYPES = /not-enough-usage|usage-limit|limit-reached|monthly-usage|failed-to-charge|payment-required|insufficient-(?:credit|funds|usage)/i;

/** Una sola consulta a Google Uruguay, una página, sin guardar el HTML. */
export function searchInput(searchQuery: string) {
  return {
    queries: searchQuery,
    countryCode: "uy",
    languageCode: "es",
    maxPagesPerQuery: 1,
    mobileResults: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
  };
}

/**
 * Buscador con Apify. El token viaja solo en el encabezado Authorization, nunca en la dirección.
 * No reintenta: cada llamada se paga.
 */
export function createApifySearcher(options: { token: string; fetch: FetchLike; timeoutMs?: number }): WebSearchProvider {
  const timeoutMs = options.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS;
  return async (searchQuery) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let data: unknown;
    try {
      const res = await options.fetch(APIFY_SEARCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(searchInput(searchQuery)),
        signal: controller.signal,
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch {
      throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", controller.signal.aborted ? "tiempo agotado" : "error de red");
    } finally {
      clearTimeout(timer);
    }

    if (status >= 200 && status < 300) {
      const results = parseSearchItems(data);
      if (!results) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "respuesta con otra forma");
      return results;
    }
    const errorType = String((data as { error?: { type?: unknown } } | null)?.error?.type ?? "");
    if (status === 401) throw new WebSearchError("WEB_SEARCH_NOT_CONFIGURED", "HTTP 401");
    if (status === 402 || NO_CREDIT_TYPES.test(errorType)) throw new WebSearchError("WEB_SEARCH_NO_CREDIT", `HTTP ${status}`);
    throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", `HTTP ${status}`);
  };
}

// ------------------------------------------------------------------
// Memoria de respuestas
// ------------------------------------------------------------------

interface CachedAnswer {
  query: string;
  results: WebSeller[];
  searchQueries: string[];
}

export interface WebCache {
  get(query: string): CachedAnswer | null;
  set(query: string, value: CachedAnswer): void;
  size(): number;
}

/** En memoria de esta instancia: en Vercel cada instancia tiene la suya y se pierde al reiniciarse. */
export function createWebCache(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): WebCache {
  const ttlMs = options.ttlMs ?? WEB_CACHE.ttlMs;
  const maxEntries = options.maxEntries ?? WEB_CACHE.maxEntries;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: CachedAnswer; expires: number }>();
  return {
    get(query) {
      const key = webQueryKey(query);
      const hit = entries.get(key);
      if (!hit) return null;
      if (hit.expires <= now()) {
        entries.delete(key);
        return null;
      }
      return hit.value;
    },
    set(query, value) {
      const key = webQueryKey(query);
      entries.delete(key);
      for (const [k, entry] of entries) if (entry.expires <= now()) entries.delete(k);
      // Si sigue llena, sale la más vieja (el Map conserva el orden de carga).
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(key, { value, expires: now() + ttlMs });
    },
    size: () => entries.size,
  };
}

// ------------------------------------------------------------------
// Ruta
// ------------------------------------------------------------------

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, code, message, error: message });
}

const ERROR_RESPONSES: Record<WebSearchErrorCode, { status: number; message: string }> = {
  WEB_SEARCH_NOT_CONFIGURED: { status: 503, message: WEB_MESSAGES.notConfigured },
  WEB_SEARCH_NO_CREDIT: { status: 503, message: WEB_MESSAGES.noCredit },
  WEB_SEARCH_UNAVAILABLE: { status: 502, message: WEB_MESSAGES.unavailable },
};

/**
 * Manejadores de la ruta, en orden. El control de acceso va antes (lo pone server/app.ts).
 * El límite de uso se recibe acá porque va después de mirar la memoria: repetir una búsqueda ya
 * respondida no gasta un uso ni una búsqueda paga. `search` devuelve null si falta el token.
 */
export function createWebSellersRoute(options: {
  search: () => WebSearchProvider | null;
  limiter: RequestHandler;
  cache?: WebCache;
  /** Firma el permiso para verificar una dirección (ronda 14). Devuelve null si la verificación no está configurada. */
  sign?: (res: Response, url: string) => string | null;
}): RequestHandler[] {
  const cache = options.cache ?? createWebCache();
  // El permiso es de cada usuario y vence: se agrega al responder, nunca queda en la memoria de respuestas.
  const withTokens = (res: Response, value: CachedAnswer): CachedAnswer => ({
    ...value,
    results: value.results.map((seller) => {
      const token = isVerifiableSeller(seller) ? options.sign?.(res, seller.url) : null;
      return token ? { ...seller, verifyToken: token } : seller;
    }),
  });

  const prepare: RequestHandler = (req, res, next) => {
    const query = cleanWebQuery(req.body?.query);
    if (!query) return fail(res, 400, "INVALID_QUERY", WEB_MESSAGES.query);
    const hit = cache.get(query);
    if (hit) return res.json({ ok: true, ...withTokens(res, hit), query, cached: true });
    res.locals.webQuery = query;
    return next();
  };

  const run: RequestHandler = async (_req, res) => {
    const query = res.locals.webQuery as string;
    const failWith = (code: WebSearchErrorCode) => fail(res, ERROR_RESPONSES[code].status, code, ERROR_RESPONSES[code].message);

    const search = options.search();
    if (!search) return failWith("WEB_SEARCH_NOT_CONFIGURED");

    const searchQuery = buildSearchQuery(query);
    try {
      const value: CachedAnswer = { query, results: buildWebSellers(await search(searchQuery)), searchQueries: [searchQuery] };
      // Solo la cantidad: ni la consulta ni los sitios quedan en el log.
      console.info(`[api/web-sellers] resultados: ${value.results.length}`);
      cache.set(query, value);
      return res.json({ ok: true, ...withTokens(res, value), cached: false });
    } catch (err) {
      const known = err instanceof WebSearchError ? err : null;
      console.error("[api/web-sellers] la búsqueda falló:", known ? `${known.code} (${known.detail})` : "error inesperado");
      return failWith(known?.code ?? "WEB_SEARCH_UNAVAILABLE");
    }
  };

  return [prepare, options.limiter, run];
}
