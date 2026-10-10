import { createHmac, timingSafeEqual } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import type { RequestHandler, Response } from "express";
import { isForeignSite } from "../src/lib/web/sellers.js";
import {
  UNKNOWN_VERDICT,
  VERIFY_LIMITS,
  VERIFY_MESSAGES,
  VERIFY_USER_AGENT,
  findUruguaySignals,
  isBlockedIp,
  isMercadoLibreUruguay,
  judgePage,
  mercadoLibreLookup,
  openableUrl,
  sameSite,
  type PageOutcome,
  type SiteVerdict,
  type UruguaySignals,
  type VerifyErrorCode,
} from "../src/lib/web/verify.js";

/**
 * /api/verify-sites: abre las páginas de los resultados para ver si la tienda es de Uruguay y si la página
 * sigue activa. Abrir direcciones de terceros desde el servidor es delicado, así que:
 *  - no recibe direcciones: recibe permisos firmados que el propio servidor entregó con cada resultado;
 *  - solo http/https en los puertos 80 y 443, a nombres de dominio públicos;
 *  - resuelve el DNS, descarta IPs privadas, locales, de enlace local y de metadatos, y se conecta a la IP
 *    que ya revisó (así un DNS que cambia de respuesta no lo lleva a otra parte);
 *  - cada redirección pasa por lo mismo, y son como mucho 3;
 *  - 8 s y 400 KB por página, solo HTML, sin cookies ni encabezados del usuario;
 *  - el contenido es un dato: no se ejecuta, no se guarda y no se registra. Tampoco las direcciones.
 * La red se inyecta, así los tests no abren nada.
 */

// ------------------------------------------------------------------
// Permisos firmados
// ------------------------------------------------------------------

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export interface VerifySigner {
  /** Permiso para verificar esa dirección, válido 30 minutos y solo para ese usuario. */
  sign(url: string, userId: string, now?: number): string;
  /** La dirección que autoriza el permiso, o null si no es válido, venció o es de otro usuario. */
  open(token: unknown, userId: string, now?: number): string | null;
}

/**
 * Firma con HMAC-SHA256. El permiso lleva la dirección y el vencimiento; el usuario entra en la firma pero
 * no viaja en el permiso. Sin la clave no se puede fabricar uno, así que el endpoint no sirve de proxy.
 */
export function createVerifySigner(secret: string): VerifySigner {
  const mac = (payload: string, userId: string) => createHmac("sha256", secret).update(`${payload}\n${userId}`).digest();
  return {
    sign(url, userId, now = Date.now()) {
      const payload = b64url(JSON.stringify([url, now + VERIFY_LIMITS.tokenTtlMs]));
      return `${payload}.${b64url(mac(payload, userId))}`;
    },
    open(token, userId, now = Date.now()) {
      if (typeof token !== "string" || token.length > VERIFY_LIMITS.tokenMaxLength) return null;
      const [payload, signature, extra] = token.split(".");
      if (!payload || !signature || extra !== undefined) return null;
      const expected = mac(payload, userId);
      const given = Buffer.from(signature, "base64url");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      try {
        const [url, expires] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as [unknown, unknown];
        if (typeof url !== "string" || typeof expires !== "number" || expires <= now) return null;
        return url;
      } catch {
        return null;
      }
    },
  };
}

// ------------------------------------------------------------------
// Red
// ------------------------------------------------------------------

