import express from "express";
import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
// Extensión .js a propósito: es lo que resuelve el runtime ESM de Node en Vercel (tsx y tsc la mapean a .ts).
import { BCU_LAST_CLOSE, buildBcuQuoteRequest, parseBcuLastClose, parseBcuQuote } from "../src/lib/bcu.js";
import { normalizeCurrency } from "../src/lib/currency.js";
import { VIABILITY_CRITERIA } from "../src/lib/finance/constants.js";
import type {
  CatalogCandidate,
  ExactMatch,
  ExactOffer,
  ExactOfferSeller,
  ExactProductBlock,
  ExactSelection,
  MluItem,
  RadarRelevance,
  SimilarCriteria,
} from "../src/lib/mlu/types.js";
import {
  brandKey,
  nameHasTypeWords,
  productBrand,
  productTexts,
  productTypeWords,
  queryTerms,
  relevanceOf,
} from "../src/lib/mlu/relevance.js";
import path from "path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createAuthMiddleware, isAuthDisabled, requestUser } from "./auth.js";
import { createMemoryRateStore, createRateLimiter, RATE_RULES } from "./rateLimit.js";
import { createAudit, deleteAudit, listAudits, supabaseRateStore, verifySupabaseToken } from "./cloud.js";

dotenv.config();

/**
 * App Express con todas las rutas /api/*. No abre puertos ni monta Vite/dist: eso lo hace
 * server/local.ts en ejecución local; en Vercel cada archivo de api/ exporta este mismo app.
 */
const app = express();
/** En Vercel (funciones sin estado y disco de solo lectura salvo /tmp). */
export const isVercel = Boolean(process.env.VERCEL);
export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
// Solo esta máquina por defecto; HOST=0.0.0.0 para exponerlo a la red a propósito.
export const HOST = process.env.HOST?.trim() || "127.0.0.1";
// Dirección con la que el servidor se llama a sí mismo (tracking); 0.0.0.0 / :: no son destinos válidos.
const SELF_HOST = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
export const isProduction = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "256kb" }));

// ------------------------------------------------------------------
// 0. Acceso: todas las rutas /api/* exigen sesión de Supabase y correo en ALLOWED_EMAILS (server/auth.ts).
//    Va antes de cualquier ruta; en Vercel cada archivo de api/ exporta este mismo app, así que aplica igual.
// ------------------------------------------------------------------
if (isAuthDisabled()) {
  console.warn("[auth] AUTH_DISABLED=true: las rutas /api/* no piden sesión. Solo para desarrollo local.");
}
app.use("/api", createAuthMiddleware({ verifyToken: verifySupabaseToken }));

// Límite de uso por usuario. El contador vive en Supabase (compartido entre instancias de Vercel);
// si no responde, o sin sesión real en desarrollo, se cuenta en la memoria de esta instancia.
const memoryRateStore = createMemoryRateStore();
const rateLimit = createRateLimiter({
  store: () => (isAuthDisabled() ? memoryRateStore : supabaseRateStore),
  fallback: memoryRateStore,
  userId: (res) => requestUser(res).id,
});

// ------------------------------------------------------------------
// 1. Exchange Rate Endpoint (USD -> UYU)
//    Fuente: Banco Central del Uruguay (ver src/lib/bcu.ts). Si el BCU no responde se devuelve
//    el último valor guardado, marcado como no actualizado. Nunca se devuelve un valor inventado.
// ------------------------------------------------------------------
interface ServerRate {
  rate: number;
  buy: number;
  sell: number;
  referenceDate: string;
  source: "bcu";
  fetchedAt: string;
}

// En Vercel solo /tmp es escribible (y no se comparte entre instancias): es un caché de mejor esfuerzo.
// El cliente guarda además la última cotización en localStorage.
const RATE_CACHE_FILE = isVercel
  ? path.join(os.tmpdir(), "uymargin-exchange-rate.json")
  : path.resolve(process.cwd(), ".cache", "exchange-rate.json");
const RATE_MEMORY_TTL_MS = 30 * 60 * 1000;
let lastKnownRate: ServerRate | null = null;
let lastRateCheck = 0;

function loadRateFromDisk(): ServerRate | null {
  try {
    const v = JSON.parse(fs.readFileSync(RATE_CACHE_FILE, "utf8"));
    return typeof v?.rate === "number" && v.rate > 0 && typeof v.referenceDate === "string" ? (v as ServerRate) : null;
  } catch {
    return null;
  }
}

function saveRateToDisk(rate: ServerRate): void {
  try {
    fs.mkdirSync(path.dirname(RATE_CACHE_FILE), { recursive: true });
    fs.writeFileSync(RATE_CACHE_FILE, JSON.stringify(rate, null, 2));
  } catch (err) {
    console.warn("[exchange-rate] no se pudo guardar la cotización en disco:", err);
  }
}

async function bcuSoap(request: { url: string; soapAction: string; body: string }): Promise<string> {
  const r = await fetch(request.url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${request.soapAction}"` },
    body: request.body,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`BCU respondió HTTP ${r.status}`);
  return r.text();
}

async function fetchBcuRate(): Promise<ServerRate> {
  const lastClose = parseBcuLastClose(await bcuSoap(BCU_LAST_CLOSE));
  if (!lastClose) throw new Error("El BCU no informó la fecha del último cierre");
  const result = parseBcuQuote(await bcuSoap(buildBcuQuoteRequest(lastClose)));
  if (!result.ok) throw new Error(result.error);
  return {
    // Interbancario comprador; en las respuestas del BCU comprador y vendedor coinciden.
    rate: result.quote.buy,
    buy: result.quote.buy,
    sell: result.quote.sell,
    referenceDate: result.quote.date,
    source: "bcu",
    fetchedAt: new Date().toISOString(),
  };
}

/** Última cotización conocida (memoria o disco), sin consultar al BCU. */
function getLastKnownRate(): ServerRate | null {
  if (!lastKnownRate) lastKnownRate = loadRateFromDisk();
  return lastKnownRate;
}

/** Cotización para un pedido: la que manda el cliente si es válida; si no, la última conocida. */
function rateFromRequest(value: unknown): number | null {
  const n = parseFloat(String(value ?? ""));
  if (Number.isFinite(n) && n > 0) return n;
  return getLastKnownRate()?.rate ?? null;
}

const NO_RATE_MESSAGE =
  "No hay cotización del dólar disponible. Ingresá el valor a mano en el encabezado y volvé a intentar.";

app.get("/api/exchange-rate", async (req, res) => {
  const force = req.query.refresh === "1";
  const known = getLastKnownRate();
  if (!force && known && Date.now() - lastRateCheck < RATE_MEMORY_TTL_MS) {
    return res.json({ ok: true, ...known, stale: false });
  }

  try {
    const fresh = await fetchBcuRate();
    lastKnownRate = fresh;
    lastRateCheck = Date.now();
    saveRateToDisk(fresh);
    return res.json({ ok: true, ...fresh, stale: false });
  } catch (err: any) {
    const reason = err?.message || "sin respuesta";
    console.warn("[exchange-rate] BCU no disponible:", reason);
    if (known) {
      return res.json({ ok: true, ...known, stale: true, error: `No se pudo actualizar con el BCU (${reason}).` });
    }
    return res.status(503).json({
      ok: false,
      code: "RATE_UNAVAILABLE",
      message: `No se pudo obtener la cotización del BCU (${reason}) y no hay un valor guardado.`,
    });
  }
});

