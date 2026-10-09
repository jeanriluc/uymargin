/**
 * "En la web (Uruguay)": qué sitios venden un producto, según una búsqueda de Google hecha por la IA.
 * Acá va todo lo que no necesita red: validar la consulta, clasificar dominios, validar enlaces y armar
 * la lista final. Sin DOM y sin Node: lo usan el servidor, la pantalla y los tests.
 */

/** Límites de la búsqueda web. Único lugar donde se cambian. */
export const WEB_LIMITS = {
  queryMin: 2,
  /** El mismo largo que admite el nombre de búsqueda del Radar. */
  queryMax: 120,
  /** Resultados que se devuelven como mucho, sumando los dos grupos. */
  maxResults: 10,
  /** Fuentes de la búsqueda que se miran como mucho (cada una puede necesitar resolver un enlace). */
  maxSources: 20,
  /** Búsquedas de Google que se muestran como mucho. */
  maxSearchQueries: 5,
} as const;

export const WEB_MESSAGES = {
  query: "Escribí el nombre del producto (entre 2 y 120 caracteres).",
  billing: "La búsqueda web necesita activar la facturación de la clave de Gemini.",
  notConfigured: "La búsqueda web no está disponible: falta configurar la IA en el servidor.",
  provider: "No se pudo hacer la búsqueda web en este momento. Probá de nuevo en unos minutos o usá los botones de Google.",
  network: "Error de red al buscar en la web. Revisá la conexión y probá de nuevo.",
  empty: "No encontré sitios que vendan ese producto. Probá con un nombre más corto o usá los botones de Google.",
  notice: "Usa la búsqueda de Google. Los resultados pueden ser productos parecidos: verificá en cada sitio.",
} as const;

export type WebConfidence = "alta" | "media" | "baja";
export type UruguayStatus = "confirmado" | "probable" | "no_confirmado";

export const URUGUAY_LABELS: Record<UruguayStatus, string> = {
  confirmado: "Uruguay: confirmado",
  probable: "Uruguay: probable",
  no_confirmado: "Uruguay: no confirmado",
};

export interface WebSeller {
  /** Dominio del sitio, sin "www.". */
  site: string;
  /** Enlace https a la página que encontró la búsqueda. null si no se pudo obtener un enlace seguro. */
  url: string | null;
  title: string;
  /** Una frase sobre qué vende. Sin precios. */
  why: string;
  confidence: WebConfidence;
  uruguay: UruguayStatus;
  /** Tienda o marketplace global: hay que confirmar que envía a Uruguay. */
  international: boolean;
}

export interface WebSellersResponse {
  ok: true;
  query: string;
  results: WebSeller[];
  /** Lo que Google buscó para armar la respuesta. */
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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
 * Qué tan seguro es que el sitio vende en Uruguay. El dominio manda: solo un .uy queda "confirmado",
 * y solo si el dominio se leyó del enlace real (verified). Para el resto vale lo que dijo la fuente,
 * y nunca pasa de "probable".
 */
export function classifyUruguay(host: string, claim: unknown, verified = true): { uruguay: UruguayStatus; international: boolean } {
  if (isUruguayDomain(host)) return { uruguay: verified ? "confirmado" : "probable", international: false };
  if (isInternationalStore(host)) return { uruguay: "no_confirmado", international: true };
  if (looksLikeImitation(host)) return { uruguay: "no_confirmado", international: false };
  const says = typeof claim === "string" ? claim.trim().toLowerCase() : "";
  const positive = says === "confirmado" || says === "probable" || says === "si" || says === "sí";
  return { uruguay: positive ? "probable" : "no_confirmado", international: false };
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
// Respuesta de la IA y lista final
// ------------------------------------------------------------------

/** Precios dentro de un texto: en esta etapa no se muestran. */
const PRICE = /(?:US\$|U\$S|USD|UYU|\$U|\$)\s?\d[\d.,]*|\d[\d.,]*\s?(?:US\$|U\$S|USD|UYU|\$U|pesos|d[oó]lares)\b/gi;

function withoutPrices(text: string): string {
  return text.replace(PRICE, "").replace(/\s+([.,;:])/g, "$1").replace(/\s+/g, " ").trim();
}

/** Lo que dijo la IA de un sitio, todavía sin cruzar con las fuentes. */
export interface SellerClaim {
  site: string;
  title: string;
  why: string;
  confidence: WebConfidence;
  uruguay: string;
}

function extractJson(text: string): unknown {
  const attempts = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // se prueba la siguiente forma
    }
  }
  return undefined;
}

