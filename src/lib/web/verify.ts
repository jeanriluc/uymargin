/**
 * Verificación de sitios: ¿la tienda es de Uruguay y la página sigue activa? Acá va todo lo que no necesita
 * red: qué direcciones IP no se pueden tocar, qué indicios de Uruguay tiene un HTML, si una página está
 * caída, parqueada o protegida contra robots, y cómo se lee la respuesta del servidor. Sin DOM y sin Node:
 * lo usan el servidor, la pantalla y los tests. El HTML de terceros es siempre un dato: de él solo salen
 * rótulos fijos y nombres de una lista cerrada, nunca texto libre de la página.
 */
import { siteDomain } from "./sellers.js";

/** Límites de la verificación. Único lugar donde se cambian. */
export const VERIFY_LIMITS = {
  /** Resultados por pedido. */
  maxSites: 8,
  /** Redirecciones que se siguen por página. */
  maxRedirects: 3,
  /** Espera máxima por página, contando sus redirecciones. */
  pageTimeoutMs: 8_000,
  /** Cuerpo que se lee como mucho; al llegar se corta la lectura. */
  maxBodyBytes: 400 * 1024,
  /** Páginas que se abren a la vez. */
  concurrency: 4,
  /** Pedidos por sitio: la dirección del resultado y, si ahí no hay indicios, la página de inicio. */
  maxRequestsPerSite: 2,
  /** Cuánto vale el permiso firmado que acompaña a cada resultado. */
  tokenTtlMs: 30 * 60 * 1000,
  tokenMaxLength: 2000,
  /** Indicios que se devuelven como mucho por sitio. */
  maxSignals: 4,
} as const;

export const VERIFY_USER_AGENT = "UyMarginBot (+verificación de tiendas)";

export const VERIFY_MESSAGES = {
  notConfigured: "La verificación de sitios no está configurada en el servidor.",
  invalid: "No hay ningún sitio para verificar, o el permiso venció. Repetí la búsqueda.",
  failed: "No se pudo verificar los sitios",
  checking: "Verificando…",
  alive: "Activa",
  outOfStock: "Agotado",
  unknown: "No se pudo verificar",
  dead: "Caída",
} as const;

export type VerifyErrorCode = "VERIFY_NOT_CONFIGURED" | "VERIFY_INVALID_TOKEN";

// ------------------------------------------------------------------
// Direcciones IP que no se tocan
// ------------------------------------------------------------------

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function blockedIpv4([a, b]: number[]): boolean {
  return (
    a === 0 || // "esta red", incluye 0.0.0.0
    a === 10 || // privada
    a === 127 || // la propia máquina
    (a === 100 && b >= 64 && b <= 127) || // NAT del proveedor
    (a === 169 && b === 254) || // enlace local y metadatos de la nube (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 192 && b === 0) || // protocolos y documentación
    (a === 198 && (b === 18 || b === 19)) || // pruebas de red
    a >= 224 // multidifusión y reservadas
  );
}

/** Los 16 bytes de una dirección IPv6, o null si no lo es. Acepta "::" y la forma con IPv4 al final. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!text.includes(":")) return null;
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    const v4 = ipv4Parts(tail[2]);
    if (!v4) return null;
    text = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

/**
 * ¿La dirección no se puede abrir? Privadas, locales, de enlace local, de metadatos, de multidifusión y
 * reservadas, en IPv4 e IPv6 (incluidas las IPv6 que llevan adentro una IPv4). Lo que no se entiende como
 * dirección también se bloquea.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4Parts(ip.trim());
  if (v4) return blockedIpv4(v4);
  const b = ipv6Bytes(ip.trim());
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // IPv4 dentro de IPv6: ::a.b.c.d, ::ffff:a.b.c.d, 64:ff9b::a.b.c.d (NAT64) y 2002:a.b.c.d:: (6to4).
  if (zeros(0, 10) && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0))) {
    if (zeros(12, 16) || (zeros(12, 15) && b[15] === 1)) return true; // :: y ::1
    return blockedIpv4(b.slice(12, 16));
  }
  // IPv4 traducida (::ffff:0:a.b.c.d): lleva una IPv4 adentro. Se bloquea entera, sea cual sea.
  if ((zeros(0, 8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) || (zeros(0, 6) && b[6] === 0xff && b[7] === 0xff && b[8] === 0 && b[9] === 0)) return true;
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // 2001::/32, Teredo: túnel hacia una IPv4
  if (b[0] === 0x20 && b[1] === 0x02) return true;
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7, privadas
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10, enlace local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10, locales al sitio (en desuso)
  if (b[0] === 0xff) return true; // multidifusión
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentación
  return false;
}

/** ¿El texto es una dirección IP escrita tal cual (y no un nombre de dominio)? */
export function isIpLiteral(host: string): boolean {
  return ipv4Parts(host) !== null || host.includes(":") || /^\[.*\]$/.test(host) || /^[\d.]+$/.test(host) || /^0x/i.test(host);
}

