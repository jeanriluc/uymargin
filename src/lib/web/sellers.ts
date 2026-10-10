/**
 * "En la web (Uruguay)": qué sitios venden un producto, según una búsqueda en Google Uruguay.
 * Acá va todo lo que no necesita red: armar y validar la consulta, leer la respuesta del buscador,
 * clasificar dominios, validar enlaces y armar la lista final. Sin DOM y sin Node: lo usan el servidor,
 * la pantalla y los tests.
 */

/** Límites de la búsqueda web. Único lugar donde se cambian. */
export const WEB_LIMITS = {
  queryMin: 2,
  /** El mismo largo que admite el nombre de búsqueda del Radar. */
  queryMax: 120,
  /** Largo máximo del nombre dentro de la consulta que se manda a Google. */
  nameInSearchMax: 100,
  /** Resultados que se devuelven como mucho, sumando todos los grupos. */
  maxResults: 10,
  /** Resultados del mismo dominio que se muestran como mucho. */
  maxPerDomain: 2,
  /** Resultados del buscador que se miran como mucho. */
  maxRawResults: 40,
  titleMax: 140,
  descriptionMax: 220,
} as const;

export const WEB_MESSAGES = {
  query: "Escribí el nombre del producto (entre 2 y 120 caracteres).",
  notConfigured: "La búsqueda web no está configurada en el servidor. Mientras tanto podés usar los botones de Google.",
  noCredit: "Se agotó el crédito del servicio de búsqueda web",
  unavailable: "La búsqueda web no respondió en este momento. Probá de nuevo o usá los botones de Google.",
  network: "Error de red al buscar en la web. Revisá la conexión y probá de nuevo.",
  empty: "No encontré sitios que vendan ese producto. Probá con un nombre más corto o usá los botones de Google.",
  notice: "Son resultados de Google Uruguay y pueden ser productos parecidos. Confirmá precio y stock en cada tienda.",
} as const;

/** Códigos de error de /api/web-sellers que la pantalla distingue. */
export type WebSearchErrorCode = "WEB_SEARCH_NOT_CONFIGURED" | "WEB_SEARCH_NO_CREDIT" | "WEB_SEARCH_UNAVAILABLE";

export type UruguayStatus = "confirmado" | "probable" | "no_confirmado";

export const URUGUAY_LABELS: Record<UruguayStatus, string> = {
  confirmado: "Uruguay: confirmado",
  probable: "Uruguay: probable",
  no_confirmado: "Uruguay: no confirmado",
};

export interface WebSeller {
  /** Dominio del sitio, sin "www.". */
  site: string;
  /** Enlace https a la página que devolvió Google. Nunca se visita: solo se muestra. */
  url: string;
  /** Título que da Google, recortado. */
  title: string;
  /** Descripción que da Google, recortada. Puede estar vacía. */
  why: string;
  uruguay: UruguayStatus;
  /** Tienda o marketplace global: hay que confirmar que envía a Uruguay. */
  international: boolean;
  /** "other": sitios que claramente no son tiendas (redes, enciclopedias, diarios, blogs). */
  kind: "store" | "other";
}

export interface WebSellersResponse {
  ok: true;
  query: string;
  results: WebSeller[];
  /** Lo que se buscó en Google. */
  searchQueries: string[];
  /** La respuesta salió de la memoria del servidor, sin gastar otra búsqueda. */
  cached: boolean;
}

/** Texto en una línea, sin caracteres de control y acotado. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Consulta limpia, o null si no sirve. */
export function cleanWebQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length < WEB_LIMITS.queryMin || flat.length > WEB_LIMITS.queryMax) return null;
  return flat;
}