export interface PageRequest {
  url: URL;
  /** IP ya resuelta y revisada: la conexión va ahí, no a lo que diga el DNS en ese momento. */
  ip: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface RawResponse {
  status: number;
  contentType: string;
  location: string | null;
  /** Cuerpo, solo si es HTML y no es una redirección; cortado en maxBytes. */
  body: Buffer;
  truncated: boolean;
}

/** Lo único que toca la red. `resolve` y `request` lanzan un error con `code` (ENOTFOUND, ECONNREFUSED, TIMEOUT…). */
export interface NetDeps {
  resolve(host: string): Promise<string[]>;
  request(target: PageRequest): Promise<RawResponse>;
}

const IS_HTML = /^(?:text\/html|application\/xhtml\+xml)\b/i;

/** Pedido real con Node: conexión a la IP indicada, lectura cortada en el tope y sin nada del usuario. */
export function nodeRequest({ url, ip, timeoutMs, maxBytes }: PageRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const family = ip.includes(":") ? 6 : 4;
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        // El nombre ya se resolvió y se revisó: acá se devuelve esa misma IP, pase lo que pase con el DNS.
        lookup: (_host, options, callback) => {
          const cb = callback as (err: Error | null, address: unknown, family?: number) => void;
          if (typeof options === "object" && options.all) cb(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        },
        headers: {
          "User-Agent": VERIFY_USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9",
          "Accept-Language": "es-UY,es;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const done = (body: Buffer, truncated: boolean) =>
          finish(() => {
            req.destroy();
            resolve({ status, contentType, location, body, truncated });
          });
        // Redirecciones y lo que no es HTML: no se lee el cuerpo.
        if ((status >= 300 && status < 400) || !IS_HTML.test(contentType)) return done(Buffer.alloc(0), false);

        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: Readable = res;
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          const room = maxBytes - size;
          chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          size += Math.min(chunk.length, room);
          // Al llegar al tope se deja de leer: lo que falta no se descarga.
          if (size >= maxBytes) done(Buffer.concat(chunks), true);
        });
        stream.on("end", () => done(Buffer.concat(chunks), false));
        // Un cuerpo comprimido que se corta o viene roto: sirve lo que se alcanzó a leer.
        stream.on("error", () => done(Buffer.concat(chunks), true));
      }
    );
    const timer = setTimeout(() => finish(() => {
      req.destroy();
      reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    }), timeoutMs);
    req.on("error", (err) => finish(() => reject(err)));
    req.end();
  });
}

export const nodeNet: NetDeps = {
  async resolve(host) {
    const found = await dns.promises.lookup(host, { all: true, verbatim: true });
    return found.map((entry) => entry.address);
  },
  request: nodeRequest,
};

/**
 * Abre una página siguiendo como mucho 3 redirecciones dentro del mismo sitio. Cada salto se valida entero:
 * protocolo, puerto, nombre de dominio, DNS e IP. Una redirección a otro sitio no se sigue: se informa adónde iba.
 */
export async function openPage(start: string, deps: NetDeps, options: { timeoutMs?: number; maxBytes?: number; now?: () => number } = {}): Promise<PageOutcome> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? VERIFY_LIMITS.pageTimeoutMs);
  const maxBytes = options.maxBytes ?? VERIFY_LIMITS.maxBodyBytes;
  const first = openableUrl(start);
  if (!first) return { kind: "blocked" };
  let url = first;
  for (let hop = 0; ; hop++) {
    // El DNS también entra en el límite de tiempo: corre contra lo que queda hasta el vencimiento.
    const left = deadline - now();
    if (left <= 0) return { kind: "timeout" };
    let ips: string[];
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        deps.resolve(url.hostname),
        new Promise<null>((resolve) => {
          dnsTimer = setTimeout(() => resolve(null), left);
        }),
      ]);
      if (answer === null) return { kind: "timeout" };
      ips = answer;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      return code === "ENOTFOUND" || code === "ENODATA" ? { kind: "no_dns" } : { kind: "error" };
    } finally {
      clearTimeout(dnsTimer);
    }
    if (ips.length === 0) return { kind: "no_dns" };
    // Con una sola IP privada entre las respuestas alcanza para no abrir nada.
    if (ips.some(isBlockedIp)) return { kind: "blocked" };
    const remaining = deadline - now();
    if (remaining <= 0) return { kind: "timeout" };

    let res: RawResponse;
    try {
      res = await deps.request({ url, ip: ips[0], timeoutMs: remaining, maxBytes });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "TIMEOUT" || code === "ETIMEDOUT") return { kind: "timeout" };
      if (code === "ECONNREFUSED") return { kind: "refused" };
      if (code === "ENOTFOUND") return { kind: "no_dns" };
      return { kind: "error" };
    }

    if (res.status >= 300 && res.status < 400 && res.location) {
      let target: URL | null = null;
      try {
        target = openableUrl(new URL(res.location, url).href);
      } catch {
        target = null;
      }
      if (!target) return { kind: "blocked" };
      // A otro sitio no se va: alcanza con saber que la página mandaba para afuera.
      if (!sameSite(target.hostname, first.hostname)) {
        return { kind: "page", status: res.status, contentType: "", html: "", truncated: false, finalUrl: target.href };
      }
      if (hop >= VERIFY_LIMITS.maxRedirects) return { kind: "too_many_redirects" };
      url = target;
      continue;
    }
    return {
      kind: "page",
      status: res.status,
      contentType: res.contentType,
      html: res.body.subarray(0, maxBytes).toString("utf8"),
      truncated: res.truncated,
      finalUrl: url.href,
    };
  }
}