/**
 * Dirección que el verificador puede abrir: http o https, puerto 80 o 443, un nombre de dominio público (nunca
 * una IP escrita, ni localhost, ni nombres internos), sin usuario ni contraseña. Devuelve la URL o null.
 * Falta resolver el DNS y mirar la IP: eso lo hace el servidor en cada salto.
 */
export function openableUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(host)) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  if (/\.(?:local|localdomain|localhost|internal|intranet|lan|home|corp|test|invalid|example|onion)$/.test(host)) return null;
  return url;
}

/** ¿Los dos hosts son del mismo sitio? Se permiten "www." y subdominios. */
export function sameSite(a: string, b: string): boolean {
  const clean = (h: string) => h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return siteDomain(clean(a)) === siteDomain(clean(b));
}

// ------------------------------------------------------------------
// Lectura del HTML
// ------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", plus: "+", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ" };

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,5});/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-zA-Z]{2,7});/g, (whole, name) => ENTITIES[name] ?? whole);
}

/** Texto visible aproximado: sin scripts, estilos ni etiquetas, con los espacios colapsados. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]{0,2000}>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return decodeEntities(m ? (m[1] ?? m[2] ?? m[3] ?? "") : "").trim();
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]{0,2000}>`, "gi")) ?? [];
}

function innerOf(html: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b[^>]{0,2000}>([\\s\\S]*?)<\\/${name}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) out.push(m[1]);
  return out;
}

/** Datos estructurados (JSON-LD) de la página, ya leídos. Lo que no es JSON válido se saltea. */
function structuredData(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]{0,500}type\s*=\s*["']?application\/ld\+json["']?[^>]{0,500}>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // un bloque roto no invalida los demás
    }
  }
  return out;
}

/** Recorre los datos estructurados, sin pasarse de profundidad ni de cantidad. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void, depth = 0, budget = { left: 3000 }): void {
  if (depth > 12 || budget.left-- <= 0 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 200)) walk(entry, visit, depth + 1, budget);
    return;
  }
  const node = value as Record<string, unknown>;
  visit(node);
  for (const child of Object.values(node)) walk(child, visit, depth + 1, budget);
}

// ------------------------------------------------------------------
// Indicios de Uruguay
// ------------------------------------------------------------------

/** Los 19 departamentos, como se muestran. */
export const UY_DEPARTMENTS = [
  "Montevideo", "Canelones", "Maldonado", "Colonia", "Salto", "Paysandú", "Rivera", "Rocha", "Tacuarembó", "Soriano",
  "Florida", "Durazno", "Flores", "Lavalleja", "Treinta y Tres", "Cerro Largo", "Artigas", "Río Negro", "San José",
] as const;

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DEPARTMENT_PATTERN = UY_DEPARTMENTS.map((d) => plain(d).replace(/ /g, "\\s+")).join("|");
/**
 * Un departamento pegado a "Uruguay", como en una dirección: "Montevideo, Uruguay", "Paysandú - Uruguay",
 * "Montevideo 11200, Uruguay", "Uruguay, departamento de Rocha". Que los dos aparezcan en la misma frase no
 * alcanza ("viajes a Montevideo y Uruguay"), y varios nombres son palabras comunes ("colonia", "salto", "flores").
 */