/** Clave para no repetir una búsqueda: sin mayúsculas, tildes ni espacios de más. */
export function webQueryKey(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lo que se le pide a Google: <nombre> comprar Uruguay. Una sola consulta por búsqueda.
 * Va sin comillas a propósito: como frase exacta Google devuelve casi nada (probado: 1 resultado con
 * comillas contra 9 tiendas sin ellas). Por eso también se sacan las comillas que traiga el nombre.
 */
export function buildSearchQuery(name: string): string {
  const inner = name
    .replace(/["\u201c\u201d\u201e\u201f\u00ab\u00bb\uff02]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WEB_LIMITS.nameInSearchMax)
    .trim();
  return `${inner} comprar Uruguay`;
}

// ------------------------------------------------------------------
// Dominios
// ------------------------------------------------------------------

/** Dominio en minúsculas y sin "www.", o null si el texto no es un nombre de dominio. */
export function normalizeHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (host.length < 4 || host.length > 253) return null;
  // Etiquetas de letras, números y guiones, con una terminación de letras: deja afuera IPs y nombres sueltos.
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  return host;
}

const SECOND_LEVEL = new Set(["com", "org", "net", "edu", "gub", "gob", "gov", "mil", "co", "ac", "or", "ne"]);

/**
 * Dominio principal de un host ("tienda.ejemplo.com.uy" → "ejemplo.com.uy"). Es una aproximación sin la
 * lista pública de sufijos: alcanza para no repetir el mismo sitio con distintos subdominios.
 */
export function siteDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Marketplaces y tiendas globales: no alcanza con que aparezcan para saber que envían a Uruguay. */
const INTERNATIONAL_BRANDS = [
  "aliexpress",
  "alibaba",
  "amazon",
  "banggood",
  "dhgate",
  "ebay",
  "etsy",
  "shein",
  "temu",
  "walmart",
  "wish",
  "made-in-china",
];
const INTERNATIONAL = new RegExp(`(?:^|\\.)(?:${INTERNATIONAL_BRANDS.join("|")})\\.(?:[a-z]{2,3}|com?\\.[a-z]{2})$`);

/** El dominio termina en .uy: está registrado en Uruguay (incluye mercadolibre.com.uy). */
export function isUruguayDomain(host: string): boolean {
  return host.endsWith(".uy");
}

/** La marca tiene que ser el dominio principal: "amazon.com" sí, "amazon.otracosa.com" no. */
export function isInternationalStore(host: string): boolean {
  return !isUruguayDomain(host) && INTERNATIONAL.test(host);
}

/**
 * Dominio que lleva adentro la terminación de otro ("mercadolibre.com.uy.otracosa.com"): es la forma
 * típica de imitar a un sitio conocido. No se le cree nada de lo que diga la fuente.
 */
export function looksLikeImitation(host: string): boolean {
  return !isUruguayDomain(host) && /[a-z0-9]\.(?:uy|(?:com|org|net|edu|gub|gob|gov|co)\.[a-z]{2})\./.test(host);
}

/**
 * Qué tan seguro es que el sitio vende en Uruguay. El dominio manda: solo un .uy queda "confirmado".
 * Para el resto, si el resultado de Google nombra a Uruguay queda "probable"; nunca pasa de ahí.
 */
export function classifyUruguay(host: string, mentionsUruguay: boolean): { uruguay: UruguayStatus; international: boolean } {
  if (isUruguayDomain(host)) return { uruguay: "confirmado", international: false };
  if (isInternationalStore(host)) return { uruguay: "no_confirmado", international: true };
  if (looksLikeImitation(host)) return { uruguay: "no_confirmado", international: false };
  return { uruguay: mentionsUruguay ? "probable" : "no_confirmado", international: false };
}

/** Sitios que claramente no son tiendas: redes sociales, enciclopedias, videos, foros, diarios y blogs. */
const NON_STORE_DOMAINS = [
  "wikipedia.org", "youtube.com", "youtu.be", "facebook.com", "instagram.com", "tiktok.com", "reddit.com",
  "twitter.com", "x.com", "linkedin.com", "quora.com", "medium.com", "blogspot.com", "wordpress.com", "tumblr.com",
  // Diarios y portales de noticias.
  "elpais.com.uy", "elobservador.com.uy", "montevideo.com.uy", "ladiaria.com.uy", "subrayado.com.uy", "teledoce.com",
  "infobae.com", "clarin.com", "lanacion.com.ar", "elpais.com", "bbc.com", "cnn.com",
];

/** ¿El resultado es de un sitio que no vende? Mira el dominio y, para blogs, también la ruta. */
export function isNonStore(host: string, url = ""): boolean {
  if (NON_STORE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  if (/(?:^|\.)pinterest\.(?:[a-z]{2,3}|com?\.[a-z]{2})$/.test(host)) return true;
  if (/^(?:blog|blogs|noticias|news|foro|forum)\./.test(host)) return true;
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // sin ruta que mirar
  }
  return /^\/(?:blog|blogs|noticias|news|foro|forum)(?:\/|$)/.test(path);
}

// ------------------------------------------------------------------
// Enlaces
// ------------------------------------------------------------------

/**
 * Enlace que se puede mostrar: https, con un nombre de dominio público (ni IP, ni localhost, ni nombres
 * internos), sin usuario ni contraseña y sin puerto raro. Devuelve el enlace normalizado o null.
 */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!normalizeHost(host)) return null;
  if (/\.(?:local|localdomain|localhost|internal|intranet|lan|home|corp|test|invalid|example|onion)$/.test(host)) return null;
  return url.toString();
}

function googleUrl(name: string, shopping: boolean): string {
  const base = name.replace(/\s+/g, " ").trim();
  const q = /\buruguay\b/i.test(base) ? base : `${base} Uruguay`;
  return `https://www.google.com/search?${shopping ? "tbm=shop&" : ""}q=${encodeURIComponent(q)}&gl=uy&hl=es-419`;
}

/** Búsqueda de Google ya armada para Uruguay. No usa la IA ni gasta nada. */
export const googleSearchUrl = (name: string) => googleUrl(name, false);
export const googleShoppingUrl = (name: string) => googleUrl(name, true);

// ------------------------------------------------------------------
// Respuesta del buscador y lista final
// ------------------------------------------------------------------

/** Un resultado orgánico de Google tal como lo entrega el buscador, todavía sin validar el enlace. */
export interface RawSearchResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Lee la respuesta del actor de Apify (google-search-scraper): una lista de páginas, cada una con
 * organicResults[] (title, url, description). Es defensivo: lo que no tenga esa forma se saltea sin
 * romper. null = la respuesta entera tiene otra forma.
 */
