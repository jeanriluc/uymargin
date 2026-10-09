// Tests de "En la web (Uruguay)": consulta, clasificación de dominios, cruce con las fuentes reales,
// resolución de enlaces con defensa contra SSRF, límite de uso, memoria y errores. La IA y la red son
// siempre simuladas: no hay ninguna llamada real, y no se importa server/app.ts (que lee .env) ni Supabase.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES } from "../server/rateLimit";
import {
  GOOGLE_REDIRECT_HOSTS,
  REDIRECT_LIMITS,
  WEB_CACHE,
  WEB_SEARCH_SYSTEM_PROMPT,
  WebSearchUnavailableError,
  createLinkResolver,
  createWebCache,
  createWebSellersRoute,
  isGoogleRedirect,
  isSearchUnavailable,
  resolveSources,
  type FetchLike,
  type WebSearchAnswer,
  type WebSearchModel,
} from "../server/webSellers";
import {
  WEB_LIMITS,
  WEB_MESSAGES,
  buildWebSellers,
  classifyUruguay,
  cleanWebQuery,
  googleSearchUrl,
  googleShoppingUrl,
  isInternationalStore,
  isMainSeller,
  isUruguayDomain,
  looksLikeImitation,
  normalizeHost,
  parseSellerClaims,
  parseWebSellersResponse,
  safeHttpsUrl,
  siteDomain,
  webQueryKey,
  type ResolvedSource,
} from "../src/lib/web/sellers";

let passed = 0;
let total = 0;
function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";
const src = (host: string, url: string | null = `https://${host}/producto`, title = host): ResolvedSource => ({ host, url, title });
const claim = (site: string, extra: Record<string, unknown> = {}) => ({ site, title: `Termo en ${site}`, why: "Vende el termo de 1 litro.", confidence: "alta", uruguay: "probable", ...extra });
const answerText = (claims: unknown[]) => JSON.stringify({ results: claims });