// ------------------------------------------------------------------
// 2. Mercado Libre Uruguay Search Endpoint
// ------------------------------------------------------------------
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

let cachedAppToken: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string | null> {
  const direct = process.env.ML_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const clientId = process.env.ML_CLIENT_ID?.trim();
  const clientSecret = process.env.ML_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + 60_000) {
    return cachedAppToken.token;
  }

  try {
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedAppToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

export interface UnsupportedListing {
  id: string;
  title: string;
  price: number;
  /** currency_id tal como lo informa Mercado Libre. */
  currency: string;
  permalink: string;
}

/** Resultados de la búsqueda por palabras en el catálogo: una sola llamada, trae nombre, ficha y dominio. */
const RADAR_SEARCH_LIMIT = 50;
/**
 * Tope de productos de la búsqueda a los que se les consultan las ofertas: toda la página de resultados.
 * Medido con la API real (2026-10): cada /products/{id}/items tarda ~200 ms; 50 consultas de a 25 ≈ 0,5–1,0 s.
 */
const RADAR_MAX_SEARCH_PICKS = 50;
/** Tope de productos más vendidos de la categoría que se consultan (dos llamadas cada uno). */
const RADAR_MAX_HIGHLIGHTS = 16;
/** Productos consultados a la vez (cada uno hace una o dos llamadas a Mercado Libre). */
const RADAR_CONCURRENCY = 25;
/**
 * Presupuesto de tiempo para consultar ofertas. Lo que no llegó a consultarse se informa como "sin consultar".
 * Peor caso de una búsqueda: 6,9 s de candidatos (búsqueda 3,5 s + pausa 0,4 s + reintento 3 s) + 4 s de ofertas
 * + 4 s de vendedores ≈ 14,9 s (Vercel corta a 60 s). Lo habitual medido: 1,5–3 s.
 */
const RADAR_OFFERS_BUDGET_MS = 4000;
const RADAR_DISCOVERY_TIMEOUT_MS = 3000;
const RADAR_SEARCH_TIMEOUT_MS = 3500;
const RADAR_SEARCH_RETRY_PAUSE_MS = 400;
const RADAR_SEARCH_RETRY_TIMEOUT_MS = 3000;

interface CatalogCandidates {
  /** domain_id que Mercado Libre asigna al texto buscado. null = no informado. */
  discoveredDomain: string | null;
  /** Productos de catálogo que devuelve la búsqueda por palabras, en el orden de Mercado Libre. */
  search: any[];
  /** La búsqueda por palabras no respondió (error o tiempo agotado): no es lo mismo que "sin resultados". */
  searchFailed: boolean;
  /** Ids de los productos más vendidos de la categoría que Mercado Libre asigna al texto. */
  highlightIds: string[];
}

/**
 * Candidatos para el radar y para "Similares". Dos fuentes en paralelo:
 *  - la búsqueda por palabras en el catálogo (muchos de sus productos no tienen ofertas en Uruguay), y
 *  - los más vendidos de la categoría del texto (tienen ofertas, pero son de la categoría, no de lo buscado).
 */
async function gatherCandidates(query: string, token: string): Promise<CatalogCandidates> {
  const q = encodeURIComponent(query.trim());
  const [searchData, discovery] = await Promise.all([
    (async () => {
      // La búsqueda es la llamada de la que depende todo el radar: si falla (Mercado Libre responde 429 cuando
      // hay muchas consultas seguidas, medido el 2026-10-08) se reintenta una vez tras una pausa corta.
      const path = `/products/search?status=active&site_id=MLU&q=${q}&limit=${RADAR_SEARCH_LIMIT}`;
      const first = await mlGet(path, token, RADAR_SEARCH_TIMEOUT_MS);
      if (first) return first;
      await new Promise((resolve) => setTimeout(resolve, RADAR_SEARCH_RETRY_PAUSE_MS));
      return mlGet(path, token, RADAR_SEARCH_RETRY_TIMEOUT_MS);
    })(),
    (async () => {
      const domains = await mlGet(`/sites/MLU/domain_discovery/search?limit=3&q=${q}`, token, RADAR_DISCOVERY_TIMEOUT_MS);
      const first = Array.isArray(domains) ? domains[0] : null;
      const categoryId = typeof first?.category_id === "string" ? first.category_id : null;
      const highlights = categoryId
        ? await mlGet(`/highlights/MLU/category/${categoryId}`, token, RADAR_DISCOVERY_TIMEOUT_MS)
        : null;
      return {
        domain: typeof first?.domain_id === "string" ? (first.domain_id as string) : null,
        ids: (Array.isArray(highlights?.content) ? highlights.content : [])
          .filter((c: any) => c?.type === "PRODUCT" && typeof c.id === "string")
          .map((c: any) => c.id as string),
      };
    })(),
  ]);
  return {
    discoveredDomain: discovery.domain,
    searchFailed: searchData === null,
    search: Array.isArray(searchData?.results) ? searchData.results.filter((p: any) => typeof p?.id === "string") : [],
    highlightIds: Array.from(new Set<string>(discovery.ids)),
  };
}

interface LoadedCatalogProduct {
  item: MluItem;
  /** Producto de catálogo tal como lo informa Mercado Libre (nombre, ficha, domain_id). */
  product: any;
  /** Ofertas activas tal como las informa /products/{id}/items. */
  rawItems: any[];
  /** Vendedor de la oferta más barata. null = Mercado Libre no lo informa. */
  sellerId: number | null;
}

/** Ejecuta `task` sobre cada elemento con un máximo de `limit` a la vez. */
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    })
  );
}

/**
 * Ofertas activas de cada producto pedido, de a RADAR_CONCURRENCY y dentro del presupuesto de tiempo.
 * Cada producto queda con el precio de su oferta más barata (en la moneda de esa oferta).
 * `product: null` = hay que pedir también la ficha. `tracking.withoutOffers` recibe los ids para los que
 * Mercado Libre informó cero ofertas; `tracking.notChecked`, los que no se llegaron a consultar o no respondieron.
 */
