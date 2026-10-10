/**
 * Búsqueda visual de "Por foto": dónde se vende el producto de una foto, según Google Lens.
 * Acá va todo lo que no necesita red: leer la respuesta del actor de Apify, validar enlaces, clasificar
 * cada resultado, decidir si un precio se puede mostrar y proponer un nombre. Sin DOM y sin Node: lo usan
 * el servidor, la pantalla y los tests.
 */
import {
  cleanVerifyToken,
  isForeignSite,
  isInternationalStore,
  isNonStore,
  isUruguayDomain,
  looksLikeImitation,
  normalizeHost,
  safeHttpsUrl,
  siteDomain,
} from "../web/sellers.js";
import { PHOTO_NAME_MAX } from "./identify.js";

/** Límites de la búsqueda visual. Único lugar donde se cambian. */
export const VISUAL_LIMITS = {
  /** Resultados que se le piden al actor. */
  requested: 50,
  /** Items del dataset que se miran como mucho. */
  maxRawItems: 60,
  /** Resultados del mismo dominio que se muestran como mucho. */
  maxPerDomain: 2,
  /** Resultados que se devuelven como mucho, sumando todos los grupos. */
  maxResults: 40,
  /** Con menos resultados de Uruguay que esto, se ofrece identificar el nombre con IA. */
  minUruguayResults: 3,
  titleMax: 140,
  sourceMax: 60,
} as const;

export const VISUAL_MESSAGES = {
  privacy: "La foto se envía a un servicio externo de búsqueda visual (Apify / Google Lens). UyMargin no la guarda.",
  notice: "Son coincidencias visuales de Google Lens: pueden ser productos parecidos, no idénticos. Confirmá precio y stock en cada tienda.",
  priceNote: "precio informado por Google, confirmar en la tienda",
  notConfigured: "La búsqueda visual no está configurada en el servidor.",
  noCredit: "Se agotó el crédito del servicio de búsqueda visual.",
  unavailable: "La búsqueda visual no respondió en este momento.",
  timeout: "La búsqueda visual tardó demasiado.",
  noMatches: "Google Lens no encontró coincidencias para esa foto.",
  searching: "Buscando… puede tardar hasta 1 minuto",
  aiName: "Nombre sugerido por IA a partir de la foto",
  network: "Error de red al enviar la foto. Revisá la conexión y probá de nuevo.",
} as const;

/** Códigos de error de /api/visual-search que la pantalla distingue. */
export type VisualSearchErrorCode =
  | "VISUAL_SEARCH_NOT_CONFIGURED"
  | "VISUAL_SEARCH_NO_CREDIT"
  | "VISUAL_SEARCH_UNAVAILABLE"
  | "VISUAL_SEARCH_TIMEOUT"
  | "VISUAL_SEARCH_NO_MATCHES";

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

// ------------------------------------------------------------------
// Respuesta del actor
// ------------------------------------------------------------------

/** Un resultado de Google Lens tal como lo entrega el actor, todavía sin validar. */
export interface RawLensItem {
  title: string;
  source: string;
  url: string;
  thumbnail: string;
  price: unknown;
  currency: unknown;
}

export type LensParse = { ok: true; items: RawLensItem[] } | { ok: false; reason: "otra forma" | "item de error" };

/**
 * Lee el dataset del actor johnvc/google-lens-api: una lista de items con title, source, url, thumbnail,
 * price y currency. Cuando el actor falla, el dataset trae un item con errorMessage en lugar de resultados:
 * eso se informa aparte, sin copiar el mensaje. Una lista vacía es válida (no hubo coincidencias).
 */
export function parseLensItems(data: unknown): LensParse {
  if (!Array.isArray(data)) return { ok: false, reason: "otra forma" };
  const items: RawLensItem[] = [];
  let errors = 0;
  for (const entry of data.slice(0, VISUAL_LIMITS.maxRawItems)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if ("errorMessage" in e || "error" in e) {
      errors++;
      continue;
    }
    if (typeof e.url !== "string" || !e.url.trim()) continue;
    items.push({
      url: e.url.trim(),
      title: clean(e.title, VISUAL_LIMITS.titleMax),
      source: clean(e.source, VISUAL_LIMITS.sourceMax),
      thumbnail: typeof e.thumbnail === "string" ? e.thumbnail : "",
      price: e.price,
      currency: e.currency,
    });
  }
  if (items.length > 0) return { ok: true, items };
  if (errors > 0) return { ok: false, reason: "item de error" };
  // Hay items pero ninguno se reconoce: el actor cambió de formato. No es lo mismo que "sin coincidencias".
  return data.length === 0 ? { ok: true, items } : { ok: false, reason: "otra forma" };
}