const DEPARTMENT_NEAR_URUGUAY = new RegExp(
  `\\b(${DEPARTMENT_PATTERN})\\b[\\s,.\\-–()\\d]{1,12}\\buruguay\\b|\\buruguay\\b[\\s,.\\-–()]{1,4}(?:(?:departamento|depto\\.?)\\s+de\\s+)?\\b(${DEPARTMENT_PATTERN})\\b`
);
const DEPARTMENT_ALONE = new RegExp(`^\\s*(${DEPARTMENT_PATTERN})\\s*$`);

function departmentName(found: string): string {
  const key = plain(found).replace(/\s+/g, " ");
  return UY_DEPARTMENTS.find((d) => plain(d) === key) ?? "Uruguay";
}

export type UruguayVerdict = "confirmed" | "probable" | "none";

export interface UruguaySignals {
  verdict: UruguayVerdict;
  /** Frases cortas y fijas ("teléfono +598", "dirección en Montevideo"). Nunca texto libre de la página. */
  signals: string[];
  /** Fuertes valen 3 y medias 1. Solo para ordenar y para los tests. */
  score: number;
}

/**
 * Indicios de que la tienda es de Uruguay. Con al menos uno fuerte queda "confirmed"; solo con medios,
 * "probable"; sin ninguno, "none". Vender en dólares o tener dominio .com no suma ni resta: el dólar no se mira.
 */
export function findUruguaySignals(html: string, pageUrl: string): UruguaySignals {
  const strong: string[] = [];
  const medium: string[] = [];
  const add = (list: string[], text: string) => {
    if (!list.includes(text)) list.push(text);
  };
  const text = visibleText(html);
  const flat = plain(text);
  const data = structuredData(html);

  // --- Fuertes ---
  let pesoPrice = false;
  for (const block of data) {
    walk(block, (node) => {
      const country = node.addressCountry;
      const countryText = typeof country === "string" ? country : country && typeof country === "object" ? String((country as { name?: unknown }).name ?? "") : "";
      if (/^\s*(?:uy|ury|uruguay)\s*$/i.test(countryText)) add(strong, "datos de la tienda con país Uruguay");
      for (const key of ["addressLocality", "addressRegion"]) {
        const place = typeof node[key] === "string" ? DEPARTMENT_ALONE.exec(plain(node[key] as string)) : null;
        if (place && /uruguay|^\s*uy\s*$/i.test(`${countryText}`)) add(strong, `dirección en ${departmentName(place[1])}`);
      }
      if (typeof node.priceCurrency === "string" && /^\s*UYU\s*$/i.test(node.priceCurrency)) pesoPrice = true;
    });
  }
  const links = tags(html, "a").map((tag) => attribute(tag, "href"));
  if (/\+\s?598[\s\-.()]*\d/.test(text) || links.some((href) => /^tel:\s*(?:\+|00)?\s*598[\s\-.()]*\d/i.test(href) || /(?:wa\.me\/|[?&]phone=)\+?598\d{7,9}\b/i.test(href))) {
    add(strong, "teléfono +598");
  }
  const htmlTag = tags(html, "html")[0] ?? "";
  const locales = [
    attribute(htmlTag, "lang"),
    ...tags(html, "meta").filter((tag) => /^og:locale$/i.test(attribute(tag, "property"))).map((tag) => attribute(tag, "content")),
    ...tags(html, "link").filter((tag) => /\balternate\b/i.test(attribute(tag, "rel"))).map((tag) => attribute(tag, "hreflang")),
  ];
  if (locales.some((locale) => /^es[-_]uy$/i.test(locale))) add(strong, "idioma es-UY");
  const address = DEPARTMENT_NEAR_URUGUAY.exec(flat);
  if (address) add(strong, `dirección en ${departmentName(address.slice(1).find(Boolean) ?? "")}`);
  // RUT uruguayo: 12 cifras. (El de Chile tiene otro formato, con guion y dígito verificador.)
  if (/\br\.?\s?u\.?\s?t\.?\b[\s:.\-n°ºo]{0,6}\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{4}\b/i.test(text)) add(strong, "RUT");

  // --- Medias ---
  if (pesoPrice || /\$\s?U\s?\d|\bUYU\s?\$?\s?\d|\d\s?UYU\b/.test(text) || tags(html, "meta").some((tag) => /price:currency$/i.test(attribute(tag, "property")) && /^UYU$/i.test(attribute(tag, "content")))) {
    add(medium, "precios en pesos uruguayos");
  }
  const local: string[] = [];
  if (/\bcorreo uruguayo\b/.test(flat)) local.push("Correo Uruguayo");
  if (/\bDAC\b/.test(text)) local.push("DAC");
  if (/\babitab\b/.test(flat)) local.push("Abitab");
  if (/\bred\s?pagos\b/.test(flat)) local.push("RedPagos");
  if (/\benvios?\s+a\s+todo\s+el\s+pais\b/.test(flat)) local.push("envíos a todo el país");
  if (/\benvios?\s+al\s+interior\b/.test(flat)) local.push("envíos al interior");
  if (local.length > 0) add(medium, local.slice(0, 2).join(", "));
  const footers = innerOf(html, "footer");
  const footerText = plain(footers.length > 0 ? footers.map(visibleText).join(" ") : text.slice(-1500));
  if (/\bmontevideo\b/.test(footerText)) add(medium, "Montevideo en el pie de página");
  else if (/\buruguay\b/.test(footerText)) add(medium, "Uruguay en el pie de página");
  let ownHost = "";
  try {
    ownHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    // sin host propio, cualquier .uy cuenta
  }
  const linksToUy = links.some((href) => {
    try {
      const host = new URL(href, pageUrl).hostname.toLowerCase();
      return host.endsWith(".uy") && !sameSite(host, ownHost);
    } catch {
      return false;
    }
  });
  if (linksToUy) add(medium, "enlaces a sitios .uy");

  const verdict: UruguayVerdict = strong.length > 0 ? "confirmed" : medium.length > 0 ? "probable" : "none";
  return { verdict, signals: [...strong, ...medium].slice(0, VERIFY_LIMITS.maxSignals), score: strong.length * 3 + medium.length };
}