async function fetchCatalogOffers(
  picks: { id: string; product: any | null }[],
  token: string,
  rate: number | null,
  unsupported: UnsupportedListing[],
  tracking: { withoutOffers: Set<string>; notChecked: Set<string> } = { withoutOffers: new Set(), notChecked: new Set() }
): Promise<LoadedCatalogProduct[]> {
  const deadline = Date.now() + RADAR_OFFERS_BUDGET_MS;
  const valid: LoadedCatalogProduct[] = [];

  await runPool(picks, RADAR_CONCURRENCY, async (pick) => {
    const remaining = deadline - Date.now();
    if (remaining < 250) {
      tracking.notChecked.add(pick.id);
      return;
    }
    const timeoutMs = Math.min(RADAR_OFFERS_BUDGET_MS, remaining);
    const [product, rawItems] = await Promise.all([
      pick.product ?? mlGet(`/products/${pick.id}`, token, timeoutMs),
      fetchRawOffers(pick.id, token, timeoutMs),
    ]);
    if (!product || !rawItems) {
      tracking.notChecked.add(pick.id);
      return;
    }
    if (rawItems.length === 0) {
      tracking.withoutOffers.add(pick.id);
      return;
    }

    const title = product.name || product.family_name || pick.id;
    const priced = rawItems.filter((it) => typeof it?.price === "number" && it.price > 0);
    const supported = priced.flatMap((it) => {
      const currency = normalizeCurrency(it.currency_id);
      return currency ? [{ it, currency, comparable: currency === "USD" && rate ? it.price * rate : it.price }] : [];
    });
    if (supported.length === 0) {
      // Moneda que no manejamos: se informa tal cual, sin convertir ni entrar a las estadísticas.
      const first = priced[0];
      if (first) {
        unsupported.push({
          id: pick.id,
          title,
          price: first.price,
          currency: String(first.currency_id ?? ""),
          permalink: productPermalink(pick.id),
        });
      }
      return;
    }

    // La oferta activa más barata, igual que el precio de referencia de "Productos exactos".
    supported.sort((x, y) => x.comparable - y.comparable || String(x.it.item_id).localeCompare(String(y.it.item_id)));
    const { it: cheapest, currency } = supported[0];
    const city = cheapest.seller_address?.city?.name || "";
    const state = cheapest.seller_address?.state?.name || "";
    const item: MluItem = {
      id: pick.id,
      title,
      price: cheapest.price,
      currency,
      condition:
        cheapest.condition === "new" || cheapest.condition === "used"
          ? cheapest.condition
          : cheapest.condition
            ? "other"
            : null,
      thumbnail: pictureUrl(product),
      permalink: productPermalink(pick.id),
      freeShipping: cheapest.shipping?.free_shipping === true,
      isOfficialStore: !!cheapest.official_store_id,
      activeSellersCount: rawItems.length,
      sellerCity: city && state && state !== city ? `${city}, ${state}` : city || state || null,
      seller: null,
    };
    valid.push({
      item,
      product,
      rawItems,
      sellerId: typeof cheapest.seller_id === "number" ? (cheapest.seller_id as number) : null,
    });
  });

  // Orden: más ofertas activas del producto primero; a igual cantidad, el más barato; a igual precio, por id.
  const comparablePrice = (i: MluItem) => (i.currency === "USD" && rate ? i.price * rate : i.price);
  valid.sort(
    (a, b) =>
      (b.item.activeSellersCount ?? 0) - (a.item.activeSellersCount ?? 0) ||
      comparablePrice(a.item) - comparablePrice(b.item) ||
      a.item.id.localeCompare(b.item.id)
  );
  return valid;
}

/**
 * Datos reales de los vendedores de las ofertas mostradas: una sola consulta a /users para todos (con caché).
 * Si Mercado Libre no responde, `seller` queda en null y la interfaz muestra "no disponible".
 */
async function attachSellers(loaded: LoadedCatalogProduct[], token: string): Promise<void> {
  const sellers = await lookupSellers(
    loaded.flatMap((v) => (v.sellerId !== null ? [v.sellerId] : [])),
    token
  );
  for (const v of loaded) v.item.seller = v.sellerId !== null ? sellers.get(v.sellerId) ?? null : null;
}

/** Productos de la búsqueda (ya traen ficha) más los destacados que no estén entre ellos, sin repetir. */
function buildPicks(searchPicks: any[], highlightIds: string[]): { id: string; product: any | null }[] {
  const seen = new Set<string>(searchPicks.map((p) => p.id));
  const picks: { id: string; product: any | null }[] = searchPicks.map((p) => ({ id: p.id, product: p }));
  for (const id of highlightIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    picks.push({ id, product: null });
  }
  return picks;
}

interface RadarLoad {
  /** Productos con ofertas activas, con `item.match` calculado. Primero los que coinciden. */
  loaded: LoadedCatalogProduct[];
  relevance: RadarRelevance;
  selection: ExactSelection;
  /** Producto elegido para "Productos exactos". null = no se eligió ninguno (ver `selection.status`). */
  chosen: LoadedCatalogProduct | null;
}

function toCandidate(l: LoadedCatalogProduct): CatalogCandidate {
  return {
    productId: l.item.id,
    title: l.item.title,
    thumbnail: l.item.thumbnail,
    permalink: l.item.permalink,
    offersCount: l.rawItems.length,
  };
}

/**
 * Producto exacto para una búsqueda por nombre: entre los productos de catálogo que coinciden con la búsqueda
 * (relevance.ts) y tienen ofertas activas en Uruguay, el de más ofertas. No se elige ninguno si no hay
 * candidatos con ofertas o si son de más de una marca (la búsqueda es genérica: no hay "un mismo producto").
 */
function selectExact(
  matchedWithOffers: LoadedCatalogProduct[],
  candidatesWithoutOffers: number
): { selection: ExactSelection; chosen: LoadedCatalogProduct | null } {
  // Marcas tal como las informa la ficha (BRAND); los productos sin marca informada forman su propio grupo.
  const brandNames = new Map<string, string>();
  for (const l of matchedWithOffers) {
    const brand = productBrand(l.product);
    const key = brandKey(brand);
    if (!brandNames.has(key)) brandNames.set(key, brand || "sin marca informada");
  }
  const base = {
    candidatesWithOffers: matchedWithOffers.length,
    candidatesWithoutOffers,
    brands: Array.from(brandNames.values()),
    // Ya vienen ordenados: más ofertas primero; a igual cantidad, el más barato.
    candidates: matchedWithOffers.map(toCandidate),
  };

  if (matchedWithOffers.length === 0) {
    return {
      selection: {
        ...base,
        status: candidatesWithoutOffers > 0 ? "sin_ofertas" : "sin_coincidencias",
        chosenOffers: null,
        tiedWith: 0,
      },
      chosen: null,
    };
  }
  if (brandNames.size > 1) {
    return { selection: { ...base, status: "generica", chosenOffers: null, tiedWith: 0 }, chosen: null };
  }
  const chosen = matchedWithOffers[0];
  return {
    selection: {
      ...base,
      status: "elegido",
      chosenOffers: chosen.rawItems.length,
      tiedWith: matchedWithOffers.filter((l) => l !== chosen && l.rawItems.length === chosen.rawItems.length).length,
    },
    chosen,
  };
}

/**
 * Radar por nombre: productos de catálogo con ofertas activas, separados entre los que mencionan todo lo
 * que se buscó (`match.matches`) y los relacionados, y el producto elegido para "Productos exactos".
 * No consulta vendedores (ver attachSellers).
 */