// ------------------------------------------------------------------
// Precio
// ------------------------------------------------------------------

export interface VisualPrice {
  amount: number;
  currency: "UYU" | "USD";
}

/** Lo que dice un texto de moneda, sin espacios ni puntos y en mayúsculas ("US$." → "US$", "$ U" → "$U"). */
type CurrencyReading = "USD" | "UYU" | "$" | null;

function readCurrency(value: unknown): CurrencyReading {
  if (typeof value !== "string") return null;
  const code = value.replace(/[\s.]+/g, "").toUpperCase();
  if (code === "USD" || code === "US$" || code === "U$S" || code === "U$D") return "USD";
  if (code === "UYU" || code === "$U" || code === "UYU$") return "UYU";
  // Un "$" suelto puede ser peso uruguayo, argentino o chileno, o dólar: lo decide quien sabe de qué sitio es.
  return code === "$" ? "$" : null;
}

/** Moneda escrita junto al número en el texto del precio: "US$ 75", "75 U$S", "$U 3.722", "$ 990". */
function currencyInText(text: string): CurrencyReading {
  if (/(?:US\$|U\$S|U\$D|\bUSD\b)/i.test(text)) return "USD";
  if (/(?:\$\s?U\b|\bUYU\b)/i.test(text)) return "UYU";
  return text.includes("$") ? "$" : null;
}

/**
 * Número de un precio escrito como texto. Entiende "3.722", "3.722,50", "1,299.50" y "59,95": con los dos
 * separadores, el último es el decimal; con uno solo, es de miles si se repite o si le siguen justo 3 cifras.
 */
export function parseAmount(text: string): number | null {
  const digits = text.match(/\d[\d.,]*/)?.[0].replace(/[.,]+$/, "");
  if (!digits) return null;
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    normalized = digits.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    const parts = separator ? digits.split(separator) : [digits];
    const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = thousands ? parts.join("") : parts.join(".");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Precio que se puede mostrar, o null. En Uruguay se publica en pesos y en dólares, así que se reconocen
 * las dos monedas en sus formas habituales: dólares (USD, US$, U$S, U$D) y pesos uruguayos (UYU, $U, UYU$).
 * La moneda puede venir en su campo o escrita junto al número ("US$ 75"). Un "$" suelto solo se toma como
 * pesos uruguayos si el sitio es .uy (incluye Mercado Libre Uruguay); en cualquier otro dominio es ambiguo
 * y no se muestra. Monedas vacías o raras (".") se descartan. El precio se muestra en la moneda en que vino:
 * no se convierte y nunca entra en un cálculo.
 */
export function visualPrice(price: unknown, currency: unknown, host = ""): VisualPrice | null {
  const fromText = typeof price === "string" ? currencyInText(price) : null;
  const amount = typeof price === "number" ? price : typeof price === "string" ? parseAmount(price) : null;
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || amount > 1e9) return null;
  const fromField = readCurrency(currency);
  // Manda la moneda explícita: primero la del campo, después la escrita junto al número.
  const explicit = fromField === "USD" || fromField === "UYU" ? fromField : fromText === "USD" || fromText === "UYU" ? fromText : null;
  if (explicit) return { amount, currency: explicit };
  if ((fromField === "$" || fromText === "$") && isUruguayDomain(host)) return { amount, currency: "UYU" };
  return null;
}

/**
 * "$ 3.722" para pesos uruguayos y "US$ 75" para dólares, cada precio en su moneda. A mano, para que dé lo
 * mismo en el servidor, en el navegador y en los tests.
 */