export function parseSearchItems(data: unknown): RawSearchResult[] | null {
  const pages = Array.isArray(data) ? data : data && typeof data === "object" && "organicResults" in data ? [data] : null;
  if (!pages) return null;
  const results: RawSearchResult[] = [];
  let recognized = pages.length === 0;
  for (const page of pages) {
    if (!page || typeof page !== "object" || Array.isArray(page)) continue;
    const organic = (page as { organicResults?: unknown }).organicResults;
    if (!Array.isArray(organic)) continue;
    recognized = true;
    for (const entry of organic) {
      if (results.length >= WEB_LIMITS.maxRawResults) break;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.url !== "string" || !e.url.trim()) continue;
      results.push({ url: e.url.trim(), title: clean(e.title, WEB_LIMITS.titleMax), description: clean(e.description, WEB_LIMITS.descriptionMax) });
    }
  }
  return recognized ? results : null;
}

/** ¿El resultado nombra a Uruguay? Se mira el texto de Google y la ruta del enlace ("/uy/"). */
function mentionsUruguay(result: RawSearchResult, url: string): boolean {
  if (/\buruguay[oa]?s?\b|\bmontevideo\b/i.test(`${result.title} ${result.description}`)) return true;
  return /\/uy(?:\/|$)/i.test(new URL(url).pathname);
}

const URUGUAY_ORDER: Record<UruguayStatus, number> = { confirmado: 0, probable: 1, no_confirmado: 2 };

/**
 * Lista final a partir de los resultados de Google. Los enlaces que no son seguros se descartan, quedan
 * como mucho WEB_LIMITS.maxPerDomain por dominio y WEB_LIMITS.maxResults en total. Dentro de cada grupo
 * se respeta el orden de Google. Título y descripción son los de Google, sin agregar nada.
 */
export function buildWebSellers(raw: RawSearchResult[]): WebSeller[] {
  const perDomain = new Map<string, number>();
  const seenUrls = new Set<string>();
  const sellers: WebSeller[] = [];
  for (const result of raw) {
    const url = safeHttpsUrl(result.url);
    if (!url || seenUrls.has(url)) continue;
    const site = normalizeHost(new URL(url).hostname);
    if (!site) continue;
    const domain = siteDomain(site);
    const count = perDomain.get(domain) ?? 0;
    if (count >= WEB_LIMITS.maxPerDomain) continue;
    perDomain.set(domain, count + 1);
    seenUrls.add(url);
    sellers.push({
      site,
      url,
      title: clean(result.title, WEB_LIMITS.titleMax) || site,
      why: clean(result.description, WEB_LIMITS.descriptionMax),
      ...classifyUruguay(site, mentionsUruguay(result, url)),
      kind: isNonStore(site, url) ? "other" : "store",
    });
  }
  return sellers
    .map((seller, index) => ({ seller, index }))
    .sort(
      (a, b) =>
        Number(a.seller.kind === "other") - Number(b.seller.kind === "other") ||
        // Entre lo que no es tienda no hay nada que ordenar por país: queda como lo dio Google.
        (a.seller.kind === "other" ? 0 : Number(a.seller.international) - Number(b.seller.international)) ||
        (a.seller.kind === "other" ? 0 : URUGUAY_ORDER[a.seller.uruguay] - URUGUAY_ORDER[b.seller.uruguay]) ||
        a.index - b.index
    )
    .slice(0, WEB_LIMITS.maxResults)
    .map(({ seller }) => seller);
}

/** Tiendas que van en la lista principal: de Uruguay, confirmadas o probables. */
export function isMainSeller(seller: WebSeller): boolean {
  return seller.kind === "store" && !seller.international && seller.uruguay !== "no_confirmado";
}

/** Valida en la pantalla lo que devolvió el servidor: solo pasan los campos esperados y enlaces https seguros. */
export function parseWebSellersResponse(data: unknown): WebSellersResponse | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || !Array.isArray(d.results)) return null;
  const results: WebSeller[] = [];
  for (const entry of d.results.slice(0, WEB_LIMITS.maxResults)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const url = safeHttpsUrl(e.url);
    if (!url) continue;
    // El dominio se lee del enlace, no del campo "site": así no pueden no coincidir.
    const site = normalizeHost(new URL(url).hostname);
    if (!site) continue;
    results.push({
      site,
      url,
      title: clean(e.title, WEB_LIMITS.titleMax) || site,
      why: clean(e.why, WEB_LIMITS.descriptionMax),
      ...classifyUruguay(site, e.uruguay === "probable" || e.uruguay === "confirmado"),
      kind: e.kind === "other" || isNonStore(site, url) ? "other" : "store",
    });
  }
  const searchQueries = Array.isArray(d.searchQueries) ? d.searchQueries.map((q) => clean(q, 200)).filter(Boolean).slice(0, 3) : [];
  return { ok: true, query: clean(d.query, WEB_LIMITS.queryMax), results, searchQueries, cached: d.cached === true };
}