async function loadRadar(
  query: string,
  token: string,
  rate: number | null,
  unsupported: UnsupportedListing[]
): Promise<RadarLoad> {
  const terms = queryTerms(query);
  const relevance: RadarRelevance = {
    terms,
    matched: 0,
    related: 0,
    matchedOffers: 0,
    matchedWithoutOffers: 0,
    matchedNotChecked: 0,
    searchCheckLimit: RADAR_MAX_SEARCH_PICKS,
    searchUnavailable: false,
    missingCounts: [],
  };

  const candidates = await gatherCandidates(query, token);
  relevance.searchUnavailable = candidates.searchFailed;

  // La búsqueda ya trae nombre y ficha: la relevancia se calcula antes de gastar llamadas en ofertas,
  // y se consultan primero los productos que coinciden.
  const ranked = candidates.search.map((product) => ({ product, rel: relevanceOf(query, productTexts(product)) }));
  const matching = ranked.filter((r) => r.rel.matches);
  const searchPicks = [...matching, ...ranked.filter((r) => !r.rel.matches)]
    .slice(0, RADAR_MAX_SEARCH_PICKS)
    .map((r) => r.product);
  const pickedIds = new Set<string>(searchPicks.map((p) => p.id));

  const tracking = { withoutOffers: new Set<string>(), notChecked: new Set<string>() };
  const all = await fetchCatalogOffers(
    buildPicks(searchPicks, candidates.highlightIds.slice(0, RADAR_MAX_HIGHLIGHTS)),
    token,
    rate,
    unsupported,
    tracking
  );
  relevance.matchedWithoutOffers = matching.filter((r) => tracking.withoutOffers.has(r.product.id)).length;
  // Sin consultar: quedaron fuera del tope, del presupuesto de tiempo, o Mercado Libre no respondió.
  relevance.matchedNotChecked = matching.filter(
    (r) => !pickedIds.has(r.product.id) || tracking.notChecked.has(r.product.id)
  ).length;

  for (const l of all) l.item.match = relevanceOf(query, productTexts(l.product));
  const matched = all.filter((l) => l.item.match?.matches);
  const related = all.filter((l) => !l.item.match?.matches);

  relevance.matched = matched.length;
  relevance.related = related.length;
  relevance.matchedOffers = matched.reduce((acc, l) => acc + (l.item.activeSellersCount ?? 0), 0);
  relevance.missingCounts = terms
    .map((term) => ({ term, count: related.filter((l) => l.item.match?.missing.includes(term)).length }))
    .filter((m) => m.count > 0);

  return { loaded: [...matched, ...related], relevance, ...selectExact(matched, relevance.matchedWithoutOffers) };
}

/** Bloque "Productos exactos" del producto elegido: sus ofertas con los datos de cada vendedor. */
async function buildExactBlock(
  chosen: LoadedCatalogProduct,
  selection: ExactSelection,
  token: string,
  rate: number
): Promise<ExactProductBlock> {
  const built = await buildExactOffers(chosen.item.id, chosen.item.title, chosen.rawItems, token, rate);
  return {
    match: {
      ...toCandidate(chosen),
      offersCount: built.offers.length,
      source: "busqueda",
      // Coincide con todo lo buscado y es de la única marca entre los candidatos; el porqué va en `exactSelection`.
      confidence: "alta",
      reasons: [],
    },
    candidates: selection.candidates,
    ...built,
    rateUsed: rate,
  };
}

/**
 * "Similares" de un producto de catálogo: otros productos del mismo tipo con ofertas activas.
 * Mismo tipo = está en el domain_id del producto (o en el que Mercado Libre asigna a su nombre) y su
 * nombre menciona las palabras de tipo del producto. Si no hay, la lista queda vacía: no se rellena.
 */
async function findSimilarProducts(
  target: any | null,
  targetId: string,
  query: string,
  token: string,
  rate: number,
  unsupported: UnsupportedListing[]
): Promise<{ items: MluItem[]; criteria: SimilarCriteria }> {
  const typeWords = target ? productTypeWords(target) : [];
  const criteria: SimilarCriteria = { typeWords, domains: [], discarded: 0 };
  // Sin ficha del producto o sin palabras de tipo no hay forma de afirmar "mismo tipo".
  if (!target || typeWords.length === 0) return { items: [], criteria };

  const candidates = await gatherCandidates(query, token);
  const domains = new Set<string>(
    [target.domain_id, candidates.discoveredDomain].filter((d): d is string => typeof d === "string" && d.length > 0)
  );
  criteria.domains = Array.from(domains);

  const sameType = (product: any) =>
    typeof product?.domain_id === "string" &&
    domains.has(product.domain_id) &&
    nameHasTypeWords(typeof product?.name === "string" ? product.name : "", typeWords);

  // Los de la búsqueda ya traen dominio y nombre: se filtran antes de consultar ofertas.
  const searchPicks = candidates.search.filter((p) => p.id !== targetId && sameType(p)).slice(0, RADAR_MAX_SEARCH_PICKS);
  const highlightIds = candidates.highlightIds.filter((id) => id !== targetId).slice(0, RADAR_MAX_HIGHLIGHTS);
  const loaded = await fetchCatalogOffers(buildPicks(searchPicks, highlightIds), token, rate, unsupported);

  const similar = loaded.filter((l) => sameType(l.product));
  criteria.discarded = loaded.length - similar.length;
  const shown = similar.slice(0, 8);
  await attachSellers(shown, token);
  return { items: shown.map((l) => l.item), criteria };
}