// ------------------------------------------------------------------
// Página activa, caída, parqueada, protegida o agotada
// ------------------------------------------------------------------

/** Un título de error empieza con el código: "404", "Error 404", "404 - Página no encontrada". "Termo 404 ml" no. */
const NOT_FOUND_CODE = /^(?:error\s*)?(?:404|410)\b/;
/** Frases de error completas. Palabras sueltas como "no existe" o "not found" no alcanzan. */
const NOT_FOUND_PHRASE = /pagina no encontrada|(?:la |esta )?pagina no existe|no se encontro la pagina|page not found|this page could not be found|pagina inexistente/;
/** Un título o encabezado de error es corto: en uno largo, esas palabras suelen hablar del producto. */
const NOT_FOUND_MAX_LENGTH = 60;
const PARKED = /dominio (?:esta )?en venta|este dominio (?:esta|se encuentra) (?:en venta|a la venta|disponible)|domain (?:is|may be) for sale|buy this domain|this domain is (?:for sale|parked)|domain parking|parked (?:free|domain)|sedoparking|hugedomains|afternic|make an offer on this domain/;
const ROBOT_WALL = /just a moment\.\.\.|checking your browser|attention required|cf-chl-|challenge-platform|verify(?:ing)? (?:that )?you are (?:a )?human|are you a robot|no soy un robot|captcha|access denied|pardon our interruption|px-captcha|request unsuccessful\. incapsula/;
const PARKING_HOSTS = /(?:^|\.)(?:sedo\.com|sedoparking\.com|dan\.com|hugedomains\.com|afternic\.com|bodis\.com|parkingcrew\.net|above\.com|undeveloped\.com)$/;

/** ¿El sitio al que se llegó es un servicio de venta o estacionamiento de dominios? */
export function isParkingHost(host: string): boolean {
  return PARKING_HOSTS.test(host.toLowerCase());
}

/** ¿El HTML es una pantalla de protección contra robots (y no la página pedida)? */
export function looksLikeRobotWall(html: string): boolean {
  const titles = innerOf(html, "title").map((t) => plain(visibleText(t))).join(" ");
  return ROBOT_WALL.test(titles) || (html.length < 20_000 && ROBOT_WALL.test(plain(html)));
}

/**
 * ¿La página, aunque responda bien, dice que no existe? Se miran solo el <title>, los <h1> y los <h2>, y solo
 * si son cortos. Tiene que ser una forma de error completa: empezar con 404 o 410, o ser una frase como
 * "página no encontrada".
 */