// ------------------------------------------------------------------
// Mercado Libre Uruguay: por su API, nunca abriendo la página
// ------------------------------------------------------------------

export type MercadoLibreChecker = (url: string) => Promise<SiteVerdict>;

type ApiFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * Pregunta a la API de Mercado Libre (gratis, con el mismo acceso del Radar) si la publicación o el producto
 * siguen activos. Si la dirección no trae un id reconocible, o la API no contesta algo claro, queda "sin verificar".
 */
export function createMercadoLibreChecker(options: { token: () => Promise<string | null>; fetch: ApiFetch; timeoutMs?: number }): MercadoLibreChecker {
  return async (url) => {
    const lookup = mercadoLibreLookup(url);
    if (!lookup) return UNKNOWN_VERDICT;
    try {
      const token = await options.token();
      if (!token) return UNKNOWN_VERDICT;
      const path = lookup.kind === "item" ? `/items/${lookup.id}?attributes=id,status` : `/products/${lookup.id}`;
      const res = await options.fetch(`https://api.mercadolibre.com${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
      });
      if (res.status === 404) return { live: "dead", outOfStock: false, uruguay: null, signals: [] };
      if (res.status !== 200) return UNKNOWN_VERDICT;
      const status = String(((await res.json().catch(() => null)) as { status?: unknown } | null)?.status ?? "");
      if (status === "active") return { live: "alive", outOfStock: false, uruguay: null, signals: [] };
      // Pausada: la publicación existe pero no se puede comprar ahora (casi siempre, sin stock).
      if (status === "paused") return { live: "alive", outOfStock: true, uruguay: null, signals: [] };
      if (status === "closed" || status === "inactive") return { live: "dead", outOfStock: false, uruguay: null, signals: [] };
      return UNKNOWN_VERDICT;
    } catch {
      return UNKNOWN_VERDICT;
    }
  };
}

// ------------------------------------------------------------------
// Verificación de un lote
// ------------------------------------------------------------------

/** Corre las tareas de a `limit` y devuelve los resultados en el orden original. */
async function pool<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Verifica hasta 8 direcciones (null = permiso inválido: no se abre nada). Por sitio se hacen como mucho 2
 * pedidos: la dirección del resultado y, solo si ahí no hay indicios de Uruguay, la página de inicio.
 */
export async function verifySites(urls: (string | null)[], deps: { net: NetDeps; mercadoLibre?: MercadoLibreChecker | null }): Promise<SiteVerdict[]> {
  const requestsBySite = new Map<string, number>();
  const homes = new Map<string, Promise<UruguaySignals | null>>();
  const spend = (host: string) => {
    const key = host.toLowerCase().replace(/^www\./, "");
    const used = requestsBySite.get(key) ?? 0;
    if (used >= VERIFY_LIMITS.maxRequestsPerSite) return false;
    requestsBySite.set(key, used + 1);
    return true;
  };

  const one = async (raw: string | null): Promise<SiteVerdict> => {
    const url = raw ? openableUrl(raw) : null;
    if (!url) return UNKNOWN_VERDICT;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    // Los sitios de la lista del exterior no se verifican (ni se muestran).
    if (isForeignSite(host)) return UNKNOWN_VERDICT;
    // Mercado Libre bloquea robots: su página no se abre nunca.
    if (isMercadoLibreUruguay(host)) return deps.mercadoLibre ? deps.mercadoLibre(url.href) : UNKNOWN_VERDICT;
    if (!spend(host)) return UNKNOWN_VERDICT;

    const outcome = await openPage(url.href, deps.net);
    const page = judgePage(outcome, url.hostname);
    if (!page.readable || outcome.kind !== "page") return { live: page.live, outOfStock: false, uruguay: null, signals: [] };

    let found = findUruguaySignals(outcome.html, outcome.finalUrl);
    const isHome = url.pathname === "/" && !url.search;
    if (found.verdict === "none" && !isHome) {
      let home = homes.get(host);
      if (!home && spend(host)) {
        home = openPage(`${url.protocol}//${url.hostname}/`, deps.net).then((o) =>
          o.kind === "page" && judgePage(o, url.hostname).readable ? findUruguaySignals(o.html, o.finalUrl) : null
        );
        homes.set(host, home);
      }
      found = (await home) ?? found;
    }
    return { live: "alive", outOfStock: page.outOfStock, uruguay: found.verdict, signals: found.signals };
  };

  return pool(urls, VERIFY_LIMITS.concurrency, (url) => one(url).catch(() => UNKNOWN_VERDICT));
}

