import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { PHOTO_MESSAGES, sniffImageType } from "../src/lib/photo/identify.js";
import {
  VISUAL_LIMITS,
  VISUAL_MESSAGES,
  buildVisualMatches,
  parseLensItems,
  type RawLensItem,
  type VisualSearchErrorCode,
  type VisualSummary,
} from "../src/lib/photo/visual.js";
import { receiveImage } from "./identify.js";
import { NO_CREDIT_TYPES, type FetchLike } from "./webSellers.js";

/**
 * /api/visual-search: dónde se vende el producto de una foto, según Google Lens (Apify, actor
 * johnvc/google-lens-api). La imagen vive solo en memoria mientras dura el pedido: no se escribe en disco
 * ni en Supabase y nunca se registra; de ella solo se conserva un hash, para no pagar dos veces la misma
 * foto. El servidor solo habla con la API de Apify: nunca visita los enlaces que devuelve la búsqueda.
 * El buscador se inyecta, así los tests no llaman a nadie.
 */

export const APIFY_LENS_URL = "https://api.apify.com/v2/acts/johnvc~google-lens-api/run-sync-get-dataset-items";
/** Espera máxima por búsqueda. La función de Vercel tiene 60 s (vercel.json). */
export const VISUAL_SEARCH_TIMEOUT_MS = 45_000;

/** Memoria de respuestas, por hash de la foto. */
export const VISUAL_CACHE = { ttlMs: 30 * 60 * 1000, maxEntries: 50 } as const;

/** Busca la imagen y devuelve los items de Google Lens. Lanza VisualSearchError si no se pudo. */
export type LensProvider = (image: Buffer) => Promise<RawLensItem[]>;

/** La búsqueda visual falló por un motivo que la pantalla sabe explicar. */
export class VisualSearchError extends Error {
  constructor(
    readonly code: VisualSearchErrorCode,
    /** Dato corto para el log: el estado HTTP o el tipo de falla. Nunca lleva el token, la imagen ni el mensaje del actor. */
    readonly detail: string
  ) {
    super(code);
  }
}

/** Coincidencias visuales en Google Uruguay. "products" está discontinuado en el actor y devuelve error. */
export function lensInput(imageBase64: string) {
  return {
    image_base64: [imageBase64],
    search_type: "visual_matches",
    max_results: VISUAL_LIMITS.requested,
    country: "uy",
    language: "es",
  };
}

/**
 * Búsqueda visual con Apify. El token viaja solo en el encabezado Authorization, nunca en la dirección.
 * No reintenta: cada llamada se paga.
 */