/**
 * Lee la lista de sitios de la respuesta de la IA. null = la respuesta no se pudo leer.
 * Cada entrada necesita un dominio válido; lo demás se acota o se descarta en silencio.
 */
export function parseSellerClaims(text: unknown): SellerClaim[] | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const raw = extractJson(text);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { results?: unknown }).results : undefined;
  if (!Array.isArray(list)) return null;
  const claims: SellerClaim[] = [];
  for (const entry of list.slice(0, 50)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const site = normalizeHost(typeof e.site === "string" ? e.site.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] : null);
    if (!site) continue;
    claims.push({
      site,
      title: withoutPrices(clean(e.title, 140)),
      why: withoutPrices(clean(e.why, 220)),
      confidence: e.confidence === "alta" || e.confidence === "media" ? e.confidence : "baja",
      uruguay: clean(e.uruguay, 20),
    });
  }
  return claims;
}

/** Una fuente real de la búsqueda, con su enlace ya resuelto y validado. */
export interface ResolvedSource {
  /** Dominio de la página. */
  host: string;
  /** Enlace https seguro, o null si no se pudo resolver (en ese caso el dominio no está verificado). */
  url: string | null;
  title: string;
}

const URUGUAY_ORDER: Record<UruguayStatus, number> = { confirmado: 0, probable: 1, no_confirmado: 2 };
const CONFIDENCE_ORDER: Record<WebConfidence, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Lista final. Solo entran sitios que están en las fuentes reales de la búsqueda: lo que la IA mencione
 * sin fuente se descarta. Un sitio por dominio, como mucho WEB_LIMITS.maxResults.
 * Si la respuesta de la IA no se pudo leer (claims null), se listan las fuentes con confianza baja.
 */
export function buildWebSellers(claims: SellerClaim[] | null, sources: ResolvedSource[]): WebSeller[] {
  const byDomain = new Map<string, ResolvedSource>();
  for (const source of sources) {
    const domain = siteDomain(source.host);
    const current = byDomain.get(domain);
    // Se queda con la primera fuente del dominio, salvo que una posterior sí tenga enlace.
    if (!current || (!current.url && source.url)) byDomain.set(domain, source);
  }

  const sellers: WebSeller[] = [];
  const used = new Set<string>();
  const add = (source: ResolvedSource, claim: SellerClaim | null) => {
    const domain = siteDomain(source.host);
    if (used.has(domain)) return;
    used.add(domain);
    const site = source.host;
    sellers.push({
      site,
      url: source.url,
      title: claim?.title || withoutPrices(clean(source.title, 140)) || site,
      why: claim?.why ?? "",
      confidence: claim?.confidence ?? "baja",
      // Sin enlace resuelto, el dominio viene del título de la fuente: no alcanza para "confirmado".
      ...classifyUruguay(site, claim?.uruguay, source.url !== null),
    });
  };

  if (claims) {
    for (const claim of claims) {
      const source = byDomain.get(siteDomain(claim.site));
      if (source) add(source, claim);
    }
  } else {
    for (const source of byDomain.values()) add(source, null);
  }

  return sellers
    .map((seller, index) => ({ seller, index }))
    .sort(
      (a, b) =>
        Number(a.seller.international) - Number(b.seller.international) ||
        URUGUAY_ORDER[a.seller.uruguay] - URUGUAY_ORDER[b.seller.uruguay] ||
        CONFIDENCE_ORDER[a.seller.confidence] - CONFIDENCE_ORDER[b.seller.confidence] ||
        a.index - b.index
    )
    .slice(0, WEB_LIMITS.maxResults)
    .map(({ seller }) => seller);
}

/** Sitios que van en la lista principal: de Uruguay, confirmados o probables. */
export function isMainSeller(seller: WebSeller): boolean {
  return !seller.international && seller.uruguay !== "no_confirmado";
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
    const site = normalizeHost(e.site);
    if (!site) continue;
    const url = safeHttpsUrl(e.url);
    const { uruguay, international } = classifyUruguay(site, e.uruguay, url !== null);
    results.push({
      site,
      url,
      title: clean(e.title, 140) || site,
      why: clean(e.why, 220),
      confidence: e.confidence === "alta" || e.confidence === "media" ? e.confidence : "baja",
      uruguay,
      international,
    });
  }
  const searchQueries = Array.isArray(d.searchQueries)
    ? d.searchQueries.map((q) => clean(q, WEB_LIMITS.queryMax)).filter(Boolean).slice(0, WEB_LIMITS.maxSearchQueries)
    : [];
  return { ok: true, query: clean(d.query, WEB_LIMITS.queryMax), results, searchQueries, cached: d.cached === true };
}