// ------------------------------------------------------------------
// Ruta
// ------------------------------------------------------------------

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, code, message, error: message });
}

const ERROR_RESPONSES: Record<VerifyErrorCode, { status: number; message: string }> = {
  VERIFY_NOT_CONFIGURED: { status: 503, message: VERIFY_MESSAGES.notConfigured },
  VERIFY_INVALID_TOKEN: { status: 400, message: VERIFY_MESSAGES.invalid },
};

/**
 * Manejadores de la ruta, en orden. El control de acceso va antes (lo pone server/app.ts). El límite de uso
 * va después de mirar los permisos: un pedido sin ningún permiso válido no abre nada ni gasta un uso.
 * `signer` devuelve null si falta VERIFY_SECRET.
 */
export function createVerifySitesRoute(options: {
  signer: () => VerifySigner | null;
  limiter: RequestHandler;
  userId: (res: Response) => string;
  net?: NetDeps;
  mercadoLibre?: MercadoLibreChecker | null;
  now?: () => number;
}): RequestHandler[] {
  const failWith = (res: Response, code: VerifyErrorCode) => fail(res, ERROR_RESPONSES[code].status, code, ERROR_RESPONSES[code].message);

  const prepare: RequestHandler = (req, res, next) => {
    const signer = options.signer();
    if (!signer) return failWith(res, "VERIFY_NOT_CONFIGURED");
    const tokens: unknown = req.body?.tokens;
    if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > VERIFY_LIMITS.maxSites) return failWith(res, "VERIFY_INVALID_TOKEN");
    const userId = options.userId(res);
    const now = options.now?.() ?? Date.now();
    const urls = tokens.map((token) => signer.open(token, userId, now));
    if (urls.every((url) => url === null)) return failWith(res, "VERIFY_INVALID_TOKEN");
    res.locals.verifyUrls = urls;
    return next();
  };

  const run: RequestHandler = async (_req, res) => {
    const urls = res.locals.verifyUrls as (string | null)[];
    try {
      const results = await verifySites(urls, { net: options.net ?? nodeNet, mercadoLibre: options.mercadoLibre });
      const count = (live: string) => results.filter((r) => r.live === live).length;
      // Solo cantidades: ni las direcciones ni el contenido de las páginas quedan en el log.
      console.info(`[api/verify-sites] sitios: ${results.length}, activas: ${count("alive")}, caídas: ${count("dead")}, sin verificar: ${count("unknown")}`);
      return res.json({ ok: true, results });
    } catch {
      console.error("[api/verify-sites] la verificación falló: error inesperado");
      return res.json({ ok: true, results: urls.map(() => UNKNOWN_VERDICT) });
    }
  };

  return [prepare, options.limiter, run];
}