async function main() {
  console.log("--- Consulta ---");
  assert(cleanWebQuery("  Termo   Stanley\n1 litro ") === "Termo Stanley 1 litro", "Limpia espacios y saltos de línea");
  assert(cleanWebQuery("a") === null && cleanWebQuery("") === null && cleanWebQuery("   ") === null, "Menos de 2 caracteres no sirve");
  assert(cleanWebQuery("ab") === "ab" && cleanWebQuery("x".repeat(120))?.length === 120 && cleanWebQuery("x".repeat(121)) === null, "Entre 2 y 120 caracteres; 121 ya no");
  assert(cleanWebQuery(123) === null && cleanWebQuery(null) === null && cleanWebQuery(["termo"]) === null && cleanWebQuery({ q: "termo" }) === null, "Lo que no es texto no sirve");
  assert(cleanWebQuery("termo\u0000\u0007 stanley") === "termo stanley", "Saca caracteres de control");
  assert(webQueryKey("  TERMO  Stánley ") === webQueryKey("termo stanley"), "La clave de memoria ignora mayúsculas, tildes y espacios");

  console.log("--- Dominios ---");
  assert(normalizeHost("WWW.Ejemplo.com.UY") === "ejemplo.com.uy" && normalizeHost("tienda.ejemplo.uy.") === "tienda.ejemplo.uy", "Normaliza: minúsculas, sin www. ni punto final");
  for (const bad of ["localhost", "192.168.1.10", "10.0.0.1", "[::1]", "ejemplo", "ejemplo..uy", "-malo.uy", "con espacio.uy", "https://ejemplo.uy", "ejemplo.uy/ruta", "", "a.b"]) {
    assert(normalizeHost(bad) === null, `«${bad}» no es un dominio válido`);
  }
  assert(normalizeHost(undefined) === null && normalizeHost(42) === null, "Lo que no es texto no es un dominio");
  assert(siteDomain("tienda.ejemplo.com.uy") === "ejemplo.com.uy" && siteDomain("articulo.mercadolibre.com.uy") === "mercadolibre.com.uy", "Dominio principal con .com.uy");
  assert(siteDomain("shop.ejemplo.uy") === "ejemplo.uy" && siteDomain("ejemplo.uy") === "ejemplo.uy" && siteDomain("es.aliexpress.com") === "aliexpress.com" && siteDomain("a.b.tienda.co.uk") === "tienda.co.uk", "Dominio principal en otros casos");

  for (const host of ["ejemplo.uy", "ejemplo.com.uy", "tienda.ejemplo.com.uy", "mercadolibre.com.uy", "articulo.mercadolibre.com.uy", "ferreteria.org.uy"]) {
    const c = classifyUruguay(host, "no_confirmado");
    assert(isUruguayDomain(host) && c.uruguay === "confirmado" && !c.international, `${host}: confirmado por el dominio, diga lo que diga la IA`);
  }
  for (const fake of ["mercadolibre.com.uy.evil.com", "ejemplo.uy.com", "uy.ejemplo.com", "tienda-uy.com", "ejemplouy.com", "ejemplo.uyx", "ejemplo.com.uy.tk"]) {
    const c = classifyUruguay(fake, "confirmado");
    assert(!isUruguayDomain(fake) && c.uruguay !== "confirmado", `Dominio falso ${fake}: NO queda confirmado aunque la IA diga que sí`);
  }
  for (const host of ["aliexpress.com", "es.aliexpress.com", "temu.com", "www.temu.com".replace("www.", ""), "amazon.com", "amazon.es", "amazon.com.mx", "amazon.co.uk", "shein.com", "us.shein.com", "ebay.com", "alibaba.com", "spanish.alibaba.com", "dhgate.com", "walmart.com", "etsy.com"]) {
    const c = classifyUruguay(host, "confirmado");
    assert(isInternationalStore(host) && c.international && c.uruguay === "no_confirmado", `${host}: internacional, sin confirmar aunque la IA diga que envía`);
  }
  for (const host of ["amazon.evil.com", "aliexpress.com.tienda-falsa.net", "miamazon.com", "amazonas.com", "temu.tiendas.com", "ebayuruguay.com"]) {
    assert(!isInternationalStore(host), `${host}: no se toma por la tienda global (la marca tiene que ser el dominio principal)`);
  }
  for (const fake of ["mercadolibre.com.uy.evil.com", "ejemplo.uy.com", "tienda.com.ar.ofertas.net"]) {
    assert(looksLikeImitation(fake) && classifyUruguay(fake, "confirmado").uruguay === "no_confirmado" && !classifyUruguay(fake, "probable").international, `${fake}: lleva adentro la terminación de otro dominio, queda «no confirmado»`);
  }
  assert(!looksLikeImitation("tienda.ejemplo.com.uy") && !looksLikeImitation("tiendaejemplo.com") && !looksLikeImitation("uy.ejemplo.com") && !looksLikeImitation("comercio.net"), "Un dominio común no se toma por imitación");
  assert(classifyUruguay("ejemplo.com.uy", "confirmado", false).uruguay === "probable", "Un .uy que no se pudo verificar con el enlace real queda «probable», no «confirmado»");
  assert(!isInternationalStore("amazon.com.uy") && classifyUruguay("amazon.com.uy", "").uruguay === "confirmado", "Un .uy manda aunque lleve el nombre de una tienda global");
  assert(classifyUruguay("tiendaejemplo.com", "confirmado").uruguay === "probable" && classifyUruguay("tiendaejemplo.com", "probable").uruguay === "probable", "Sitio que no es .uy: como mucho «probable», aunque la fuente diga confirmado");
  assert(
    classifyUruguay("tiendaejemplo.com", "no_confirmado").uruguay === "no_confirmado" && classifyUruguay("tiendaejemplo.com", undefined).uruguay === "no_confirmado" && classifyUruguay("tiendaejemplo.com", "seguro que sí!!").uruguay === "no_confirmado" && classifyUruguay("tiendaejemplo.com", 1).uruguay === "no_confirmado",
    "Sin dato, o con un dato raro: «no confirmado»"
  );

  console.log("--- Enlaces seguros ---");
  assert(safeHttpsUrl("https://ejemplo.com.uy/termo?id=1") === "https://ejemplo.com.uy/termo?id=1" && safeHttpsUrl("https://ejemplo.uy:443/a") === "https://ejemplo.uy/a", "Un https a un dominio público pasa");
  for (const bad of [
    "http://ejemplo.com.uy/termo",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://ejemplo.uy/a",
    "//ejemplo.uy/a",
    "ejemplo.uy/a",
    "https://localhost/a",
    "https://localhost.localdomain/a",
    "https://127.0.0.1/a",
    "https://10.0.0.5/a",
    "https://192.168.0.1/a",
    "https://172.16.0.1/a",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a",
    "https://[fd00::1]/a",
    "https://0x7f000001/a",
    "https://2130706433/a",
    "https://intranet/a",
    "https://servidor.local/a",
    "https://api.internal/a",
    "https://caja.lan/a",
    "https://usuario:clave@ejemplo.uy/a",
    "https://ejemplo.uy@evil.com.local/a",
    "https://ejemplo.uy:8443/a",
    "https://",
    "",
    "https://" + "a".repeat(2100) + ".uy",
  ]) {
    assert(safeHttpsUrl(bad) === null, `Se rechaza ${bad.slice(0, 60)}`);
  }
  assert(safeHttpsUrl(undefined) === null && safeHttpsUrl(5) === null, "Lo que no es texto no es un enlace");

  console.log("--- Botones de Google ---");
  const g = new URL(googleSearchUrl("Termo Stanley 1 litro"));
  assert(g.origin + g.pathname === "https://www.google.com/search" && g.searchParams.get("q") === "Termo Stanley 1 litro Uruguay" && g.searchParams.get("gl") === "uy" && g.searchParams.get("hl") === "es-419" && !g.searchParams.has("tbm"), "Google Uruguay: nombre + Uruguay, gl=uy, hl=es-419");
  const shop = new URL(googleShoppingUrl("Termo Stanley 1 litro"));
  assert(shop.searchParams.get("tbm") === "shop" && shop.searchParams.get("q") === "Termo Stanley 1 litro Uruguay" && shop.searchParams.get("gl") === "uy", "Google Shopping: lo mismo con tbm=shop");
  const tricky = 'Mate & bombilla 50% "acero" #1 ñandú +2?';
  assert(new URL(googleSearchUrl(tricky)).searchParams.get("q") === `${tricky} Uruguay` && !/[ "#]/.test(googleSearchUrl(tricky).split("?")[1]) && (googleSearchUrl(tricky).match(/&/g) ?? []).length === 2, "Codifica bien &, %, comillas, #, ñ, + y ?");
  assert(new URL(googleSearchUrl("termo stanley uruguay")).searchParams.get("q") === "termo stanley uruguay", "Si el nombre ya dice Uruguay, no lo repite");
  assert(googleSearchUrl("a&gl=us&q=otra").includes("q=a%26gl%3Dus%26q%3Dotra") && new URL(googleSearchUrl("a&gl=us&q=otra")).searchParams.getAll("gl").join() === "uy", "Un nombre con &gl= no puede cambiar los parámetros");

  console.log("--- Respuesta de la IA ---");
  const parsed = parseSellerClaims(answerText([claim("ejemplo.com.uy"), claim("https://www.Otra.uy/producto/1?x=2"), claim("no es dominio"), { title: "sin sitio" }, "texto", null, claim("tercera.uy", { confidence: "altísima" })]));
  assert(parsed !== null && parsed.map((c) => c.site).join() === "ejemplo.com.uy,otra.uy,tercera.uy", "Lee la lista; el sitio queda como dominio aunque venga con https:// y ruta; descarta entradas sin dominio válido");
  assert(parsed !== null && parsed[2].confidence === "baja", "Una confianza desconocida queda como baja");
  assert(parseSellerClaims("```json\n" + answerText([claim("ejemplo.uy")]) + "\n```")?.length === 1 && parseSellerClaims(`Acá va: ${answerText([claim("ejemplo.uy")])} ¡Listo!`)?.length === 1, "Acepta el JSON con bloque ``` o con texto alrededor");
  assert(parseSellerClaims(JSON.stringify([claim("ejemplo.uy")]))?.length === 1, "Acepta también una lista suelta");
  assert(parseSellerClaims(answerText([]))?.length === 0, "Una lista vacía es una respuesta válida");
  for (const [label, text] of [["texto vacío", ""], ["texto sin JSON", "No encontré nada."], ["JSON roto", '{"results": ['], ["results que no es lista", '{"results": "ninguno"}'], ["un número", "7"]] as const) {
    assert(parseSellerClaims(text) === null, `No se puede leer: ${label}`);
  }
  assert(parseSellerClaims(undefined) === null && parseSellerClaims({ results: [] }) === null, "Lo que no es texto no se puede leer");
  const priced = parseSellerClaims(answerText([claim("ejemplo.uy", { title: "Termo Stanley $ 2.490", why: "Lo vende a US$ 59,90 y en 3 cuotas de 830 pesos, con envío." })]));
  assert(priced !== null && !/\d/.test(priced[0].why.replace("3 cuotas", "")) && !/2\.490|\$/.test(priced[0].title) && /envío/.test(priced[0].why), `Los precios se sacan del título y de la frase («${priced?.[0].why}»)`);
  const longClaim = parseSellerClaims(answerText([claim("ejemplo.uy", { title: "t".repeat(500), why: "w".repeat(900) })]));
  assert(longClaim !== null && longClaim[0].title.length === 140 && longClaim[0].why.length === 220, "Título y frase se acotan");

  console.log("--- Cruce con las fuentes reales ---");
  const sources = [src("ejemplo.com.uy"), src("tienda.otra.uy"), src("es.aliexpress.com"), src("tiendaejemplo.com")];
  const built = buildWebSellers(parseSellerClaims(answerText([claim("ejemplo.com.uy"), claim("inventada.com.uy"), claim("aliexpress.com"), claim("tiendaejemplo.com", { uruguay: "no_confirmado" }), claim("otra.uy", { confidence: "media" })])), sources);
  assert(!built.some((s) => s.site === "inventada.com.uy") && built.length === 4, "Un sitio que la IA menciona y no está en las fuentes se descarta");
  assert(built.map((s) => s.site).join() === "ejemplo.com.uy,tienda.otra.uy,tiendaejemplo.com,es.aliexpress.com", "Orden: Uruguay confirmado primero, después el resto, y las internacionales al final");
  assert(built[1].site === "tienda.otra.uy" && built[1].url === "https://tienda.otra.uy/producto", "El sitio y el enlace salen de la fuente real, no de lo que escribió la IA");
  assert(built[3].international && built[3].uruguay === "no_confirmado" && !isMainSeller(built[3]) && isMainSeller(built[0]) && !isMainSeller(built[2]), "Lista principal: solo confirmados y probables; internacional y sin confirmar van aparte");
  assert(built.every((s) => Object.keys(s).sort().join() === "confidence,international,site,title,url,uruguay,why"), "Cada resultado tiene exactamente los campos del contrato (sin precios)");

  const dupes = buildWebSellers(parseSellerClaims(answerText([claim("ejemplo.com.uy"), claim("www.ejemplo.com.uy"), claim("tienda.ejemplo.com.uy")])), [src("ejemplo.com.uy", null), src("tienda.ejemplo.com.uy"), src("ejemplo.com.uy", "https://ejemplo.com.uy/otra")]);
  assert(dupes.length === 1 && dupes[0].url === "https://tienda.ejemplo.com.uy/producto", "Un solo resultado por dominio, y se prefiere la fuente que sí tiene enlace");
  const many = Array.from({ length: 25 }, (_, i) => `tienda${i}.com.uy`);
  const capped = buildWebSellers(parseSellerClaims(answerText(many.map((m) => claim(m)))), many.map((m) => src(m)));
  assert(capped.length === WEB_LIMITS.maxResults && WEB_LIMITS.maxResults === 10, "Como mucho 10 resultados");
  assert(buildWebSellers(parseSellerClaims(answerText([claim("ejemplo.uy")])), []).length === 0, "Sin fuentes no hay resultados, diga lo que diga la IA");
  assert(buildWebSellers([], sources).length === 0, "Si la IA dice que no encontró nada, no se listan las fuentes");
  const fallback = buildWebSellers(null, sources);
  assert(fallback.length === 4 && fallback.every((s) => s.confidence === "baja" && s.why === "") && fallback[0].uruguay === "confirmado" && fallback.find((s) => s.site === "tiendaejemplo.com")?.uruguay === "no_confirmado", "Respuesta ilegible: se listan las fuentes con confianza baja y clasificadas solo por dominio");
  const noLink = buildWebSellers(parseSellerClaims(answerText([claim("ejemplo.uy")])), [src("ejemplo.uy", null)]);
  assert(noLink.length === 1 && noLink[0].url === null && noLink[0].site === "ejemplo.uy" && noLink[0].uruguay === "probable", "Fuente sin enlace resuelto: queda el dominio, sin enlace y sin pasar de «probable»");

  console.log("--- Lo que valida la pantalla ---");
  const screen = parseWebSellersResponse({ ok: true, query: "termo", cached: true, searchQueries: ["termo uruguay", 5, ""], results: [{ site: "ejemplo.uy", url: "https://ejemplo.uy/a", title: "T", why: "W", confidence: "alta", uruguay: "confirmado", international: false, price: 100 }, { site: "mala.com", url: "javascript:alert(1)", title: "", why: "", confidence: "x", uruguay: "confirmado", international: false }, { site: "http://x", url: "https://x.uy" }, "basura"] });
  assert(screen !== null && screen.results.length === 2 && !("price" in screen.results[0]) && screen.cached && screen.searchQueries.join() === "termo uruguay", "Pasan solo los campos esperados y las entradas con dominio válido");
  assert(screen !== null && screen.results[1].url === null && screen.results[1].uruguay === "probable" && screen.results[1].confidence === "baja" && screen.results[1].title === "mala.com", "Un enlace javascript: se descarta y un «confirmado» en un dominio que no es .uy baja a «probable»");
  assert(parseWebSellersResponse({ ok: false }) === null && parseWebSellersResponse({ ok: true }) === null && parseWebSellersResponse(null) === null && parseWebSellersResponse("x") === null, "Una respuesta con otra forma no se muestra");

  console.log("--- Resolución de enlaces (red simulada) ---");
  const fetched: { url: string; method: string; redirect: string }[] = [];
  let routes: Record<string, { status: number; location?: string | null; throws?: boolean; hang?: boolean }> = {};
  const fakeFetch: FetchLike = async (url, init) => {
    fetched.push({ url, method: init.method, redirect: init.redirect });
    const key = `${init.method} ${url}`;
    const route = routes[key] ?? routes[url];
    if (!route || route.throws) throw new Error("fetch failed");
    if (route.hang) {
      // El temporizador de AbortSignal.timeout no mantiene vivo el proceso; un pedido real sí (por el socket).
      const alive = setInterval(() => {}, 50);
      await new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))).finally(() => clearInterval(alive));
    }
    return { status: route.status, headers: { get: (n: string) => (n.toLowerCase() === "location" ? route.location ?? null : null) }, body: null };
  };
  const resolveLink = createLinkResolver({ fetch: fakeFetch, timeoutMs: 150 });
  const resolve = async (uri: string) => {
    const outcome = await resolveLink(uri);
    return outcome.status === "ok" ? outcome.url : null;
  };
  const reset = () => { fetched.length = 0; };

  assert(GOOGLE_REDIRECT_HOSTS.join() === "vertexaisearch.cloud.google.com" && REDIRECT_LIMITS.maxHops <= 3 && REDIRECT_LIMITS.timeoutMs <= 5000, "Un solo host de redirección, pocos saltos y espera corta");
  assert(isGoogleRedirect(`${REDIRECT}abc`), "Reconoce el enlace de redirección de Google");
  for (const notGoogle of [`http://vertexaisearch.cloud.google.com/grounding-api-redirect/abc`, "https://vertexaisearch.cloud.google.com.evil.com/x", "https://evil.com/vertexaisearch.cloud.google.com", "https://user@vertexaisearch.cloud.google.com/x", "https://vertexaisearch.cloud.google.com:8443/x", "https://google.com/url?q=x", "no es un enlace"]) {
    assert(!isGoogleRedirect(notGoogle), `No es el host de redirección: ${notGoogle.slice(0, 55)}`);
  }

  routes = { [`${REDIRECT}a`]: { status: 302, location: "https://tienda.com.uy/termo" } };
  assert((await resolve(`${REDIRECT}a`)) === "https://tienda.com.uy/termo", "Resuelve un enlace de Google leyendo a dónde apunta");
  assert(fetched.length === 1 && fetched[0].method === "HEAD" && fetched[0].redirect === "manual" && fetched[0].url === `${REDIRECT}a`, "Un solo pedido, HEAD, sin seguir la redirección: el destino nunca se visita");

  reset();
  assert((await resolve("https://tienda.com.uy/termo")) === "https://tienda.com.uy/termo" && fetched.length === 0, "Un enlace que ya es directo se valida y no se pide nada");

  const targets: [string, string][] = [
    ["a un host interno", "https://169.254.169.254/latest/meta-data"],
    ["a localhost", "https://localhost/admin"],
    ["a una IP privada", "https://192.168.1.1/"],
    ["a un nombre interno", "https://base.internal/"],
    ["a http", "http://tienda.com.uy/termo"],
    ["a javascript:", "javascript:alert(1)"],
    ["a file:", "file:///etc/passwd"],
    ["con usuario y clave", "https://a:b@tienda.com.uy/"],
  ];
  for (const [label, target] of targets) {
    reset();
    routes = { [`${REDIRECT}x`]: { status: 302, location: target } };
    const out = await resolveLink(`${REDIRECT}x`);
    assert(out.status === "unsafe" && fetched.every((f) => f.url.startsWith(REDIRECT)), `Redirección ${label}: se descarta y no se le hace ningún pedido`);
  }
  for (const direct of ["https://127.0.0.1/x", "http://tienda.com.uy/x", "https://localhost/x", "gopher://tienda.uy/x"]) {
    reset();
    assert((await resolve(direct)) === null && fetched.length === 0, `Enlace directo inseguro ${direct}: se descarta sin pedir nada`);
  }

  reset();
  routes = { [`${REDIRECT}1`]: { status: 302, location: `${REDIRECT}2` }, [`${REDIRECT}2`]: { status: 301, location: "https://tienda.com.uy/final" } };
  assert((await resolve(`${REDIRECT}1`)) === "https://tienda.com.uy/final" && fetched.length === 2, "Dos saltos dentro de Google: se siguen");
  reset();
  routes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${REDIRECT}h${i}`, { status: 302, location: `${REDIRECT}h${i + 1}` }]));
  assert((await resolve(`${REDIRECT}h0`)) === null && fetched.length === REDIRECT_LIMITS.maxHops, `Demasiados saltos: se corta a los ${REDIRECT_LIMITS.maxHops} y se descarta`);
  reset();
  routes = { [`${REDIRECT}loop`]: { status: 302, location: `${REDIRECT}loop` } };
  assert((await resolve(`${REDIRECT}loop`)) === null && fetched.length === REDIRECT_LIMITS.maxHops, "Una redirección en círculo no cuelga el pedido");
  reset();
  routes = { [`${REDIRECT}rel`]: { status: 302, location: "/grounding-api-redirect/rel2" }, [`${REDIRECT}rel2`]: { status: 302, location: "https://tienda.uy/a" } };
  assert((await resolve(`${REDIRECT}rel`)) === "https://tienda.uy/a", "Una redirección relativa se resuelve contra el host de Google");

  routes = { [`${REDIRECT}ok200`]: { status: 200 }, [`${REDIRECT}noloc`]: { status: 302, location: null }, [`${REDIRECT}404`]: { status: 404 }, [`${REDIRECT}boom`]: { status: 0, throws: true }, [`${REDIRECT}slow`]: { status: 200, hang: true } };
  assert((await resolve(`${REDIRECT}ok200`)) === null && (await resolve(`${REDIRECT}noloc`)) === null && (await resolve(`${REDIRECT}404`)) === null, "Sin redirección (200, 404 o sin Location): no se resuelve");
  assert((await resolveLink(`${REDIRECT}boom`)).status === "failed" && (await resolveLink(`${REDIRECT}404`)).status === "failed", "Error de red: queda como «no se pudo resolver», distinto de «inseguro», y no rompe");
  const startedAt = Date.now();
  assert((await resolve(`${REDIRECT}slow`)) === null && Date.now() - startedAt < 2000, "Si Google no contesta, se corta por tiempo");
  reset();
  routes = { [`HEAD ${REDIRECT}m`]: { status: 405 }, [`GET ${REDIRECT}m`]: { status: 302, location: "https://tienda.uy/b" } };
  assert((await resolve(`${REDIRECT}m`)) === "https://tienda.uy/b" && fetched.map((f) => f.method).join() === "HEAD,GET", "Si HEAD no está permitido, prueba con GET (también sin seguir la redirección)");

  routes = { [`${REDIRECT}s1`]: { status: 302, location: "https://www.tienda.com.uy/termo" }, [`${REDIRECT}s2`]: { status: 302, location: "https://10.0.0.1/x" }, [`${REDIRECT}s3`]: { status: 0, throws: true } };
  const resolvedSources = await resolveSources([{ uri: `${REDIRECT}s1`, title: "Página cualquiera" }, { uri: `${REDIRECT}s2`, title: "insegura.com.uy" }, { uri: `${REDIRECT}s3`, title: "otra.com.uy" }, { uri: `${REDIRECT}s3`, title: "Título que no es dominio" }, { uri: `${REDIRECT}s3`, title: "x", domain: "tercera.uy" }], resolveLink);
  assert(resolvedSources.length === 3 && resolvedSources[0].host === "tienda.com.uy" && resolvedSources[0].url === "https://www.tienda.com.uy/termo", "Fuente resuelta: el dominio sale del enlace real, no del título");
  assert(!resolvedSources.some((x) => x.host === "insegura.com.uy"), "Fuente cuyo enlace apunta a un destino inseguro: se descarta entera, aunque su título parezca un dominio");
  assert(resolvedSources[1].host === "otra.com.uy" && resolvedSources[1].url === null && resolvedSources[2].host === "tercera.uy" && resolvedSources[2].url === null, "Fuente que no se pudo resolver: queda el dominio sin enlace; sin dominio, se descarta");
  reset();
  await resolveSources(Array.from({ length: 60 }, (_, i) => ({ uri: `${REDIRECT}n${i}`, title: "x" })), resolveLink);
  assert(fetched.length === WEB_LIMITS.maxSources, `Como mucho se resuelven ${WEB_LIMITS.maxSources} fuentes por búsqueda`);

  console.log("--- Herramienta no disponible ---");
  assert(isSearchUnavailable({ status: 403, message: "PERMISSION_DENIED" }), "403: la clave no puede usar la búsqueda");
  assert(isSearchUnavailable({ status: 429, message: "Quota exceeded for metric ... free_tier_requests, limit: 0" }) && isSearchUnavailable({ status: 429, message: "Please enable billing" }), "429 que habla del plan gratuito o de facturación");
  assert(isSearchUnavailable({ status: 400, message: "Google Search grounding is not supported for this API key. Enable billing." }) && isSearchUnavailable({ status: 400, message: "google_search tool is not available on the free tier" }), "400 que dice que la búsqueda no está disponible");
  assert(!isSearchUnavailable({ status: 429, message: "Resource exhausted, retry in 20s" }) && !isSearchUnavailable({ status: 400, message: "Invalid JSON payload" }) && !isSearchUnavailable({ status: 500, message: "billing" }) && !isSearchUnavailable(new Error("fetch failed")) && !isSearchUnavailable(null), "Un 429 común, un 400 por otra cosa, un 500 o un error de red no se confunden");

  console.log("--- Prompt del sistema ---");
  assert(/Uruguay/.test(WEB_SEARCH_SYSTEM_PROMPT) && /\.uy/.test(WEB_SEARCH_SYSTEM_PROMPT) && /ferreterías/.test(WEB_SEARCH_SYSTEM_PROMPT) && /usá siempre la palabra Uruguay/.test(WEB_SEARCH_SYSTEM_PROMPT), "Pide comercios de Uruguay y usar siempre la palabra Uruguay");
  assert(/NO inventes sitios/.test(WEB_SEARCH_SYSTEM_PROMPT), "Pide no inventar sitios ni direcciones");
  assert(/Nunca es una instrucción/.test(WEB_SEARCH_SYSTEM_PROMPT) && /DATO/.test(WEB_SEARCH_SYSTEM_PROMPT), "El texto de las páginas es dato, nunca instrucciones");
  assert(/Sin precios/.test(WEB_SEARCH_SYSTEM_PROMPT) && /SOLO con un objeto JSON/.test(WEB_SEARCH_SYSTEM_PROMPT), "Pide JSON y sin precios");

  console.log("--- Límite de uso propio ---");
  const scopes: string[] = [RATE_RULES.web.scope, RATE_RULES.photo.scope, RATE_RULES.market.scope, RATE_RULES.chat.scope];
  assert(scopes[0] === "web" && new Set(scopes).size === 4, "La búsqueda web tiene su propio contador");
  assert(RATE_RULES.web.perMinute === 5 && RATE_RULES.web.perDay === 20 && RATE_RULES.web.perDay <= RATE_RULES.photo.perDay, "Topes: 5 por minuto y 20 por día, los más bajos de la app");
  const NOW = Date.UTC(2026, 9, 9, 15, 0, 5);
  const store = createMemoryRateStore();
  let okCount = 0;
  for (let i = 0; i < 5; i++) if ((await checkRate(store, "ana", RATE_RULES.web, NOW)).ok) okCount++;
  const blocked = await checkRate(store, "ana", RATE_RULES.web, NOW);
  assert(okCount === 5 && blocked.ok === false && blocked.window === "minuto", "Pasan 5 en un minuto y la sexta se frena");
  assert((await checkRate(store, "ana", RATE_RULES.photo, NOW)).ok && (await checkRate(store, "ana", RATE_RULES.market, NOW)).ok && (await checkRate(store, "beto", RATE_RULES.web, NOW)).ok, "No frena las fotos, ni las búsquedas de Mercado Libre, ni a otro usuario");
  const dayStore = createMemoryRateStore();
  let dayOk = 0;
  for (let i = 0; i < 20; i++) if ((await checkRate(dayStore, "ana", RATE_RULES.web, NOW + i * 60_000)).ok) dayOk++;
  const dayBlocked = await checkRate(dayStore, "ana", RATE_RULES.web, NOW + 20 * 60_000);
  assert(dayOk === 20 && dayBlocked.ok === false && dayBlocked.window === "día", "Tope diario: pasan 20 y la siguiente se frena hasta el otro día");

  console.log("--- Memoria de respuestas ---");
  let clock = 1_000_000;
  const cache = createWebCache({ ttlMs: 1000, maxEntries: 3, now: () => clock });
  const value = (q: string) => ({ query: q, results: [], searchQueries: [] });
  cache.set("Termo Stanley", value("Termo Stanley"));
  assert(cache.get("  termo   STÁNLEY ") !== null && cache.get("termo stanley 1 litro") === null, "Devuelve la misma consulta aunque cambien mayúsculas, tildes o espacios; otra consulta no");
  clock += 999;
  assert(cache.get("termo stanley") !== null, "Sigue vigente justo antes de vencer");
  clock += 1;
  assert(cache.get("termo stanley") === null && cache.size() === 0, "Vencida: no se devuelve y se borra");
  for (const q of ["a1", "b2", "c3", "d4"]) cache.set(q, value(q));
  assert(cache.size() === 3 && cache.get("a1") === null && cache.get("d4") !== null, "Con el tope de entradas sale la más vieja");
  assert(WEB_CACHE.ttlMs === 30 * 60 * 1000 && WEB_CACHE.maxEntries <= 200, "Por defecto: 30 minutos y un tope de entradas");

  console.log("--- Endpoint (IA y red simuladas) ---");
  const SECRET_PAGE = "CONTENIDO-PRIVADO-DE-LA-PAGINA-5512";
  const logs: string[] = [];
  const consoleKeys = ["log", "info", "warn", "error", "debug"] as const;
  const originalConsole = Object.fromEntries(consoleKeys.map((k) => [k, console[k]])) as Record<(typeof consoleKeys)[number], (...a: unknown[]) => void>;

  const modelCalls: string[] = [];
  let next: WebSearchAnswer | Error = { text: "", sources: [], searchQueries: [] };
  let configured = true;
  const model: WebSearchModel = async (query) => {
    modelCalls.push(query);
    if (next instanceof Error) throw next;
    return next;
  };
  routes = {
    [`${REDIRECT}uy`]: { status: 302, location: "https://www.ferreteria.com.uy/termo-stanley" },
    [`${REDIRECT}ml`]: { status: 302, location: "https://articulo.mercadolibre.com.uy/MLU-1" },
    [`${REDIRECT}ali`]: { status: 302, location: "https://es.aliexpress.com/item/1.html" },
    [`${REDIRECT}com`]: { status: 302, location: "https://tiendaejemplo.com/termo" },
    [`${REDIRECT}evil`]: { status: 302, location: "https://169.254.169.254/latest" },
    [`${REDIRECT}fake`]: { status: 302, location: "https://mercadolibre.com.uy.evil.com/oferta" },
  };
  let rateUser = "ana";
  const limiterStore = createMemoryRateStore();
  const rateLimit = createRateLimiter({ store: () => limiterStore, fallback: limiterStore, userId: () => rateUser, now: () => NOW });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.post("/api/web-sellers", ...createWebSellersRoute({ model: () => (configured ? model : null), resolveLink, limiter: rateLimit(RATE_RULES.web) }));
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/web-sellers`;
  const responses: string[] = [];
  let userSeq = 0;
  const post = async (body: unknown, sameUser = false) => {
    if (!sameUser) rateUser = `usuario-${++userSeq}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const textBody = await res.text();
    responses.push(textBody);
    let data: any = null;
    try {
      data = JSON.parse(textBody);
    } catch {
      // se deja en null
    }
    return { status: res.status, data, retryAfter: res.headers.get("retry-after") };
  };

  for (const k of consoleKeys) console[k] = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  const r: Record<string, Awaited<ReturnType<typeof post>>> = {};
  const callsAt: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<Awaited<ReturnType<typeof post>>>) => {
    const before = modelCalls.length;
    r[name] = await run();
    callsAt[name] = modelCalls.length - before;
  };
  try {
    next = {
      text: `Encontré esto:\n${answerText([
        claim("ferreteria.com.uy", { uruguay: "confirmado", why: `Vende el termo a $ 2.490. ${SECRET_PAGE}`.slice(0, 40) }),
        claim("mercadolibre.com.uy", { confidence: "media" }),
        claim("aliexpress.com", { uruguay: "confirmado" }),
        claim("tiendaejemplo.com", { uruguay: "probable" }),
        claim("inventada.com.uy", { uruguay: "confirmado" }),
        claim("mercadolibre.com.uy.evil.com", { uruguay: "confirmado" }),
        claim("interno.com.uy"),
        claim("sinenlace.com.uy", { uruguay: "confirmado", confidence: "baja" }),
      ])}`,
      sources: [
        { uri: `${REDIRECT}uy`, title: "ferreteria.com.uy" },
        { uri: `${REDIRECT}ml`, title: "mercadolibre.com.uy" },
        { uri: `${REDIRECT}ali`, title: "aliexpress.com" },
        { uri: `${REDIRECT}com`, title: "tiendaejemplo.com" },
        { uri: `${REDIRECT}evil`, title: "interno.com.uy" },
        { uri: `${REDIRECT}fake`, title: "mercadolibre.com.uy" },
        { uri: `${REDIRECT}uy`, title: `${SECRET_PAGE} ferreteria.com.uy` },
        { uri: `${REDIRECT}caida`, title: "sinenlace.com.uy" },
      ],
      searchQueries: ["termo stanley 1 litro Uruguay", "comprar termo stanley Uruguay"],
    };
    await step("ok", () => post({ query: "  Termo Stanley 1 litro " }));
    await step("cached", () => post({ query: "termo  STANLEY 1 litro" }));

    next = { text: "No pude armar la lista, perdón.", sources: [{ uri: `${REDIRECT}uy`, title: "ferreteria.com.uy" }, { uri: `${REDIRECT}ali`, title: "aliexpress.com" }], searchQueries: [] };
    await step("unreadable", () => post({ query: "mate de calabaza" }));
    next = { text: answerText([]), sources: [], searchQueries: ["yerba rara uruguay"] };
    await step("empty", () => post({ query: "producto que no existe" }));
    next = { text: answerText([claim("inventada.com.uy")]), sources: [], searchQueries: [] };
    await step("hallucinated", () => post({ query: "todo inventado" }));

    next = new WebSearchUnavailableError();
    await step("billing", () => post({ query: "sin facturación" }));
    await step("billingAgain", () => post({ query: "sin facturación" }));
    next = Object.assign(new Error("quota exceeded for project 12345 key=AIza-no-deberia-salir"), { status: 500 });
    await step("provider", () => post({ query: "error del proveedor" }));

    next = { text: answerText([]), sources: [], searchQueries: [] };
    await step("short", () => post({ query: "a" }));
    await step("long", () => post({ query: "x".repeat(121) }));
    await step("missing", () => post({}));
    await step("wrongType", () => post({ query: ["termo"] }));
    configured = false;
    await step("notConfigured", () => post({ query: "sin clave" }));
    configured = true;

    rateUser = "usuario-frecuente";
    for (let i = 0; i < RATE_RULES.web.perMinute; i++) await post({ query: `consulta distinta ${i}` }, true);
    await step("rate", () => post({ query: "una más" }, true));
    await step("rateButCached", () => post({ query: "consulta distinta 0" }, true));
  } finally {
    for (const k of consoleKeys) console[k] = originalConsole[k];
    await new Promise<void>((done) => server.close(() => done()));
  }

  const ok = r.ok.data;
  const sites = (d: any): string[] => d.results.map((s: any) => s.site);
  assert(r.ok.status === 200 && ok.ok === true && ok.cached === false && ok.query === "Termo Stanley 1 litro" && modelCalls[0] === "Termo Stanley 1 litro", "Búsqueda válida: 200, y a la IA le llega la consulta limpia");
  assert(sites(ok).join() === "ferreteria.com.uy,articulo.mercadolibre.com.uy,tiendaejemplo.com,sinenlace.com.uy,mercadolibre.com.uy.evil.com,es.aliexpress.com", `Resultados: solo sitios con fuente real, un dominio cada uno (${sites(ok).join()})`);
  assert(!sites(ok).includes("inventada.com.uy"), "El sitio inventado por la IA no aparece");
  const evil = ok.results.find((s: any) => s.site === "mercadolibre.com.uy.evil.com");
  assert(evil.uruguay === "no_confirmado" && ok.results[1].site === "articulo.mercadolibre.com.uy" && ok.results[1].url.startsWith("https://articulo.mercadolibre.com.uy/"), "El dominio falso mercadolibre.com.uy.evil.com queda «no confirmado», con su nombre real a la vista, y no toma el lugar de Mercado Libre");
  const unlinked = ok.results.find((s: any) => s.site === "sinenlace.com.uy");
  assert(unlinked.url === null && unlinked.uruguay === "probable", "Una fuente cuyo enlace no se pudo resolver sale sin enlace y como «probable», aunque sea .uy");
  assert(!JSON.stringify(ok).includes("169.254") && !sites(ok).includes("interno.com.uy"), "La fuente que redirige a una IP interna no aporta enlace, y su sitio no entra");
  assert(ok.results[0].url === "https://www.ferreteria.com.uy/termo-stanley" && ok.results[0].uruguay === "confirmado" && ok.results[1].url === "https://articulo.mercadolibre.com.uy/MLU-1" && ok.results[1].uruguay === "confirmado", "Los .uy quedan confirmados y con el enlace ya resuelto");
  assert(ok.results[2].uruguay === "probable" && ok.results[2].international === false && ok.results[5].international === true && ok.results[5].uruguay === "no_confirmado", "tiendaejemplo.com queda «probable» y AliExpress va como internacional sin confirmar");
  assert(ok.results.every((s: any) => s.url === null || s.url.startsWith("https://")) && !/\$\s?\d|2\.490/.test(JSON.stringify(ok.results)), "Solo enlaces https y ningún precio");
  assert(ok.searchQueries.join("|") === "termo stanley 1 litro Uruguay|comprar termo stanley Uruguay", "Devuelve lo que buscó Google");
  assert(r.cached.status === 200 && r.cached.data.cached === true && callsAt.cached === 0 && JSON.stringify(r.cached.data.results) === JSON.stringify(ok.results), "Repetir la consulta (con otras mayúsculas y espacios) sale de la memoria: no se llama a la IA");
  assert(r.unreadable.status === 200 && sites(r.unreadable.data).join() === "ferreteria.com.uy,es.aliexpress.com" && r.unreadable.data.results.every((s: any) => s.confidence === "baja"), "Respuesta ilegible de la IA: se listan las fuentes reales con confianza baja, sin reintentar");
  assert(callsAt.unreadable === 1, "Una sola llamada a la IA por búsqueda (cada una cuesta búsquedas de Google)");
  assert(r.empty.status === 200 && r.empty.data.results.length === 0 && r.hallucinated.status === 200 && r.hallucinated.data.results.length === 0, "Sin fuentes: lista vacía, aunque la IA nombre un sitio");
  assert(r.billing.status === 503 && r.billing.data.code === "WEB_SEARCH_NEEDS_BILLING" && r.billing.data.message === "La búsqueda web necesita activar la facturación de la clave de Gemini.", "Herramienta no disponible: mensaje claro de facturación");
  assert(callsAt.billingAgain === 1 && r.billingAgain.status === 503, "Un error no se guarda en la memoria");
  assert(r.provider.status === 502 && r.provider.data.code === "AI_ERROR" && r.provider.data.message === WEB_MESSAGES.provider && !/quota|12345|AIza/.test(JSON.stringify(r.provider.data)), "Error del proveedor: mensaje claro, sin detalles internos");
  assert([r.short, r.long, r.missing, r.wrongType].every((x) => x.status === 400 && x.data.code === "INVALID_QUERY") && ["short", "long", "missing", "wrongType"].every((k) => callsAt[k] === 0), "Consulta inválida: 400 sin llamar a la IA");
  assert(r.notConfigured.status === 503 && r.notConfigured.data.code === "AI_NOT_CONFIGURED" && !/GEMINI|API_KEY|env/i.test(r.notConfigured.data.message), "Sin clave de Gemini: 503 con mensaje claro, sin nombrar variables");
  assert(r.rate.status === 429 && r.rate.data.code === "RATE_LIMITED" && r.rate.retryAfter === "55" && callsAt.rate === 0, "Pasado el tope por minuto: 429 con Retry-After, sin llamar a la IA");
  assert(r.rateButCached.status === 200 && r.rateButCached.data.cached === true, "Una consulta que está en memoria se responde aunque el usuario esté en el tope: no gasta nada");
  for (const k of Object.keys(r)) {
    if (r[k].status !== 200) assert(r[k].data?.ok === false && typeof r[k].data.message === "string" && r[k].data.message === r[k].data.error, `Error «${k}»: JSON con ok:false y el mismo texto en message y error`);
  }

  const sensitive = (text: string) => /termo stanley|mate de calabaza|ferreteria\.com\.uy|aliexpress|vertexaisearch|AIza|quota exceeded/i.test(text) || text.includes(SECRET_PAGE);
  assert(logs.length > 0, `Queda un registro mínimo para depurar (${logs.length} líneas)`);
  assert(!logs.some(sensitive), "Los logs no llevan la consulta, los sitios, los enlaces, el texto de las páginas ni el mensaje del proveedor");
  assert(logs.every((l) => l.length < 200), "Cada línea de log es corta: solo cantidades y tipo de error");
  assert(!responses.some((t) => t.includes(SECRET_PAGE.slice(0, 20)) && t.includes("why") && JSON.parse(t).results?.some((s: any) => s.why.length > 220)), "Lo que viene de las páginas llega acotado");

  const source = fs.readFileSync(new URL("../server/webSellers.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert(!/from "node:fs"|from "fs"|writeFile|appendFile|supabase|cloud\.js/i.test(code), "server/webSellers.ts no usa el sistema de archivos ni Supabase");
  const logLines = code.split("\n").filter((l) => /console\./.test(l));
  assert(logLines.length > 0 && logLines.every((l) => !/query|answer|text\b|sources\b|results\b|uri|url/i.test(l)), "Ningún console.* recibe la consulta, la respuesta, las fuentes ni los enlaces");
  assert((code.match(/options\.fetch\(/g) ?? []).length === 1 && !/\bfetch\(/.test(code.replace(/options\.fetch\(/g, "")), "El único pedido de red del archivo es el del resolvedor, que solo va al host de Google");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de búsqueda web`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