app.get("/api/search-mlu", rateLimit(RATE_RULES.market), async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const rate = rateFromRequest(req.query.rate);

  if (query.length < 2) {
    return res.status(400).json({ ok: false, code: "BAD_REQUEST", message: "Ingresá al menos 2 caracteres." });
  }

  if (rate === null) {
    return res.status(400).json({ ok: false, code: "RATE_UNAVAILABLE", message: NO_RATE_MESSAGE });
  }

  try {
    const token = await getAppToken();
    const unsupported: UnsupportedListing[] = [];
    let items: MluItem[] = [];
    let relevance: RadarRelevance | null = null;
    let exact: ExactProductBlock | null = null;
    let exactSelection: ExactSelection | null = null;
    if (token) {
      const radar = await loadRadar(query, token, rate, unsupported);
      items = radar.loaded.map((l) => l.item);
      relevance = radar.relevance;
      exactSelection = radar.selection;
      // Vendedores de las tarjetas y ofertas del producto exacto, en paralelo. Si "Productos exactos" falla,
      // el radar responde igual sin esa sección.
      [, exact] = await Promise.all([
        attachSellers(radar.loaded, token),
        radar.chosen
          ? buildExactBlock(radar.chosen, radar.selection, token, rate).catch((err) => {
              console.warn("[api/search-mlu] productos exactos no disponibles:", err?.message || err);
              return null;
            })
          : Promise.resolve(null),
      ]);
    }

    if (items.length === 0 && unsupported.length > 0) {
      const currencies = Array.from(new Set(unsupported.map((u) => u.currency || "sin indicar"))).join(", ");
      return res.status(422).json({
        ok: false,
        code: "UNSUPPORTED_CURRENCY",
        message: `Las publicaciones encontradas están en una moneda que UyMargin no convierte (${currencies}). No se calculó ningún precio de mercado.`,
        unsupported,
      });
    }

    if (items.length === 0) {
      return res.status(404).json({
        ok: false,
        code: token ? "NO_RESULTS" : "UPSTREAM_ERROR",
        message: token
          ? `No encontramos publicaciones activas en Mercado Libre Uruguay para "${query}". Probá con otro nombre o cargá los precios a mano.`
          : "No se pudo conectar con Mercado Libre. Cargá los precios de la competencia a mano.",
      });
    }

    // Estadísticas en pesos, solo con los productos que coinciden con la búsqueda y sin excluir ninguno:
    // la relevancia ya dejó afuera lo que no es lo buscado. Si no coincide ninguno no hay estadística.
    const uyuPrices = items
      .filter((i) => i.match?.matches)
      .map((i) => (i.currency === "USD" ? i.price * rate : i.price))
      .filter((p) => Number.isFinite(p) && p > 0)
      .sort((a, b) => a - b);

    const stats =
      uyuPrices.length > 0
        ? {
            sampleSize: uyuPrices.length,
            outliersRemoved: 0,
            min: uyuPrices[0],
            max: uyuPrices[uyuPrices.length - 1],
            average: Math.round(uyuPrices.reduce((acc, v) => acc + v, 0) / uyuPrices.length),
            median: Math.round(quantile(uyuPrices, 0.5)),
          }
        : null;

    return res.json({
      ok: true,
      query,
      total: relevance?.matched ?? 0,
      items,
      stats,
      relevance,
      rateUsed: rate,
      unsupported,
      exact,
      exactSelection,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[api/search-mlu] error:", err?.message || err);
    return res.status(502).json({
      ok: false,
      code: "NETWORK",
      message: "No se pudo conectar con Mercado Libre Uruguay en este momento.",
    });
  }
});

// ------------------------------------------------------------------
// 2.1 "Productos exactos": ofertas del mismo producto de catálogo (mismo product_id MLU…)
//     Solo datos que informa Mercado Libre. Lo que no viene de la API va en null ("no disponible").
// ------------------------------------------------------------------
const ML_API = "https://api.mercadolibre.com";
const SELLER_CACHE_TTL_MS = 10 * 60 * 1000;
const SELLER_CACHE_MAX_ENTRIES = 2000;
/** /users?ids= acepta varios ids por llamada. */
const SELLER_BATCH_SIZE = 20;
/** Tope de vendedores consultados por producto (2 llamadas en paralelo); el resto queda "no disponible". */
const MAX_SELLERS_PER_PRODUCT = 40;
const SELLER_LOOKUP_TIMEOUT_MS = 4000;

const sellerCache = new Map<number, { info: ExactOfferSeller; expiresAt: number }>();

function productPermalink(pid: string): string {
  return `https://www.mercadolibre.com.uy/p/${pid}`;
}

/**
 * /products/{id}/items no trae permalink. Esta es la dirección a la que Mercado Libre redirige
 * desde articulo.mercadolibre.com.uy/MLU-<n>: la página del producto con esa oferta seleccionada.
 */
function offerPermalink(pid: string, itemId: string): string {
  return /^MLU\d+$/.test(itemId) ? `${productPermalink(pid)}?pdp_filters=item_id:${itemId}` : productPermalink(pid);
}

function pictureUrl(product: any): string | null {
  const url = product?.pictures?.[0]?.url;
  return url ? String(url).replace(/^http:\/\//, "https://") : null;
}

async function mlGet(pathAndQuery: string, token: string, timeoutMs: number): Promise<any | null> {
  try {
    const r = await fetch(`${ML_API}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      // 404 es una respuesta normal (producto sin ficha u ofertas); el resto se deja en el log para diagnosticar.
      if (r.status !== 404) console.warn(`[mercadolibre] HTTP ${r.status} en ${pathAndQuery.split("?")[0]}`);
      return null;
    }
    return await r.json();
  } catch (err: any) {
    console.warn(`[mercadolibre] sin respuesta (${err?.name || "error"}) en ${pathAndQuery.split("?")[0]}`);
    return null;
  }
}

/** Datos reales de vendedores, con caché de 10 minutos. Los que no se pudieron consultar no figuran en el resultado. */
async function lookupSellers(sellerIds: number[], token: string): Promise<Map<number, ExactOfferSeller>> {
  const now = Date.now();
  const found = new Map<number, ExactOfferSeller>();
  const pending: number[] = [];

  for (const id of Array.from(new Set(sellerIds))) {
    const cached = sellerCache.get(id);
    if (cached && cached.expiresAt > now) found.set(id, cached.info);
    else if (pending.length < MAX_SELLERS_PER_PRODUCT) pending.push(id);
  }

  const batches: number[][] = [];
  for (let i = 0; i < pending.length; i += SELLER_BATCH_SIZE) batches.push(pending.slice(i, i + SELLER_BATCH_SIZE));

  const responses = await Promise.all(
    batches.map((ids) => mlGet(`/users?ids=${ids.join(",")}`, token, SELLER_LOOKUP_TIMEOUT_MS))
  );

  if (sellerCache.size > SELLER_CACHE_MAX_ENTRIES) {
    for (const [id, entry] of sellerCache) if (entry.expiresAt <= now) sellerCache.delete(id);
    if (sellerCache.size > SELLER_CACHE_MAX_ENTRIES) sellerCache.clear();
  }

  for (const data of responses) {
    if (!Array.isArray(data)) continue;
    for (const entry of data) {
      const u = entry?.body;
      if (entry?.code !== 200 || typeof u?.id !== "number") continue;
      const power = u.seller_reputation?.power_seller_status;
      const total = u.seller_reputation?.transactions?.total;
      const info: ExactOfferSeller = {
        id: u.id,
        nickname: typeof u.nickname === "string" && u.nickname.trim() ? u.nickname.trim() : null,
        reputationLevel: typeof u.seller_reputation?.level_id === "string" ? u.seller_reputation.level_id : null,
        powerSellerStatus: power === "platinum" || power === "gold" || power === "silver" ? power : null,
        transactionsTotal: typeof total === "number" ? total : null,
      };
      sellerCache.set(u.id, { info, expiresAt: now + SELLER_CACHE_TTL_MS });
      found.set(u.id, info);
    }
  }

  return found;
}

/**
 * Ofertas activas de un producto de catálogo. Sin ofertas Mercado Libre responde 404 ("No winners found"): es [].
 * null = Mercado Libre no respondió (error o tiempo agotado).
 */
async function fetchRawOffers(pid: string, token: string, timeoutMs = 5000): Promise<any[] | null> {
  try {
    const r = await fetch(`${ML_API}/products/${pid}/items`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 404) return [];
    if (!r.ok) {
      console.warn(`[mercadolibre] HTTP ${r.status} en /products/${pid}/items`);
      return null;
    }
    const data = await r.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err: any) {
    console.warn(`[mercadolibre] sin respuesta (${err?.name || "error"}) en /products/${pid}/items`);
    return null;
  }
}

async function buildExactOffers(
  pid: string,
  title: string,
  rawItems: any[],
  token: string,
  rate: number
): Promise<Pick<ExactProductBlock, "offers" | "stats" | "sellerData" | "unsupported">> {
  const offers: ExactOffer[] = [];
  const unsupported: UnsupportedListing[] = [];
  const sellerIdByItem = new Map<string, number>();

  for (const it of rawItems) {
    const price = typeof it?.price === "number" ? it.price : 0;
    if (price <= 0) continue;
    const itemId = typeof it.item_id === "string" ? it.item_id : "";
    const permalink = offerPermalink(pid, itemId);
    const currency = normalizeCurrency(it.currency_id);
    if (!currency) {
      // Moneda que no manejamos: se informa tal cual, sin convertir ni entrar a las estadísticas.
      unsupported.push({ id: itemId || pid, title, price, currency: String(it.currency_id ?? ""), permalink });
      continue;
    }
    const city = it.seller_address?.city?.name || "";
    const state = it.seller_address?.state?.name || "";
    if (typeof it.seller_id === "number") sellerIdByItem.set(itemId, it.seller_id);
    offers.push({
      itemId,
      productId: pid,
      price,
      currency,
      priceUyu: currency === "USD" ? Math.round(price * rate) : price,
      permalink,
      freeShipping: it.shipping?.free_shipping === true,
      condition: it.condition === "new" || it.condition === "used" ? it.condition : it.condition ? "other" : null,
      isOfficialStore: !!it.official_store_id,
      sellerCity: city && state && state !== city ? `${city}, ${state}` : city || state || null,
      seller: null,
    });
  }

  offers.sort((a, b) => a.priceUyu - b.priceUyu || a.itemId.localeCompare(b.itemId));

  // Vendedores en orden de precio: si hay más que el tope, se consultan los de las ofertas más baratas.
  const sellers = await lookupSellers(
    offers.flatMap((o) => (sellerIdByItem.has(o.itemId) ? [sellerIdByItem.get(o.itemId)!] : [])),
    token
  );
  for (const o of offers) {
    const sellerId = sellerIdByItem.get(o.itemId);
    o.seller = sellerId !== undefined ? sellers.get(sellerId) ?? null : null;
  }

  const withData = offers.filter((o) => o.seller).length;
  const prices = offers.map((o) => o.priceUyu);

  return {
    offers,
    unsupported,
    stats:
      prices.length > 0
        ? {
            count: prices.length,
            min: prices[0],
            median: Math.round(quantile(prices, 0.5)),
            max: prices[prices.length - 1],
          }
        : null,
    sellerData: {
      status: offers.length === 0 || withData === offers.length ? "ok" : withData === 0 ? "no_disponible" : "parcial",
      withData,
      withoutData: offers.length - withData,
      cap: MAX_SELLERS_PER_PRODUCT,
    },
  };
}

// ------------------------------------------------------------------
// 2.2 Mercado Libre URL Product & Competitors Analysis Endpoint
// ------------------------------------------------------------------
app.all("/api/analyze-url", rateLimit(RATE_RULES.market), async (req, res) => {
  const urlParam = req.method === "POST" ? req.body?.url : req.query?.url;
  const rawUrl = String(urlParam || "").trim();
  const rate = rateFromRequest(req.query?.rate || req.body?.rate);
  // Solo el producto y sus ofertas, sin buscar similares (lo usa el radar al elegir otra coincidencia).
  const exactOnly = [req.query?.exactOnly, req.body?.exactOnly].some((v) => v === true || v === "1" || v === "true");

  if (!rawUrl) {
    return res.status(400).json({ ok: false, message: "URL de Mercado Libre requerida." });
  }
  if (rate === null) {
    return res.status(400).json({ ok: false, code: "RATE_UNAVAILABLE", message: NO_RATE_MESSAGE });
  }

  let pid: string | null = null;
  let slugQuery = "";

  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const pMatch = parsed.pathname.match(/\/p\/(MLU[0-9]+)/i);
    if (pMatch) pid = pMatch[1].toUpperCase();

    let pathPart = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (pathPart === "p") pathPart = parsed.pathname.split("/").filter(Boolean)[1] || "";
    slugQuery = pathPart
      .replace(/^MLU-?[0-9]+-?/i, "")
      .replace(/-p-MLU[0-9]+/i, "")
      .replace(/_JM/i, "")
      .split("-")
      // Los números sueltos se conservan ("5 litros"): son parte de lo que identifica al producto.
      .filter((w) => (w.length > 1 || /\d/.test(w)) && !w.toLowerCase().startsWith("mlu"))
      .join(" ");
  } catch (e) {
    const m = rawUrl.match(/(MLU[0-9]+)/i);
    if (m) pid = m[1].toUpperCase();
    else slugQuery = rawUrl;
  }

  try {
    const token = await getAppToken();

    let match: ExactMatch | null = null;
    let candidates: CatalogCandidate[] = [];
    let rawItems: any[] | null = null;
    /** Ficha del producto exacto: de ahí salen el dominio y las palabras de tipo para "Similares". */
    let targetPayload: any | null = null;

    // 1. El enlace trae el product_id de catálogo: es el producto exacto.
    if (pid && token) {
      const [prod, items] = await Promise.all([mlGet(`/products/${pid}`, token, 5000), fetchRawOffers(pid, token)]);
      if (prod) {
        targetPayload = prod;
        rawItems = items ?? [];
        match = {
          productId: pid,
          title: prod.name || slugQuery || "Producto de Mercado Libre",
          thumbnail: pictureUrl(prod),
          permalink: productPermalink(pid),
          offersCount: rawItems.length,
          source: "enlace",
          confidence: "exacta",
          reasons: [],
        };
      }
    }

    // 2. Sin product_id en el enlace: se busca en el catálogo por las palabras del enlace.
    //    Puede ser un producto parecido y no el mismo, así que siempre queda marcado como dudoso.
    let slugSelection: ExactSelection | null = null;
    if (!match && slugQuery && token) {
      // Misma elección que el radar por nombre: entre los que coinciden, el de más ofertas activas.
      const radar = await loadRadar(slugQuery, token, rate, []);
      slugSelection = radar.selection;
      if (radar.chosen) {
        rawItems = radar.chosen.rawItems;
        candidates = radar.selection.candidates;
        match = {
          ...toCandidate(radar.chosen),
          source: "busqueda",
          confidence: "dudosa",
          reasons: [
            "El enlace no es de un producto de catálogo (/p/MLU…): se buscó por las palabras del enlace y puede no ser la misma publicación.",
            `Se eligió el producto con más ofertas activas (${radar.selection.chosenOffers}) entre ${radar.selection.candidatesWithOffers} ${radar.selection.candidatesWithOffers === 1 ? "candidato que coincide" : "candidatos que coinciden"} con esas palabras.`,
          ],
        };
      }
    }

    // 3. Without a real listing there is nothing to audit: report it instead of inventing a price.
    if (!match || !token) {
      // El enlace se buscó por palabras y no se pudo elegir un único producto: se dice por qué, sin mostrar uno vacío.
      const why =
        slugSelection?.status === "generica"
          ? `Las palabras del enlace coinciden con ${slugSelection.candidatesWithOffers} productos de catálogo de marcas distintas (${slugSelection.brands.slice(0, 4).join(", ")}): no se puede saber cuál es. Pegá el enlace del producto de catálogo (/p/MLU…).`
          : slugSelection?.status === "sin_ofertas"
            ? `Las palabras del enlace coinciden con ${slugSelection.candidatesWithoutOffers} productos de catálogo, pero ninguno tiene ofertas activas en Uruguay. Pegá el enlace del producto de catálogo (/p/MLU…).`
            : slugSelection?.status === "sin_coincidencias"
              ? "Ningún producto de catálogo menciona todas las palabras del enlace. Pegá el enlace del producto de catálogo (/p/MLU…)."
              : "Revisá que el enlace sea de mercadolibre.com.uy y que la publicación siga activa.";
      return res.status(404).json({
        ok: false,
        message: `No pudimos leer esa publicación de Mercado Libre. ${why}`,
      });
    }

    const built = await buildExactOffers(match.productId, match.title, rawItems ?? [], token, rate);
    const unsupported: UnsupportedListing[] = [...built.unsupported];

    if (built.offers.length === 0 && unsupported.length > 0) {
      const currencies = Array.from(new Set(unsupported.map((u) => u.currency || "sin indicar"))).join(", ");
      return res.status(422).json({
        ok: false,
        code: "UNSUPPORTED_CURRENCY",
        message: `La publicación está en una moneda que UyMargin no convierte (${currencies}). No se calculó nada.`,
        unsupported,
      });
    }

    const exact: ExactProductBlock = {
      match: { ...match, offersCount: built.offers.length },
      candidates,
      ...built,
      rateUsed: rate,
    };

    // Precio de referencia: la oferta exacta más barata. Sin ofertas no hay precio.
    const cheapest = built.offers[0] ?? null;
    const targetProduct = {
      id: match.productId,
      title: match.title,
      price: cheapest?.price ?? 0,
      priceUyu: cheapest?.priceUyu ?? 0,
      currency: cheapest?.currency ?? "UYU",
      thumbnail: match.thumbnail,
      permalink: match.permalink,
      seller: cheapest?.seller?.nickname ?? null,
      sellerCity: cheapest?.sellerCity ?? null,
      condition: cheapest?.condition ?? null,
      freeShipping: cheapest?.freeShipping ?? false,
      isAvailable: built.offers.length > 0,
      activeSellersCount: built.offers.length,
    };

    // 4. Similares: otros productos de catálogo del mismo tipo con ofertas activas (ver findSimilarProducts).
    const searchQuery = slugQuery || match.title;
    let similarProducts: MluItem[] = [];
    let similarCriteria: SimilarCriteria | null = null;
    if (!exactOnly && searchQuery) {
      // Si el producto se eligió por búsqueda, la ficha completa todavía no se pidió.
      targetPayload ??= await mlGet(`/products/${match.productId}`, token, 5000);
      const similar = await findSimilarProducts(targetPayload, match.productId, searchQuery, token, rate, unsupported);
      similarProducts = similar.items;
      similarCriteria = similar.criteria;
    }

    // 5. Rango de mercado: una sola fuente, las ofertas del producto exacto, sin excluir ninguna.
    //    Son los mismos números que `exact.stats` (más el promedio); los similares no entran.
    const exactPrices = built.offers.map((o) => o.priceUyu);
    const marketStats = {
      sampleSize: built.stats?.count ?? 0,
      min: built.stats?.min ?? 0,
      median: built.stats?.median ?? 0,
      max: built.stats?.max ?? 0,
      average: exactPrices.length > 0 ? Math.round(exactPrices.reduce((acc, v) => acc + v, 0) / exactPrices.length) : 0,
    };

    return res.json({
      ok: true,
      url: rawUrl,
      targetProduct,
      exact,
      similarProducts,
      similarCriteria,
      marketStats,
      rateUsed: rate,
      unsupported,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[api/analyze-url] error:", err?.message || err);
    return res.status(500).json({ ok: false, message: "Error al auditar el enlace de Mercado Libre." });
  }
});

// ------------------------------------------------------------------
// 3. Gemini Financial Copilot Chat Endpoint
// ------------------------------------------------------------------
const CHAT_ALLOWED_MODELS: readonly string[] = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"];
const CHAT_MAX_MESSAGE_CHARS = 4000;
const CHAT_MAX_HISTORY = 20;

/** Texto del contexto que manda el navegador: se fuerza a string y se acota antes de entrar al prompt. */
function ctxText(value: unknown, max = 200): string {
  return String(value ?? "").slice(0, max);
}

app.post("/api/chat", rateLimit(RATE_RULES.chat), async (req, res) => {
  const { message, history, model, enableThinking, context } = req.body ?? {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ ok: false, error: "Mensaje requerido" });
  }
  if (message.length > CHAT_MAX_MESSAGE_CHARS) {
    return res.status(400).json({ ok: false, error: `El mensaje es demasiado largo (máximo ${CHAT_MAX_MESSAGE_CHARS} caracteres).` });
  }
  if (model !== undefined && model !== null && model !== "" && !CHAT_ALLOWED_MODELS.includes(model)) {
    return res.status(400).json({ ok: false, error: "Modelo no permitido." });
  }
  if (history !== undefined && !Array.isArray(history)) {
    return res.status(400).json({ ok: false, error: "Historial inválido." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "GEMINI_API_KEY no está configurada en las variables de entorno.",
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const candidateModels = [
      model,
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
    ].filter((m): m is string => Boolean(m && typeof m === "string"));

    const systemInstruction = `Eres UyMargin AI, un Diseñador Financiero Senior y Especialista en Estrategia de Precios para E-commerce y Ventas Mayoristas en Uruguay.
Tu trabajo es aconsejar al usuario con números concretos, realistas y basados en la legislación y mercado uruguayo:
1. Comisiones de Mercado Libre Uruguay (Clásica 12%-14%, Premium 16%-19%, cargos fijos por ventas menores a $U 1.200, y logística Mercado Envíos).
2. Pasarelas de pago locales (Mercado Pago 3.99% + IVA, Handy 3.5% + IVA, transferencias bancarias ITAU/BROU/Santander sin comisión).
3. Logística local en Uruguay (DAC, Mirtrans, cadetería en Montevideo).
4. Normativa tributaria de la DGI:
   - Literal E / Pequeña Empresa / Monotributo: IVA compra es costo, no se discrimina en venta, tope de facturación anual.
   - Régimen General: IVA 22% débito fiscal en venta menos crédito fiscal por compras con e-factura con RUT y crédito por comisiones de ML/pasarelas, provisión de IRAE 25%.
5. Datos actuales de la simulación del usuario:
   - Producto: ${ctxText(context?.productName || "No definido")}
   - Costo unitario: ${ctxText(context?.wholesaleCost || "N/A")}
   - Costo puesto landed: ${ctxText(context?.landedCostUyu || "N/A")}
   - Precio de venta simulado: ${ctxText(context?.simulatedSalePriceUyu || "N/A")}
   - Tipo de cambio: $U ${ctxText(context?.exchangeRate || "no disponible", 20)}
   - Régimen DGI: ${ctxText(context?.taxRegime || "Literal E")}
   - Resultados ML: Ganancia ${ctxText(context?.ml?.netProfit, 40)}, Margen ${ctxText(context?.ml?.netMargin, 40)}, ROI ${ctxText(context?.ml?.roi, 40)}, Viabilidad ${ctxText(context?.ml?.viability, 40)}, Punto equilibrio ${ctxText(context?.ml?.breakEven, 40)}
   - Resultados Tienda Propia: Ganancia ${ctxText(context?.direct?.netProfit, 40)}, Margen ${ctxText(context?.direct?.netMargin, 40)}, ROI ${ctxText(context?.direct?.roi, 40)}, Viabilidad ${ctxText(context?.direct?.viability, 40)}, Punto equilibrio ${ctxText(context?.direct?.breakEven, 40)}
   - Criterio del semáforo de viabilidad de la app (usá estas mismas palabras y cortes, no otros): ${VIABILITY_CRITERIA}

Sé conciso, directo, amigable con terminología uruguaya ($U, e-factura, RUT, DGI) y da recomendaciones accionables para maximizar el margen líquido en mano.`;

    const config: any = {
      systemInstruction,
    };

    if (model === "gemini-3.1-pro-preview" && enableThinking) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    }

    const contents: any[] = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-CHAT_MAX_HISTORY)) {
        if ((h?.role === "user" || h?.role === "assistant") && typeof h.content === "string") {
          contents.push({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content.slice(0, CHAT_MAX_MESSAGE_CHARS) }],
          });
        }
      }
    }
    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const uniqueModels = Array.from(new Set(candidateModels));
    let reply = "";
    let lastError: any = null;

    for (const m of uniqueModels) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents,
          config,
        });
        if (response?.text) {
          reply = response.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[api/chat] Model ${m} failed, trying next fallback:`, err?.message || err);
      }
    }

    if (!reply && lastError) {
      throw lastError;
    }

    return res.json({ ok: true, reply: reply || "No se pudo generar una respuesta." });
  } catch (err: any) {
    // El detalle queda en el log del servidor; al navegador no se le devuelve el error crudo de Gemini.
    console.error("[api/chat] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "No se pudo obtener una respuesta del copiloto. Probá de nuevo en unos minutos.",
    });
  }
});