export function createApifyLens(options: { token: string; fetch: FetchLike; timeoutMs?: number }): LensProvider {
  const timeoutMs = options.timeoutMs ?? VISUAL_SEARCH_TIMEOUT_MS;
  return async (image) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let data: unknown;
    try {
      const res = await options.fetch(APIFY_LENS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(lensInput(image.toString("base64"))),
        signal: controller.signal,
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch {
      throw new VisualSearchError("VISUAL_SEARCH_UNAVAILABLE", controller.signal.aborted ? "tiempo agotado" : "error de red");
    } finally {
      clearTimeout(timer);
    }

    if (status >= 200 && status < 300) {
      // Cuando el actor falla, la corrida igual termina bien y el dataset trae un item de error.
      const parsed = parseLensItems(data);
      if (parsed.ok === false) throw new VisualSearchError("VISUAL_SEARCH_UNAVAILABLE", parsed.reason);
      return parsed.items;
    }
    const errorType = String((data as { error?: { type?: unknown } } | null)?.error?.type ?? "");
    if (status === 401) throw new VisualSearchError("VISUAL_SEARCH_NOT_CONFIGURED", "HTTP 401");
    if (status === 402 || NO_CREDIT_TYPES.test(errorType)) throw new VisualSearchError("VISUAL_SEARCH_NO_CREDIT", `HTTP ${status}`);
    throw new VisualSearchError("VISUAL_SEARCH_UNAVAILABLE", `HTTP ${status}`);
  };
}

// ------------------------------------------------------------------
// Memoria de respuestas
// ------------------------------------------------------------------

/** Lo que se pagó y se puede repetir gratis: una lista de resultados o "sin coincidencias". */
type CachedAnswer = VisualSummary | "sin coincidencias";

export interface VisualCache {
  get(hash: string): CachedAnswer | null;
  set(hash: string, value: CachedAnswer): void;
  size(): number;
}

/** SHA-256 de los bytes de la foto. Es lo único de la imagen que queda en memoria después del pedido. */
export function imageHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** En memoria de esta instancia: en Vercel cada instancia tiene la suya y se pierde al reiniciarse. */
export function createVisualCache(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): VisualCache {
  const ttlMs = options.ttlMs ?? VISUAL_CACHE.ttlMs;
  const maxEntries = options.maxEntries ?? VISUAL_CACHE.maxEntries;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: CachedAnswer; expires: number }>();
  return {
    get(hash) {
      const hit = entries.get(hash);
      if (!hit) return null;
      if (hit.expires <= now()) {
        entries.delete(hash);
        return null;
      }
      return hit.value;
    },
    set(hash, value) {
      entries.delete(hash);
      for (const [k, entry] of entries) if (entry.expires <= now()) entries.delete(k);
      // Si sigue llena, sale la más vieja (el Map conserva el orden de carga).
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
      entries.set(hash, { value, expires: now() + ttlMs });
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

const ERROR_RESPONSES: Record<VisualSearchErrorCode, { status: number; message: string }> = {
  VISUAL_SEARCH_NOT_CONFIGURED: { status: 503, message: VISUAL_MESSAGES.notConfigured },
  VISUAL_SEARCH_NO_CREDIT: { status: 503, message: VISUAL_MESSAGES.noCredit },
  VISUAL_SEARCH_UNAVAILABLE: { status: 502, message: VISUAL_MESSAGES.unavailable },
  VISUAL_SEARCH_NO_MATCHES: { status: 404, message: VISUAL_MESSAGES.noMatches },
};

/**
 * Manejadores de la ruta, en orden. El control de acceso va antes (lo pone server/app.ts).
 * El límite de uso se recibe acá porque va después de mirar la memoria: repetir una foto ya respondida
 * no gasta un uso ni una búsqueda paga. `lens` devuelve null si falta el token.
 */
export function createVisualSearchRoute(options: {
  lens: () => LensProvider | null;
  limiter: RequestHandler;
  cache?: VisualCache;
}): RequestHandler[] {
  const cache = options.cache ?? createVisualCache();
  const failWith = (res: Response, code: VisualSearchErrorCode) => fail(res, ERROR_RESPONSES[code].status, code, ERROR_RESPONSES[code].message);

  const prepare: RequestHandler = (req, res, next) => {
    const bytes: Buffer | null = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
    if (!bytes) return fail(res, 400, "INVALID_IMAGE", PHOTO_MESSAGES.unreadable);
    // Se confía en los primeros bytes, no en el tipo que declara el navegador.
    if (!sniffImageType(bytes)) return fail(res, 400, "NOT_AN_IMAGE", PHOTO_MESSAGES.type);
    const hash = imageHash(bytes);
    const hit = cache.get(hash);
    if (hit === "sin coincidencias") return failWith(res, "VISUAL_SEARCH_NO_MATCHES");
    if (hit) return res.json({ ok: true, ...hit, cached: true });
    res.locals.visual = { bytes, hash };
    return next();
  };

  const run: RequestHandler = async (_req, res) => {
    const { bytes, hash } = res.locals.visual as { bytes: Buffer; hash: string };
    const lens = options.lens();
    if (!lens) return failWith(res, "VISUAL_SEARCH_NOT_CONFIGURED");

    try {
      const value = buildVisualMatches(await lens(bytes));
      // Solo la cantidad: ni la foto, ni su hash, ni los sitios quedan en el log.
      console.info(`[api/visual-search] resultados: ${value.results.length}`);
      if (value.results.length === 0) {
        cache.set(hash, "sin coincidencias");
        return failWith(res, "VISUAL_SEARCH_NO_MATCHES");
      }
      cache.set(hash, value);
      return res.json({ ok: true, ...value, cached: false });
    } catch (err) {
      const known = err instanceof VisualSearchError ? err : null;
      console.error("[api/visual-search] la búsqueda falló:", known ? `${known.code} (${known.detail})` : "error inesperado");
      return failWith(res, known?.code ?? "VISUAL_SEARCH_UNAVAILABLE");
    }
  };

  return [receiveImage, prepare, options.limiter, run];
}