export function looksLikeNotFound(html: string): boolean {
  const heads = [...innerOf(html, "title"), ...innerOf(html, "h1"), ...innerOf(html, "h2")]
    .map((t) => plain(visibleText(t)).replace(/^[^a-z0-9]+/, "").trim())
    .filter((t) => t.length > 0 && t.length <= NOT_FOUND_MAX_LENGTH);
  return heads.some((t) => NOT_FOUND_CODE.test(t) || NOT_FOUND_PHRASE.test(t));
}

/** ¿Es una página de dominio en venta o estacionado? */
export function looksParked(html: string): boolean {
  return PARKED.test(plain(visibleText(html)).slice(0, 6000)) || PARKED.test(plain(innerOf(html, "title").join(" ")));
}

/** ¿Los datos de producto dicen que está agotado? */
export function isOutOfStock(html: string): boolean {
  let out = false;
  let inStock = false;
  const read = (value: unknown) => {
    if (typeof value !== "string") return;
    if (/(?:OutOfStock|SoldOut|Discontinued)\s*$/i.test(value) || /^out[ _]?of[ _]?stock$/i.test(value.trim())) out = true;
    if (/(?:InStock|LimitedAvailability|OnlineOnly|PreOrder)\s*$/i.test(value) || /^in[ _]?stock$/i.test(value.trim())) inStock = true;
  };
  for (const block of structuredData(html)) walk(block, (node) => read(node.availability));
  for (const tag of tags(html, "meta")) {
    if (/availability$/i.test(attribute(tag, "property")) || /availability$/i.test(attribute(tag, "itemprop"))) read(attribute(tag, "content"));
  }
  for (const tag of tags(html, "link")) if (/^availability$/i.test(attribute(tag, "itemprop"))) read(attribute(tag, "href"));
  // Si hay variantes con stock, la página no está agotada.
  return out && !inStock;
}

export type LiveStatus = "alive" | "dead" | "unknown";

/** Lo que el servidor obtuvo al abrir una página (después de seguir las redirecciones permitidas). */
export type PageOutcome =
  | { kind: "page"; status: number; contentType: string; html: string; truncated: boolean; finalUrl: string }
  | { kind: "blocked" } // dirección que no se puede abrir (IP privada, puerto raro, protocolo raro)
  | { kind: "no_dns" }
  | { kind: "refused" }
  | { kind: "timeout" }
  | { kind: "too_many_redirects" }
  | { kind: "error" };

export interface PageVerdict {
  live: LiveStatus;
  /** Motivo corto y fijo, para los tests y el log. Nunca lleva la dirección ni contenido. */
  reason: string;
  outOfStock: boolean;
  /** El HTML sirve para buscar indicios de Uruguay. */
  readable: boolean;
}

/**
 * ¿La página está activa? "dead": no existe, el dominio no resuelve, rechaza la conexión, falla el servidor,
 * salta a otro dominio o está en venta. "unknown": no se pudo saber (protección contra robots, sin permiso,
 * tardó demasiado, no es HTML): no es lo mismo que caída y no dice nada sobre si es de Uruguay.
 */
export function judgePage(outcome: PageOutcome, originalHost: string): PageVerdict {
  const verdict = (live: LiveStatus, reason: string, extra: Partial<PageVerdict> = {}): PageVerdict => ({ live, reason, outOfStock: false, readable: false, ...extra });
  if (outcome.kind === "no_dns") return verdict("dead", "el dominio no resuelve");
  if (outcome.kind === "refused") return verdict("dead", "conexión rechazada");
  if (outcome.kind === "timeout") return verdict("unknown", "tiempo agotado");
  if (outcome.kind === "blocked") return verdict("unknown", "dirección no permitida");
  if (outcome.kind === "too_many_redirects") return verdict("unknown", "demasiadas redirecciones");
  if (outcome.kind === "error") return verdict("unknown", "error de red");

  let finalHost = "";
  try {
    finalHost = new URL(outcome.finalUrl).hostname;
  } catch {
    return verdict("unknown", "error de red");
  }
  if (isParkingHost(finalHost)) return verdict("dead", "dominio en venta");
  if (!sameSite(finalHost, originalHost)) return verdict("dead", "redirige a otro dominio");
  const { status, html } = outcome;
  const isHtml = /^(?:text\/html|application\/xhtml\+xml)\b/i.test(outcome.contentType);
  // Una pantalla contra robots puede venir con 403, 429 o 503: no dice nada de la tienda.
  if (status === 403 || status === 429 || status === 401 || (isHtml && looksLikeRobotWall(html))) return verdict("unknown", "protección contra robots");
  if (status === 404 || status === 410) return verdict("dead", `HTTP ${status}`);
  if (status >= 500) return verdict("dead", `HTTP ${status}`);
  if (status < 200 || status >= 300) return verdict("unknown", `HTTP ${status}`);
  if (!isHtml) return verdict("unknown", "no es HTML");
  if (looksParked(html)) return verdict("dead", "dominio en venta");
  if (looksLikeNotFound(html)) return verdict("dead", "dice que no existe");
  return verdict("alive", outcome.truncated ? "activa (página larga, se leyó el comienzo)" : "activa", { outOfStock: isOutOfStock(html), readable: true });
}