// ------------------------------------------------------------------
// 4. Competitor Price Tracking & Alerts Endpoint
// ------------------------------------------------------------------
const TRACKING_MAX_ITEMS = 25;

app.post("/api/tracking/check", async (req, res) => {
  // Este endpoint se llama a sí mismo por HTTP (localhost), lo que no existe en funciones de Vercel.
  // El seguimiento de competidores no está conectado a la interfaz: queda deshabilitado ahí.
  if (isVercel) {
    return res.status(501).json({
      ok: false,
      code: "NOT_IMPLEMENTED",
      error: "El seguimiento de competidores no está disponible en este despliegue.",
    });
  }
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length > TRACKING_MAX_ITEMS) {
      return res.status(400).json({
        ok: false,
        code: "TOO_MANY_ITEMS",
        error: `Se pueden verificar hasta ${TRACKING_MAX_ITEMS} competidores por llamada.`,
      });
    }
    const exchangeRate = rateFromRequest(req.body?.exchangeRate);
    if (exchangeRate === null) {
      return res.status(400).json({ ok: false, code: "RATE_UNAVAILABLE", message: NO_RATE_MESSAGE });
    }

    if (items.length === 0) {
      return res.json({ ok: true, updatedItems: [], alerts: [] });
    }

    const now = new Date().toISOString();
    const updatedItems: any[] = [];
    const newAlerts: any[] = [];

    for (const item of items) {
      try {
        let livePrice = item.currentPrice;
        let inStock = item.inStock ?? true;

        const targetUrl = item.permalink || item.productId;
        if (targetUrl) {
          const analyzeUrl = `http://${SELF_HOST}:${PORT}/api/analyze-url?url=${encodeURIComponent(targetUrl)}&rate=${exchangeRate}`;
          const r = await fetch(analyzeUrl, {
            // La llamada interna pasa por el mismo control de acceso: se reenvía la sesión del pedido.
            headers: { Accept: "application/json", ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) {
            const data = (await r.json()) as any;
            if (data.ok && data.targetProduct && typeof data.targetProduct.priceUyu === "number") {
              livePrice = Math.round(data.targetProduct.priceUyu);
              inStock = data.targetProduct.isAvailable !== false;
            }
          }
        }

        const priceHistory = Array.isArray(item.priceHistory) ? [...item.priceHistory] : [];
        const prevPrice = item.currentPrice;
        const priceChanged = livePrice !== prevPrice;

        const lastPoint = priceHistory[priceHistory.length - 1];
        const lastDate = lastPoint ? new Date(lastPoint.date).getTime() : 0;
        const hoursSinceLast = (Date.now() - lastDate) / (1000 * 3600);

        if (priceChanged || hoursSinceLast >= 6) {
          priceHistory.push({
            date: now,
            price: livePrice,
            inStock,
            note: priceChanged
              ? livePrice < prevPrice
                ? `Caída de precio: -$U ${prevPrice - livePrice}`
                : `Aumento de precio: +$U ${livePrice - prevPrice}`
              : "Verificación periódica",
          });
        }

        const triggeredAlerts = Array.isArray(item.triggeredAlerts) ? [...item.triggeredAlerts] : [];
        let status = item.status === "paused" ? "paused" : "active";

        const dropFromInitialPct = item.initialPrice > 0
          ? ((livePrice - item.initialPrice) / item.initialPrice) * 100
          : 0;

        if (
          item.alertOnDrop &&
          dropFromInitialPct <= -item.alertThresholdPct &&
          livePrice < prevPrice
        ) {
          const alertObj = {
            id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            competitorId: item.id,
            competitorTitle: item.title,
            date: now,
            type: "price_drop",
            message: `Alerta: El competidor bajó de $U ${prevPrice.toLocaleString("es-UY")} a $U ${livePrice.toLocaleString("es-UY")} (${dropFromInitialPct.toFixed(1)}% vs inicial).`,
            oldPrice: prevPrice,
            newPrice: livePrice,
            pctChange: Number(dropFromInitialPct.toFixed(1)),
            read: false,
          };
          triggeredAlerts.unshift(alertObj);
          newAlerts.push(alertObj);
          status = "alert_triggered";
        }

        updatedItems.push({
          ...item,
          currentPrice: livePrice,
          lowestPrice: Math.min(item.lowestPrice, livePrice),
          highestPrice: Math.max(item.highestPrice, livePrice),
          inStock,
          lastChecked: now,
          status,
          priceHistory,
          triggeredAlerts,
        });
      } catch (err) {
        console.warn(`[api/tracking/check] Error on item ${item.id}:`, err);
        updatedItems.push(item);
      }
    }

    return res.json({
      ok: true,
      updatedItems,
      alerts: newAlerts,
      checkedCount: updatedItems.length,
    });
  } catch (err: any) {
    console.error("[api/tracking/check] error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Error al verificar tracking" });
  }
});

// ------------------------------------------------------------------
// 5. Auditorías guardadas en la nube (server/cloud.ts): el navegador ya no escribe en Supabase.
// ------------------------------------------------------------------
const cloudRoute =
  (handler: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
  (req, res) => {
    handler(req, res).catch((err) => {
      console.error("[api/audits] error:", err?.message || err);
      const message = "La nube no respondió. Probá de nuevo en un rato.";
      if (!res.headersSent) res.status(502).json({ ok: false, code: "CLOUD_ERROR", message, error: message });
    });
  };
app.get("/api/audits", cloudRoute(listAudits));
app.post("/api/audits", cloudRoute(createAudit));
app.delete("/api/audits", cloudRoute(deleteAudit));

export default app;