export function formatVisualPrice(price: VisualPrice): string {
  const [whole, decimals] = (Math.round(price.amount * 100) / 100).toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${price.currency === "UYU" ? "$" : "US$"} ${grouped}${decimals ? `,${decimals.padEnd(2, "0")}` : ""}`;
}

// ------------------------------------------------------------------
// Clasificación
// ------------------------------------------------------------------

/**
 * Dónde se muestra cada resultado. "foreign" son los sitios del exterior (lista de sellers.ts): no se
 * muestran como grupo, quedan detrás de "Se ocultaron N resultados de otros países".
 */
export type VisualGroup = "ml_uy" | "uy_stores" | "unconfirmed" | "others" | "foreign";

export const VISUAL_GROUP_LABELS: Record<VisualGroup, string> = {
  ml_uy: "Mercado Libre Uruguay",
  uy_stores: "Tiendas de Uruguay",
  unconfirmed: "Sin confirmar",
  others: "Otros resultados: redes y sitios que no son tiendas",
  foreign: "Resultados de otros países",
};

const ML_UY_DOMAIN = "mercadolibre.com.uy";

/** Comparadores de precios: muestran ofertas de otros, no venden. */
const COMPARATORS = /(?:^|\.)(?:idealo|kelkoo|pricerunner|pricespy|geizhals|buscape|shopzilla|bizrate|shopmania|camelcamelcamel|preisvergleich|ciao)\.(?:[a-z]{2,3}|com?\.[a-z]{2})$/;
/** Sitios del Estado y educativos. */
const OFFICIAL = /\.(?:gub|gob|gov|mil|edu)\.[a-z]{2}$|\.(?:gov|mil|edu)$/;

/** Sitios que no venden: los de sellers.ts (redes, diarios, blogs) más comparadores y sitios oficiales. */
export function isVisualNonStore(host: string, url = ""): boolean {
  return isNonStore(host, url) || COMPARATORS.test(host) || OFFICIAL.test(host);
}

/** Terminaciones de dos letras que se usan como genéricas, no como país. */
const GENERIC_TWO_LETTER = new Set(["co", "io", "me", "tv", "ai", "cc", "gg", "to", "ly", "fm"]);

/** El dominio es de otro país: termina en .ar, .br, .cl, .ve, .de… (no .uy ni una terminación genérica). */
export function isForeignDomain(host: string): boolean {
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (tld.length !== 2 || tld === "uy") return false;
  if (!GENERIC_TWO_LETTER.has(tld)) return true;
  // "tienda.co" es genérico; "tienda.com.co" es Colombia.
  return /^(?:com|net|org|edu|gov|gob)$/.test(labels[labels.length - 2] ?? "");
}

/** ¿El resultado nombra a Uruguay? "Uruguay", "Montevideo", "envíos a todo el país" o una ruta /uy/. */
function mentionsUruguay(text: string, url: string): boolean {
  if (/\buruguay[oa]?s?\b|\bmontevideo\b|\benv[ií]os?\s+a\s+todo\s+el\s+pa[ií]s\b/i.test(text)) return true;
  try {
    return /\/uy(?:\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Grupo de un resultado. El dominio manda: solo un .uy queda "confirmado". Una tienda .com entra a
 * "Tiendas de Uruguay" como "probable" si Google informa el precio en pesos uruguayos o el resultado nombra
 * a Uruguay, a Montevideo o dice "envíos a todo el país". Un precio en dólares no dice nada por sí solo: se
 * publica en dólares en todos lados. Un dominio de otro país nunca entra, diga lo que diga. Un dominio que
 * imita a otro va a "Otros resultados" y no se le cree nada.
 */
export function classifyVisual(
  host: string,
  url: string,
  signals: { uyuPrice: boolean; text: string }
): { group: VisualGroup; uruguay: "confirmado" | "probable" | null } {
  if (looksLikeImitation(host)) return { group: "others", uruguay: null };
  // Lo del exterior se oculta antes que nada, sea tienda, comparador o blog. Un .uy nunca cae acá.
  if (isForeignSite(host)) return { group: "foreign", uruguay: null };
  if (isVisualNonStore(host, url)) return { group: "others", uruguay: null };
  if (siteDomain(host) === ML_UY_DOMAIN) return { group: "ml_uy", uruguay: "confirmado" };
  if (isUruguayDomain(host)) return { group: "uy_stores", uruguay: "confirmado" };
  // Otro país que no está en la lista (por ejemplo .nl): no se oculta, pero tampoco se da por uruguayo.
  if (isInternationalStore(host) || isForeignDomain(host)) return { group: "unconfirmed", uruguay: null };
  if (signals.uyuPrice || mentionsUruguay(signals.text, url)) return { group: "uy_stores", uruguay: "probable" };
  return { group: "unconfirmed", uruguay: null };
}

/** Miniaturas: solo las que sirve Google. Cualquier otro origen se omite, así el navegador no le pide nada a un sitio desconocido. */
export function safeThumbnailUrl(value: unknown): string | null {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  return /(?:^|\.)(?:gstatic\.com|googleusercontent\.com|ggpht\.com)$/.test(host) ? url : null;
}

// ------------------------------------------------------------------
// Lista final y nombre sugerido
// ------------------------------------------------------------------

export interface VisualMatch {
  /** Dominio del sitio, sin "www.". Sale del enlace. */
  site: string;
  /** Nombre del sitio según Google. Puede estar vacío. */
  source: string;
  /** Enlace https a la página. Nunca se visita: solo se muestra. */
  url: string;
  title: string;
  group: VisualGroup;
  uruguay: "confirmado" | "probable" | null;
  price: VisualPrice | null;
  thumbnail: string | null;
  /** Permiso firmado para pedirle al servidor que verifique este sitio (/api/verify-sites). */
  verifyToken?: string;
}

/** ¿Este resultado se puede mandar a verificar? Mercado Libre Uruguay, tiendas de Uruguay y sin confirmar. */
export function isVerifiableMatch(match: VisualMatch): boolean {
  return match.group === "ml_uy" || match.group === "uy_stores" || match.group === "unconfirmed";
}

/** Valida un resultado y lo clasifica. Lo usan el servidor y la pantalla, así los dos deciden lo mismo. */
export function toVisualMatch(raw: RawLensItem): VisualMatch | null {
  const url = safeHttpsUrl(raw.url);
  if (!url) return null;
  const site = normalizeHost(new URL(url).hostname);
  if (!site) return null;
  const title = clean(raw.title, VISUAL_LIMITS.titleMax) || site;
  const source = clean(raw.source, VISUAL_LIMITS.sourceMax);
  const price = visualPrice(raw.price, raw.currency, site);
  const { group, uruguay } = classifyVisual(site, url, { uyuPrice: price?.currency === "UYU", text: `${title} ${source}` });
  return {
    site,
    source,
    url,
    title,
    group,
    uruguay,
    // Lo que no es una tienda no tiene un precio que mostrar.
    price: group === "others" ? null : price,
    thumbnail: safeThumbnailUrl(raw.thumbnail),
  };
}

/** Saca del título lo que agrega el sitio: "| MercadoLibre", "Cuotas sin interés", "Envío gratis", emojis. */
export function cleanListingTitle(title: string, source = ""): string {
  let text = title
    .replace(/\p{Extended_Pictographic}|️/gu, " ")
    .replace(/\bmercado\s*libre(?:\s+(?:uruguay|argentina))?\b/gi, " ")
    // El número solo se saca si viene con "en" o "hasta": suelto puede ser parte del producto.
    .replace(/\b(?:(?:hasta\s+|en\s+)+\d{1,2}\s+)?cuotas\s+sin\s+inter[eé]s\b/gi, " ")
    .replace(/\benv[ií]o\s+gratis\b/gi, " ")
    .replace(/\b\d{1,2}\s*%\s*off\b/gi, " ");
  // "Amazon.com: Producto" y "Producto : Amazon.es: Categoría".
  text = text.replace(/^\s*amazon\.[a-z.]{2,6}\s*:\s*/i, "").replace(/\s*:\s*amazon\.[a-z.]{2,6}\b.*$/i, " ");
  // "Producto – Tienda": el tramo final después de una raya o barra es el nombre del sitio.
  text = text.replace(/\s+[–—|]\s+[^–—|]*$/, " ");
  // "Producto - Tienda" o "Producto - Tienda.com", solo si coincide con el nombre del sitio.
  const tail = source.trim().toLowerCase();
  const lower = text.trim().toLowerCase();
  for (const ending of tail ? [` - ${tail}.com`, ` - ${tail}`] : []) {
    if (lower.endsWith(ending)) {
      text = text.trim().slice(0, -ending.length);
      break;
    }
  }
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s|\-–—·.,:]+|[\s|\-–—·,:]+$/g, "")
    .slice(0, PHOTO_NAME_MAX)
    .trim();
}

const key = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * El título más repetido. Si ninguno se repite tal cual, gana el que más palabras comparte con los demás
 * (el más representativo); si empatan, el primero según Google.
 */
export function mostRepeatedTitle(titles: string[]): string {
  const cleaned = titles.filter((t) => key(t).length >= 2);
  if (cleaned.length === 0) return "";
  const repeats = new Map<string, number>();
  const wordUse = new Map<string, number>();
  for (const title of cleaned) {
    const k = key(title);
    repeats.set(k, (repeats.get(k) ?? 0) + 1);
    for (const word of new Set(k.split(" "))) wordUse.set(word, (wordUse.get(word) ?? 0) + 1);
  }
  let best = cleaned[0];
  let bestScore = -1;
  for (const title of cleaned) {
    const k = key(title);
    const words = [...new Set(k.split(" "))];
    const shared = words.reduce((sum, w) => sum + (wordUse.get(w) ?? 0), 0) / words.length;
    const score = (repeats.get(k) ?? 0) * 1000 + shared;
    if (score > bestScore) {
      best = title;
      bestScore = score;
    }
  }
  return best;
}

export interface VisualSummary {
  results: VisualMatch[];
  /** Nombre propuesto para el campo editable. Vacío si no hay de dónde sacarlo. */
  suggestedName: string;
  /** Publicaciones de Mercado Libre Uruguay encontradas (antes de limitar por dominio). */
  mlCount: number;
  /** Resultados de Uruguay encontrados, sumando Mercado Libre y tiendas (antes de limitar por dominio). */
  uruguayCount: number;
  /**
   * Cómo reconoce Lens el producto: el título más repetido entre las tiendas de cualquier país. Es solo para
   * mostrar cuando no hay nada de Uruguay; nunca se usa para buscar. Vacío si no hay de dónde sacarlo.
   */
  recognizedAs: string;
}

const GROUP_ORDER: Record<VisualGroup, number> = { ml_uy: 0, uy_stores: 1, unconfirmed: 2, others: 3, foreign: 4 };

/**
 * Lista final a partir de los items del actor. Los enlaces que no son seguros se descartan, no se repite
 * una dirección y quedan como mucho VISUAL_LIMITS.maxPerDomain por dominio. Entre las tiendas de Uruguay
 * van primero las que traen precio; en lo demás se respeta el orden de Google.
 */
export function buildVisualMatches(raw: RawLensItem[]): VisualSummary {
  const seenUrls = new Set<string>();
  const perDomain = new Map<string, number>();
  const shown: VisualMatch[] = [];
  const mlTitles: string[] = [];
  const storeTitles: string[] = [];
  const allTitles: string[] = [];
  let uruguayCount = 0;
  for (const item of raw) {
    const match = toVisualMatch(item);
    if (!match || seenUrls.has(match.url)) continue;
    seenUrls.add(match.url);
    // Redes, comparadores e imitadores no dicen qué producto es: sus títulos no cuentan.
    if (match.group !== "others") allTitles.push(cleanListingTitle(match.title, match.source));
    if (match.group === "ml_uy" || match.group === "uy_stores") {
      uruguayCount++;
      (match.group === "ml_uy" ? mlTitles : storeTitles).push(cleanListingTitle(match.title, match.source));
    }
    const domain = siteDomain(match.site);
    const count = perDomain.get(domain) ?? 0;
    if (count >= VISUAL_LIMITS.maxPerDomain) continue;
    perDomain.set(domain, count + 1);
    shown.push(match);
  }
  const results = shown
    .map((match, index) => ({ match, index }))
    .sort(
      (a, b) =>
        GROUP_ORDER[a.match.group] - GROUP_ORDER[b.match.group] ||
        (a.match.group === "uy_stores" ? Number(b.match.price !== null) - Number(a.match.price !== null) : 0) ||
        a.index - b.index
    )
    .slice(0, VISUAL_LIMITS.maxResults)
    .map(({ match }) => match);
  // El nombre sale de Mercado Libre Uruguay; si no hay publicaciones, de las tiendas de Uruguay.
  const suggestedName = mostRepeatedTitle(mlTitles) || mostRepeatedTitle(storeTitles);
  return { results, suggestedName, mlCount: mlTitles.length, uruguayCount, recognizedAs: mostRepeatedTitle(allTitles) };
}

/**
 * ¿Hay que pedirle el nombre a la IA sin esperar al usuario? Cuando la búsqueda terminó y encontró menos de
 * VISUAL_LIMITS.minUruguayResults resultados de Uruguay, incluso ninguno. Si falló por otro motivo (tiempo,
 * crédito, servicio caído) no: ahí queda el botón.
 */
export function wantsAutoName(outcome: { uruguayCount: number } | { code: string | null }): boolean {
  if ("uruguayCount" in outcome) return outcome.uruguayCount < VISUAL_LIMITS.minUruguayResults;
  return outcome.code === "VISUAL_SEARCH_NO_MATCHES";
}

/**
 * ¿Se lanza sola la búsqueda por nombre (la de "En la web (Uruguay)") después de que la IA propuso un nombre?
 * Solo cuando la IA corrió sola, propuso un nombre, ese nombre es el que quedó en el campo (si el usuario
 * escribió otro, no) y todavía no se lanzó para esta foto: un solo intento, porque cada búsqueda se paga.
 */
export function shouldAutoSearchByName(state: {
  /** La IA corrió sola (no por el botón). */
  automatic: boolean;
  aiName: string;
  /** Lo que hay en el campo de nombre en ese momento. */
  currentName: string;
  /** El nombre que había propuesto la búsqueda visual: se puede reemplazar. */
  visualName: string;
  alreadyLaunched: boolean;
}): boolean {
  if (!state.automatic || state.alreadyLaunched) return false;
  if (state.aiName.trim().length < 2) return false;
  const current = state.currentName.trim();
  return current === "" || current === state.visualName.trim() || current === state.aiName.trim();
}

export interface VisualSearchResponse extends VisualSummary {
  ok: true;
  /** La respuesta salió de la memoria del servidor, sin pagar otra búsqueda. */
  cached: boolean;
}

function count(value: unknown, min: number): number {
  const n = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.max(min, Math.min(n, VISUAL_LIMITS.maxRawItems));
}

/**
 * Valida en la pantalla lo que devolvió el servidor: cada resultado se vuelve a validar y a clasificar a
 * partir de su enlace, así que a la pantalla solo llegan enlaces https seguros y precios en una moneda conocida.
 */
export function parseVisualResponse(data: unknown): VisualSearchResponse | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || !Array.isArray(d.results)) return null;
  const results: VisualMatch[] = [];
  for (const entry of d.results.slice(0, VISUAL_LIMITS.maxResults)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const price = e.price && typeof e.price === "object" ? (e.price as Record<string, unknown>) : null;
    const match = toVisualMatch({
      url: typeof e.url === "string" ? e.url : "",
      title: clean(e.title, VISUAL_LIMITS.titleMax),
      source: clean(e.source, VISUAL_LIMITS.sourceMax),
      thumbnail: typeof e.thumbnail === "string" ? e.thumbnail : "",
      // El servidor ya manda el monto como número y la moneda resuelta: acá no se interpreta ningún texto.
      price: typeof price?.amount === "number" ? price.amount : null,
      currency: price?.currency === "UYU" || price?.currency === "USD" ? price.currency : null,
    });
    const token = cleanVerifyToken(e.verifyToken);
    if (match) results.push(token && isVerifiableMatch(match) ? { ...match, verifyToken: token } : match);
  }
  const inUruguay = results.filter((m) => m.group === "ml_uy" || m.group === "uy_stores").length;
  return {
    ok: true,
    results,
    suggestedName: clean(d.suggestedName, PHOTO_NAME_MAX),
    mlCount: count(d.mlCount, results.filter((m) => m.group === "ml_uy").length),
    uruguayCount: count(d.uruguayCount, inUruguay),
    recognizedAs: clean(d.recognizedAs, PHOTO_NAME_MAX),
    cached: d.cached === true,
  };
}