// ------------------------------------------------------------------
// Mercado Libre Uruguay: nunca se abre la página, se consulta su API
// ------------------------------------------------------------------

/** Qué consultar en la API de Mercado Libre para una dirección de mercadolibre.com.uy, o null si no se sabe. */
export function mercadoLibreLookup(url: string): { kind: "item" | "product"; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (siteDomain(parsed.hostname.toLowerCase().replace(/^www\./, "")) !== "mercadolibre.com.uy") return null;
  const item = /^\/MLU-?(\d{6,14})(?:[-_/]|$)/i.exec(parsed.pathname);
  if (item && parsed.hostname.toLowerCase().startsWith("articulo.")) return { kind: "item", id: `MLU${item[1]}` };
  const product = /\/p\/(MLU\d{4,14})(?:[/?#]|$)/i.exec(parsed.pathname);
  return product ? { kind: "product", id: product[1].toUpperCase() } : null;
}

export function isMercadoLibreUruguay(host: string): boolean {
  return siteDomain(host.toLowerCase().replace(/^www\./, "")) === "mercadolibre.com.uy";
}

// ------------------------------------------------------------------
// Respuesta para la pantalla
// ------------------------------------------------------------------

export interface SiteVerdict {
  live: LiveStatus;
  outOfStock: boolean;
  /** null = no se pudo mirar la página, así que no se sabe (no es "no es de Uruguay"). */
  uruguay: UruguayVerdict | null;
  signals: string[];
}

export const UNKNOWN_VERDICT: SiteVerdict = { live: "unknown", outOfStock: false, uruguay: null, signals: [] };

const KNOWN_SIGNAL = /^[\p{L}\p{N} +.,\-]{2,60}$/u;

/** Valida en la pantalla lo que devolvió /api/verify-sites: un veredicto por sitio pedido, en el mismo orden. */
export function parseVerifyResponse(data: unknown, expected: number): SiteVerdict[] | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok !== true || !Array.isArray(d.results) || d.results.length !== expected) return null;
  return d.results.map((entry) => {
    if (!entry || typeof entry !== "object") return UNKNOWN_VERDICT;
    const e = entry as Record<string, unknown>;
    const live: LiveStatus = e.live === "alive" || e.live === "dead" ? e.live : "unknown";
    const uruguay = e.uruguay === "confirmed" || e.uruguay === "probable" || e.uruguay === "none" ? e.uruguay : null;
    // Texto plano, corto y de un alfabeto acotado: lo que no lo cumple no se muestra.
    const signals = Array.isArray(e.signals)
      ? e.signals.filter((s): s is string => typeof s === "string" && KNOWN_SIGNAL.test(s)).slice(0, VERIFY_LIMITS.maxSignals)
      : [];
    return { live, outOfStock: live === "alive" && e.outOfStock === true, uruguay: live === "unknown" ? null : uruguay, signals: live === "unknown" ? [] : signals };
  });
}

/** "Uruguay: dirección en Montevideo, teléfono +598". Vacío si no hay indicios. */
export function signalsPhrase(verdict: SiteVerdict): string {
  return verdict.signals.length > 0 && (verdict.uruguay === "confirmed" || verdict.uruguay === "probable") ? `Uruguay: ${verdict.signals.join(", ")}` : "";
}
