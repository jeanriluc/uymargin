// Tests de la verificación de sitios (ronda 14): indicios de Uruguay, página activa o caída, protecciones al
// abrir páginas de terceros, permisos firmados, límite de uso y que nada de las páginas quede en los logs.
// La red es siempre simulada: el DNS y los pedidos se inyectan; lo único real es un servidor local de prueba
// en 127.0.0.1 para comprobar el corte por tamaño y por tiempo. No se importa server/app.ts ni Supabase.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import express from "express";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES } from "../server/rateLimit";
import {
  createMercadoLibreChecker,
  createVerifySigner,
  createVerifySitesRoute,
  nodeRequest,
  openPage,
  verifySites,
  type NetDeps,
  type PageRequest,
  type RawResponse,
} from "../server/verifySites";
import { createVisualCache, createVisualSearchRoute, imageHash } from "../server/visualSearch";
import { createWebSellersRoute } from "../server/webSellers";
import { parseVisualResponse } from "../src/lib/photo/visual";
import { cleanVerifyToken, parseWebSellersResponse } from "../src/lib/web/sellers";
import {
  UNKNOWN_VERDICT,
  UY_DEPARTMENTS,
  VERIFY_LIMITS,
  VERIFY_MESSAGES,
  VERIFY_USER_AGENT,
  findUruguaySignals,
  isBlockedIp,
  isOutOfStock,
  isParkingHost,
  judgePage,
  looksLikeNotFound,
  looksLikeRobotWall,
  looksParked,
  mercadoLibreLookup,
  openableUrl,
  parseVerifyResponse,
  sameSite,
  signalsPhrase,
  visibleText,
  type PageOutcome,
} from "../src/lib/web/verify";

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

const read = (name: string) => fs.readFileSync(new URL(`./fixtures/verify/${name}.html`, import.meta.url), "utf8");
const UY_STORE = read("tienda_uruguay");
const US_STORE = read("tienda_eeuu");
const PARKED = read("parqueada");
const ROBOTS = read("robots");
const MARKER = "MARCA-PRIVADA-DEL-HTML-5567";
const SECRET = "clave-de-prueba-que-no-debe-verse-0123456789abcdef";
const NOW = Date.UTC(2026, 9, 10, 15, 0, 5);
const page = (body: string, head = "") => `<!doctype html><html><head><title>Tienda</title>${head}</head><body>${body}</body></html>`;
const signalsOf = (html: string, url = "https://tienda.com/producto") => findUruguaySignals(html, url);

/** Red simulada: un DNS de mentira y un mapa de direcciones a respuestas. Anota todo lo que se intenta abrir. */
function fakeNet(dnsTable: Record<string, string[] | "ENOTFOUND" | "EAI_AGAIN">, pages: Record<string, Partial<RawResponse> | "ECONNREFUSED" | "TIMEOUT" | "ECONNRESET">) {
  const opened: PageRequest[] = [];
  const resolved: string[] = [];
  let active = 0;
  let maxActive = 0;
  const net: NetDeps = {
    async resolve(host) {
      resolved.push(host);
      const answer = dnsTable[host] ?? ["93.184.216.34"];
      if (typeof answer === "string") throw Object.assign(new Error(answer), { code: answer });
      return answer;
    },
    async request(target) {
      opened.push(target);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const answer = pages[target.url.href];
      if (answer === undefined) return { status: 404, contentType: "text/html", location: null, body: Buffer.alloc(0), truncated: false };
      if (typeof answer === "string") throw Object.assign(new Error(answer), { code: answer });
      const body = answer.body ?? Buffer.alloc(0);
      return { status: 200, contentType: "text/html; charset=utf-8", location: null, truncated: false, ...answer, body };
    },
  };
  return { net, opened, resolved, urls: () => opened.map((o) => o.url.href), maxActive: () => maxActive };
}
const html = (text: string, extra: Partial<RawResponse> = {}): Partial<RawResponse> => ({ body: Buffer.from(text, "utf8"), ...extra });
const redirect = (location: string, status = 302): Partial<RawResponse> => ({ status, location, contentType: "" });

async function main() {
  console.log("--- Direcciones IP que no se abren ---");
  for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1", "127.0.0.1", "127.8.9.10", "169.254.169.254", "169.254.0.1", "0.0.0.0", "0.1.2.3", "100.64.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.8", "198.18.0.1"]) {
    assert(isBlockedIp(ip), `IPv4 ${ip}: bloqueada`);
  }
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::a00:1", "2002:a00:1::1", "2001:db8::1", "[::1]", "fe80::1%eth0"]) {
    assert(isBlockedIp(ip), `IPv6 ${ip}: bloqueada`);
  }
  for (const ip of ["2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:0000:0a00:0001::1", "fec0::1", "fec0:0:0:1::5", "feff::1", "::ffff:0:10.0.0.1", "::ffff:0:127.0.0.1", "::ffff:0:169.254.169.254", "::ffff:0:8.8.8.8", "::ffff:0:a00:1", "0:0:0:ffff:0:a00:1:0"]) {
    assert(isBlockedIp(ip), `IPv6 ${ip} (Teredo, local al sitio o IPv4 traducida): bloqueada`);
  }
  for (const ip of ["2606:4700:4700::1111", "8.8.8.8", "2001:4860:4860::8888", "2001:1::1", "2001:200::1", "fe00::1", "2800:a8::1"]) {
    assert(!isBlockedIp(ip), `${ip}: sigue permitida`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.167.1.1", "169.253.1.1", "100.63.0.1", "100.128.0.1", "200.40.30.20", "2606:4700:4700::1111", "2800:a8::1", "::ffff:8.8.8.8"]) {
    assert(!isBlockedIp(ip), `${ip}: pública, permitida`);
  }
  for (const junk of ["", "no-es-una-ip", "999.1.1.1", "1.2.3", ":::", "1:2:3:4:5:6:7:8:9", "gggg::1"]) {
    assert(isBlockedIp(junk), `«${junk}» no se entiende como dirección: bloqueada`);
  }

  console.log("--- Direcciones que el verificador puede abrir ---");
  for (const ok of ["https://tienda.com.uy/producto", "http://tienda.com/", "https://www.tienda.com:443/a?b=1", "http://tienda.com:80/"]) {
    assert(openableUrl(ok) !== null, `Se puede abrir: ${ok}`);
  }
  for (const bad of ["ftp://tienda.com/a", "file:///etc/passwd", "javascript:alert(1)", "gopher://tienda.com/", "https://tienda.com:8443/", "http://tienda.com:22/", "https://tienda.com:444/", "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://0.0.0.0/", "http://2130706433/", "http://0x7f000001/", "http://10.0.0.1/", "https://usuario:clave@tienda.com/", "https://intranet.local/", "https://servidor/", "https://metadata.internal/", "", "tienda.com", null, 7]) {
    assert(openableUrl(bad) === null, `No se abre: ${String(bad) || "(vacío)"}`);
  }
  assert(sameSite("www.tienda.com", "tienda.com") && sameSite("checkout.tienda.com.uy", "tienda.com.uy") && !sameSite("tienda.com", "otratienda.com") && !sameSite("tienda.com", "tienda.com.uy"), "Mismo sitio: con www y subdominios sí; otro dominio (o el mismo nombre con otra terminación) no");

  console.log("--- Señales fuertes de Uruguay ---");
  const ld = (data: unknown) => page("<h1>Producto</h1>", `<script type="application/ld+json">${JSON.stringify(data)}</script>`);
  const strongCases: [string, string, RegExp][] = [
    ["schema.org Organization con addressCountry UY", ld({ "@type": "Organization", address: { "@type": "PostalAddress", addressCountry: "UY" } }), /país Uruguay/],
    ["schema.org LocalBusiness con país «Uruguay»", ld({ "@type": "LocalBusiness", address: { addressCountry: { "@type": "Country", name: "Uruguay" } } }), /país Uruguay/],
    ["schema.org PostalAddress con localidad uruguaya", ld({ "@graph": [{ "@type": "Store", address: { "@type": "PostalAddress", addressLocality: "Maldonado", addressCountry: "UY" } }] }), /dirección en Maldonado/],
    ["teléfono +598 en el texto", page("<p>Llamanos: +598 2900 1234</p>"), /teléfono \+598/],
    ["teléfono +598 escrito con entidad HTML", page("<p>Tel: &#43;598 99 123 456</p>"), /teléfono \+598/],
    ["enlace tel:+598", page('<a href="tel:+59829001234">Llamar</a>'), /teléfono \+598/],
    ["enlace de WhatsApp a un número 598", page('<a href="https://wa.me/59899123456">WhatsApp</a>'), /teléfono \+598/],
    ["<html lang=\"es-UY\">", '<!doctype html><html lang="es-UY"><head><title>T</title></head><body><p>Hola</p></body></html>', /idioma es-UY/],
    ["og:locale es_UY", page("<p>Hola</p>", '<meta property="og:locale" content="es_UY">'), /idioma es-UY/],
    ["hreflang es-uy", page("<p>Hola</p>", '<link rel="alternate" hreflang="es-uy" href="https://tienda.com/uy/">'), /idioma es-UY/],
    ["dirección con Montevideo junto a Uruguay", page("<p>Av. Italia 1234, Montevideo, Uruguay</p>"), /dirección en Montevideo/],
    ["dirección con Paysandú (con tilde) junto a Uruguay", page("<p>Sucursal: 18 de Julio 900, Paysandú - Uruguay</p>"), /dirección en Paysandú/],
    ["dirección con «Uruguay» antes del departamento", page("<p>Uruguay, departamento de Treinta y Tres, ruta 8</p>"), /dirección en Treinta y Tres/],
    ["un RUT de 12 cifras", page("<p>Casa del Mate S.A. RUT: 21 123456 0019</p>"), /RUT/],
    ["un RUT pegado", page("<p>R.U.T. 211234560019</p>"), /RUT/],
  ];
  for (const [label, source, expected] of strongCases) {
    const found = signalsOf(source);
    assert(found.verdict === "confirmed" && found.signals.some((s) => expected.test(s)), `Fuerte: ${label} → confirmed (${found.signals.join(", ")})`);
  }
  for (const name of UY_DEPARTMENTS) {
    const found = signalsOf(page(`<p>Local en ${name}, Uruguay.</p>`));
    assert(found.verdict === "confirmed" && found.signals.includes(`dirección en ${name}`), `Departamento ${name} junto a «Uruguay»: dirección en ${name}`);
  }
  assert(UY_DEPARTMENTS.length === 19, "Están los 19 departamentos");
  assert(signalsOf(page("<p>Colonia para hombre 100 ml. Envíos desde Miami a Chile, Paraguay y Uruguay.</p>")).signals.every((s) => !/dirección/.test(s)), "«Colonia» (perfume) lejos de «Uruguay» no es una dirección");
  assert(signalsOf(page("<p>Durazno en almíbar. Salto de cama. Flores naturales.</p>")).verdict === "none", "Nombres de departamentos que son palabras comunes, sin «Uruguay», no cuentan");
  assert(signalsOf(page("<p>RUT 12.345.678-9 (Chile)</p>")).verdict === "none", "Un RUT con formato chileno no cuenta");
  assert(signalsOf(page("<p>Call us +1 598 555 0100</p>")).verdict === "none", "Un +1 con 598 adentro no se confunde con el código de Uruguay");

  console.log("--- Señales medias de Uruguay ---");
  const mediumCases: [string, string, RegExp][] = [
    ["precio en $U", page("<p>Precio: $U 3.722</p>"), /precios en pesos uruguayos/],
    ["precio en UYU", page("<p>UYU 3722</p>"), /precios en pesos uruguayos/],
    ["priceCurrency UYU en los datos del producto", ld({ "@type": "Product", offers: { "@type": "Offer", price: 3722, priceCurrency: "UYU" } }), /precios en pesos uruguayos/],
    ["meta product:price:currency UYU", page("<p>Producto</p>", '<meta property="product:price:currency" content="UYU">'), /precios en pesos uruguayos/],
    ["«Correo Uruguayo»", page("<p>Enviamos por Correo Uruguayo.</p>"), /Correo Uruguayo/],
    ["«DAC»", page("<p>Despachos por DAC a todo el interior.</p>"), /DAC/],
    ["«Abitab»", page("<p>Pagá en Abitab.</p>"), /Abitab/],
    ["«RedPagos»", page("<p>También por Red Pagos.</p>"), /RedPagos/],
    ["«envíos a todo el país»", page("<p>Envíos a todo el país en 48 h.</p>"), /envíos a todo el país/],
    ["«envíos al interior»", page("<p>Hacemos envíos al interior.</p>"), /envíos al interior/],
    ["«Montevideo» en el pie de página", page("<main><p>Producto</p></main><footer><p>Casa central: Montevideo</p></footer>"), /Montevideo en el pie de página/],
    ["«Uruguay» en el pie de página", page("<main><p>Producto</p></main><footer><p>Hecho en Uruguay</p></footer>"), /Uruguay en el pie de página/],
    ["enlaces a otros .uy", page('<p>Producto</p><a href="https://www.otratienda.com.uy/local">Nuestro local</a>'), /enlaces a sitios \.uy/],
  ];
  for (const [label, source, expected] of mediumCases) {
    const found = signalsOf(source);
    assert(found.verdict === "probable" && found.signals.some((s) => expected.test(s)), `Media: ${label} → probable (${found.signals.join(", ")})`);
  }
  assert(signalsOf(page("<main><p>Viajes a Montevideo y Uruguay</p></main><footer><p>Miami, FL</p></footer>")).verdict === "none", "«Montevideo» fuera del pie de página no es una señal media");
  assert(signalsOf(page('<a href="/local">Local</a><a href="https://blog.tienda.com.uy/x">Blog</a>'), "https://www.tienda.com.uy/p").signals.every((s) => !/enlaces/.test(s)), "Los enlaces al propio sitio no cuentan como «otros .uy»");
  assert(signalsOf(page("<p>dac es un acrónimo cualquiera</p>")).verdict === "none", "«dac» en minúsculas no cuenta");

  console.log("--- Resultado: confirmed, probable o none ---");
  const uy = signalsOf(UY_STORE, "https://casadelmate.com/termo");
  assert(uy.verdict === "confirmed" && uy.signals.includes("teléfono +598") && uy.signals.includes("dirección en Montevideo"), `Tienda con dirección en Montevideo y teléfono +598: confirmed (${uy.signals.join(", ")})`);
  assert(signalsPhrase({ live: "alive", outOfStock: false, uruguay: uy.verdict, signals: uy.signals }).startsWith("Uruguay: ") && uy.signals.length <= VERIFY_LIMITS.maxSignals && uy.signals.every((s) => s.length <= 60), "La frase para la pantalla es corta: «Uruguay: …»");
  const us = signalsOf(US_STORE, "https://outdoorgear.com/bottle");
  assert(us.verdict === "none" && us.signals.length === 0 && us.score === 0, "Un .com de EE.UU. (dirección en Portland, +1, precios en USD): none");
  for (const dollars of ["<p>Precio: US$ 45</p>", "<p>U$S 1.299 en 12 cuotas</p>", "<p>USD 99.00</p>", "<p>Precio en dólares: $ 45</p>"]) {
    assert(signalsOf(page(dollars)).verdict === "none", `El dólar no es una señal: ${dollars.replace(/<[^>]+>/g, "")}`);
  }
  assert(signalsOf(page("<p>Envíos a todo el país</p><footer>Montevideo</footer>")).verdict === "probable", "Varias señales medias siguen siendo «probable»: sin una fuerte no se confirma");
  assert(signalsOf(page("<p>Envíos a todo el país. Tel +598 2900 0000</p>")).verdict === "confirmed", "Una fuerte alcanza para «confirmed»");
  assert(signalsOf("").verdict === "none" && signalsOf("<<<>>> no es html &&&").verdict === "none" && signalsOf(page("<p>x</p>", '<script type="application/ld+json">{esto no es json</script>')).verdict === "none", "HTML vacío, roto o con datos estructurados inválidos: none, sin romper");
  const hostile = page(`<p>+598 2900 1234</p><script>alert("${MARKER}")</script><img src=x onerror="alert(1)">`);
  assert(signalsOf(hostile).signals.every((s) => /^[\p{L}\p{N} +.,\-]+$/u.test(s)) && !JSON.stringify(signalsOf(hostile)).includes(MARKER), "Los indicios son frases fijas: nunca llevan texto, etiquetas ni scripts de la página");
  assert(!visibleText(hostile).includes(MARKER) && !/[<>]/.test(visibleText(hostile)), "El texto visible no incluye scripts ni etiquetas");
  const deep = JSON.stringify(Array.from({ length: 60 }).reduce((inner) => ({ a: inner }), { addressCountry: "UY" } as unknown));
  assert(signalsOf(page("", `<script type="application/ld+json">${deep}</script>`)).verdict === "none", "Datos estructurados demasiado anidados no se recorren sin límite");

  console.log("--- Página activa, caída, sin verificar o agotada ---");
  const ok = (body: string, extra: Partial<Extract<PageOutcome, { kind: "page" }>> = {}): PageOutcome => ({ kind: "page", status: 200, contentType: "text/html; charset=utf-8", html: body, truncated: false, finalUrl: "https://tienda.com/producto", ...extra });
  const judge = (outcome: PageOutcome) => judgePage(outcome, "tienda.com");
  assert(judge(ok(UY_STORE)).live === "alive" && judge(ok(UY_STORE)).readable && !judge(ok(UY_STORE)).outOfStock, "200 con HTML: alive");
  assert(judge(ok(UY_STORE, { finalUrl: "https://www.tienda.com/producto" })).live === "alive" && judge(ok(UY_STORE, { finalUrl: "https://checkout.tienda.com/p" })).live === "alive", "Terminar en www. o en un subdominio del mismo sitio sigue siendo alive");
  for (const status of [404, 410]) assert(judge(ok("<html></html>", { status })).live === "dead", `HTTP ${status}: dead`);
  for (const status of [500, 502, 503, 504]) assert(judge(ok(page("<p>Error</p>"), { status })).live === "dead", `HTTP ${status}: dead (el servidor está caído)`);
  assert(judge({ kind: "no_dns" }).live === "dead" && judge({ kind: "refused" }).live === "dead", "DNS que no resuelve o conexión rechazada: dead");
  assert(judge(ok("", { status: 301, contentType: "", finalUrl: "https://otratienda.com/" })).live === "dead" && judge(ok("", { status: 302, contentType: "", finalUrl: "https://otratienda.com/" })).reason === "redirige a otro dominio", "Redirección a otro dominio: dead");
  assert(judge(ok("", { status: 302, contentType: "", finalUrl: "https://www.hugedomains.com/domain_profile.cfm?d=tienda.com" })).reason === "dominio en venta" && isParkingHost("sedo.com") && isParkingHost("www.dan.com") && !isParkingHost("tienda.com"), "Redirección a un sitio de venta de dominios: dead, «dominio en venta»");
  assert(judge(ok(PARKED)).live === "dead" && judge(ok(PARKED)).reason === "dominio en venta" && looksParked(PARKED) && !looksParked(UY_STORE), "Página parqueada o «en venta» con 200: dead");
  assert(!judge(ok(PARKED)).readable && /Montevideo, Uruguay/.test(PARKED), "De una página parqueada no se sacan indicios, aunque nombre a Montevideo y Uruguay");
  const titled = (title: string, body = "<h1>Termo de acero</h1>") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
  for (const title of ["404", "Error 404", "404 - Página no encontrada", "Page not found", "Esta página no existe", "Error 410", "410 Gone", "ERROR 404 | Tienda", "Página no encontrada | Casa del Mate", "La página no existe", "No se encontró la página", "This page could not be found", "Página inexistente", "¡404! Ups"]) {
    assert(looksLikeNotFound(titled(title)) && judge(ok(titled(title))).live === "dead", `200 con título «${title}»: Caída`);
  }
  assert(looksLikeNotFound(titled("Tienda", "<h1>Página no encontrada</h1>")) && judge(ok(titled("Tienda", "<h1>Página no encontrada</h1>"))).reason === "dice que no existe", "Un <h1> corto «Página no encontrada» con título genérico: Caída");
  assert(looksLikeNotFound(titled("Tienda", "<h2>Error 404</h2>")) && looksLikeNotFound(titled("Tienda", "<h1> — 404 — </h1>")), "También en un <h2>, y con adornos antes del código");
  for (const title of ["Termo 404 ml Stanley", "Not found what you need? Termo", "Si no existe tu talle, avisanos", "Termo Stanley 1.4 L | Tienda", "Peugeot 404 repuestos originales", "Modelo 410 de acero", "No existe mejor termo", "Lost & Found: termos usados", "Lo que no existe en otras tiendas", "Art. 4041 Termo"]) {
    assert(!looksLikeNotFound(titled(title)) && judge(ok(titled(title))).live === "alive", `Título «${title}»: sigue Activa`);
  }
  for (const heading of ["Termo 404 ml Stanley", "Si no existe tu talle, avisanos", "Not found what you need? Termo"]) {
    assert(!looksLikeNotFound(titled("Tienda", `<h1>${heading}</h1><h2>${heading}</h2>`)), `Encabezado «${heading}»: sigue Activa`);
  }
  const longTitle = "Página no encontrada es lo que vas a ver en otras tiendas cuando busques este termo";
  assert(longTitle.length > 60 && !looksLikeNotFound(titled(longTitle)) && !looksLikeNotFound(titled("Tienda", `<h1>404 ${"x".repeat(70)}</h1>`)), "Un título o encabezado de más de 60 caracteres no se mira");
  assert(!looksLikeNotFound(titled("Tienda", "<h1>Termo</h1><p>Error 404. Página no encontrada. Page not found.</p><h3>404</h3>")), "Fuera de <title>, <h1> y <h2> no se mira: ni párrafos ni <h3>");
  for (const status of [403, 429, 401]) assert(judge(ok(page("<p>Forbidden</p>"), { status })).live === "unknown" && judge(ok("", { status })).reason === "protección contra robots", `HTTP ${status}: unknown, no caída`);
  assert(judge(ok(ROBOTS)).live === "unknown" && judge(ok(ROBOTS, { status: 503 })).live === "unknown" && looksLikeRobotWall(ROBOTS) && !looksLikeRobotWall(UY_STORE), "Pantalla de protección contra robots (con 200 o con 503): unknown");
  assert(judge({ kind: "timeout" }).live === "unknown" && judge({ kind: "error" }).live === "unknown" && judge({ kind: "blocked" }).live === "unknown" && judge({ kind: "too_many_redirects" }).live === "unknown", "Timeout, error de red, dirección no permitida o demasiadas redirecciones: unknown");
  assert(judge(ok("%PDF-1.7", { contentType: "application/pdf" })).live === "unknown" && judge(ok("{}", { contentType: "application/json" })).live === "unknown" && judge(ok("", { contentType: "" })).live === "unknown", "Contenido que no es HTML: unknown");
  assert(judge(ok(UY_STORE, { status: 204 })).live === "alive" && judge(ok("", { status: 304, contentType: "text/html" })).live === "unknown", "Otros códigos: 2xx es alive; lo demás, unknown");
  const big = judge(ok(UY_STORE, { truncated: true }));
  assert(big.live === "alive" && big.readable && /página larga/.test(big.reason), "Página más larga que el tope: se lee el comienzo y sirve igual");
  assert([judge({ kind: "timeout" }), judge(ok("", { status: 403 })), judge(ok(ROBOTS))].every((v) => !v.readable && v.live !== "dead"), "«unknown» nunca se trata como caída ni se usa para decir que no es de Uruguay");

  const product = (availability: unknown) => ld({ "@type": "Product", name: "Termo", offers: { "@type": "Offer", price: 45, priceCurrency: "USD", availability } });
  assert(isOutOfStock(product("https://schema.org/OutOfStock")) && isOutOfStock(product("OutOfStock")) && isOutOfStock(product("http://schema.org/SoldOut")), "Datos de producto con OutOfStock o SoldOut: agotado");
  assert(!isOutOfStock(product("https://schema.org/InStock")) && !isOutOfStock(UY_STORE) && !isOutOfStock(product(null)), "InStock, o sin dato de disponibilidad: no agotado");
  assert(isOutOfStock(page("<p>x</p>", '<meta property="product:availability" content="out of stock">')) && isOutOfStock(page('<link itemprop="availability" href="https://schema.org/OutOfStock">')), "También desde meta product:availability o microdatos");
  assert(!isOutOfStock(ld({ "@type": "Product", offers: [{ availability: "https://schema.org/OutOfStock" }, { availability: "https://schema.org/InStock" }] })), "Si alguna variante tiene stock, no está agotado");
  const soldOut = judge(ok(product("https://schema.org/OutOfStock")));
  assert(soldOut.live === "alive" && soldOut.outOfStock, "Agotado es una tienda viva con el producto agotado: alive + outOfStock");

  console.log("--- Abrir páginas: redirecciones, IPs privadas y DNS ---");
  let n = fakeNet({}, { "https://tienda.com/p": html(UY_STORE) });
  let out = await openPage("https://tienda.com/p", n.net);
  assert(out.kind === "page" && out.status === 200 && out.html === UY_STORE && n.opened.length === 1 && n.opened[0].ip === "93.184.216.34", "Página pública: se resuelve el DNS y el pedido va a esa IP");
  assert(n.opened[0].maxBytes === 400 * 1024 && n.opened[0].timeoutMs > 0 && n.opened[0].timeoutMs <= 8000, "Cada pedido lleva el tope de 400 KB y los 8 s");

  for (const start of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://localhost/admin", "http://10.0.0.5/", "http://[::1]/", "https://tienda.com:8443/", "ftp://tienda.com/", "file:///etc/passwd"]) {
    n = fakeNet({}, {});
    out = await openPage(start, n.net);
    assert(out.kind === "blocked" && n.opened.length === 0 && n.resolved.length === 0, `URL inicial ${start}: no se resuelve ni se abre`);
  }
  for (const [label, ips] of [["una IP privada", ["10.0.0.7"]], ["la IP de metadatos", ["169.254.169.254"]], ["la propia máquina", ["127.0.0.1"]], ["::1", ["::1"]], ["una pública y una privada", ["93.184.216.34", "192.168.0.10"]], ["una IPv4 privada escondida en IPv6", ["::ffff:10.0.0.1"]]] as const) {
    n = fakeNet({ "tienda-rara.com": [...ips] }, { "https://tienda-rara.com/": html(UY_STORE) });
    out = await openPage("https://tienda-rara.com/", n.net);
    assert(out.kind === "blocked" && n.opened.length === 0, `DNS que resuelve a ${label}: no se abre`);
  }
  for (const target of ["http://169.254.169.254/", "http://localhost/", "http://127.0.0.1:80/", "http://[fd00::1]/", "https://tienda.com:8080/admin", "ftp://tienda.com/x", "//10.0.0.1/"]) {
    n = fakeNet({}, { "https://tienda.com/p": redirect(target) });
    out = await openPage("https://tienda.com/p", n.net);
    assert(out.kind === "blocked" && n.opened.length === 1 && n.urls().join() === "https://tienda.com/p", `Redirección a ${target}: se corta ahí, no se abre`);
  }
  n = fakeNet({ "interna.tienda.com": ["192.168.1.20"] }, { "https://tienda.com/p": redirect("https://interna.tienda.com/panel"), "https://interna.tienda.com/panel": html(UY_STORE) });
  out = await openPage("https://tienda.com/p", n.net);
  assert(out.kind === "blocked" && n.urls().join() === "https://tienda.com/p", "Redirección a un subdominio que resuelve a una IP privada: tampoco se abre (cada salto se revalida)");

  n = fakeNet({}, { "http://tienda.com/p": redirect("https://tienda.com/p", 301), "https://tienda.com/p": redirect("/producto/termo"), "https://tienda.com/producto/termo": redirect("https://www.tienda.com/producto/termo", 308), "https://www.tienda.com/producto/termo": html(UY_STORE) });
  out = await openPage("http://tienda.com/p", n.net);
  assert(out.kind === "page" && out.status === 200 && out.finalUrl === "https://www.tienda.com/producto/termo" && n.opened.length === 4 && n.resolved.length === 4, "Hasta 3 redirecciones dentro del mismo sitio: se siguen, resolviendo el DNS en cada salto");
  n = fakeNet({}, { "https://tienda.com/1": redirect("/2"), "https://tienda.com/2": redirect("/3"), "https://tienda.com/3": redirect("/4"), "https://tienda.com/4": redirect("/5"), "https://tienda.com/5": html(UY_STORE) });
  out = await openPage("https://tienda.com/1", n.net);
  assert(out.kind === "too_many_redirects" && n.opened.length === 4 && !n.urls().includes("https://tienda.com/5"), "A la cuarta redirección se corta");
  n = fakeNet({}, { "https://tienda.com/p": redirect("https://otratienda.com/oferta"), "https://otratienda.com/oferta": html(UY_STORE) });
  out = await openPage("https://tienda.com/p", n.net);
  assert(out.kind === "page" && out.finalUrl === "https://otratienda.com/oferta" && n.urls().join() === "https://tienda.com/p" && judgePage(out, "tienda.com").live === "dead", "Redirección a otro dominio: no se sigue, y la página queda como caída");

  n = fakeNet({ "noexiste.com": "ENOTFOUND" }, {});
  assert((await openPage("https://noexiste.com/", n.net)).kind === "no_dns" && n.opened.length === 0, "DNS que no resuelve: no_dns");
  n = fakeNet({ "dnsraro.com": "EAI_AGAIN" }, {});
  assert((await openPage("https://dnsraro.com/", n.net)).kind === "error", "DNS que falla por otro motivo: error (unknown), no caída");
  n = fakeNet({}, { "https://tienda.com/a": "ECONNREFUSED", "https://tienda.com/b": "TIMEOUT", "https://tienda.com/c": "ECONNRESET" });
  assert((await openPage("https://tienda.com/a", n.net)).kind === "refused" && (await openPage("https://tienda.com/b", n.net)).kind === "timeout" && (await openPage("https://tienda.com/c", n.net)).kind === "error", "Conexión rechazada, tiempo agotado y conexión cortada se distinguen");
  // El DNS también cuenta para el límite de tiempo. Se cuentan los timers para ver que no quede ninguno colgado.
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const pending = new Set<unknown>();
  const watchTimers = () => {
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const id = realSet(() => {
        pending.delete(id);
        fn(...args);
      }, ms);
      pending.add(id);
      return id;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
      pending.delete(id);
      realClear(id);
    }) as typeof clearTimeout;
  };
  const restoreTimers = () => {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  };
  // Red instantánea, sin la pausa de 5 ms de fakeNet: acá los únicos timers son los de openPage.
  const instant = (dnsError: boolean): NetDeps => ({
    resolve: async () => {
      if (dnsError) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return ["93.184.216.34"];
    },
    request: async () => ({ status: 200, contentType: "text/html", location: null, truncated: false, body: Buffer.from(UY_STORE) }),
  });
  n = fakeNet({}, { "https://tienda.com/p": html(UY_STORE) });
  let dnsCalls = 0;
  const hangingDns: NetDeps = { resolve: () => { dnsCalls++; return new Promise<string[]>(() => {}); }, request: n.net.request };
  watchTimers();
  let dnsOutcome: PageOutcome;
  let dnsMs: number;
  let pendingAfterHang: number;
  let pendingAfterOk: number;
  let pendingAfterDnsError: number;
  let okOutcome: PageOutcome;
  try {
    const dnsStart = Date.now();
    dnsOutcome = await openPage("https://tienda.com/p", hangingDns, { timeoutMs: 200 });
    dnsMs = Date.now() - dnsStart;
    pendingAfterHang = pending.size;
    // Con un DNS normal, el timer de la carrera se limpia apenas responde (acá el límite es de un minuto).
    okOutcome = await openPage("https://tienda.com/p", instant(false), { timeoutMs: 60_000 });
    pendingAfterOk = pending.size;
    await openPage("https://noexiste.com/", instant(true), { timeoutMs: 60_000 });
    pendingAfterDnsError = pending.size;
  } finally {
    restoreTimers();
  }
  assert(dnsOutcome.kind === "timeout" && dnsCalls === 1 && n.opened.length === 0, "Un DNS que nunca responde: timeout, sin llegar a abrir nada");
  assert(dnsMs >= 150 && dnsMs < 1500, `Vuelve dentro del límite de tiempo (${dnsMs} ms con un límite de 200)`);
  assert(okOutcome.kind === "page" && pendingAfterHang === 0 && pendingAfterOk === 0 && pendingAfterDnsError === 0, `No queda ningún timer colgado: ni cuando gana el reloj, ni cuando el DNS responde, ni cuando falla (${pendingAfterHang}, ${pendingAfterOk}, ${pendingAfterDnsError})`);
  assert(judgePage(dnsOutcome, "tienda.com").live === "unknown", "Ese caso queda «No se pudo verificar», no «Caída»");
  let dnsClock = 0;
  n = fakeNet({}, { "https://tienda.com/1": redirect("/2"), "https://tienda.com/2": html(UY_STORE) });
  const slowBoth: NetDeps = { resolve: async (h) => { dnsClock += 5000; return n.net.resolve(h); }, request: async (t) => { dnsClock += 4000; return n.net.request(t); } };
  assert((await openPage("https://tienda.com/1", slowBoth, { now: () => dnsClock })).kind === "timeout" && n.opened.length === 1 && n.resolved.length === 1, "El tiempo del DNS y el del pedido se suman: son 8 s en total por página");

  let clock = 0;
  n = fakeNet({}, { "https://tienda.com/1": redirect("/2"), "https://tienda.com/2": html(UY_STORE) });
  const slowNet: NetDeps = { resolve: n.net.resolve, request: async (t) => { clock += 9000; return n.net.request(t); } };
  assert((await openPage("https://tienda.com/1", slowNet, { now: () => clock })).kind === "timeout" && n.opened.length === 1, "Los 8 s son por página, contando sus redirecciones: pasado el tiempo no se hace otro pedido");

  console.log("--- Pedido real contra un servidor local de prueba (tope, tiempo, encabezados) ---");
  const seen: http.IncomingHttpHeaders[] = [];
  let sentBytes = 0;
  const local = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/grande") {
      res.writeHead(200, { "Content-Type": "text/html" });
      const chunk = Buffer.alloc(64 * 1024, "a");
      const send = () => {
        if (res.destroyed || sentBytes > 8 * 1024 * 1024) return res.end();
        sentBytes += chunk.length;
        res.write(chunk, () => setTimeout(send, 2));
      };
      return send();
    }
    if (req.url === "/lenta") return void setTimeout(() => res.end("tarde"), 3000);
    if (req.url === "/pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      return res.end(Buffer.alloc(100_000, 1));
    }
    if (req.url === "/gzip") {
      res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
      return res.end(zlib.gzipSync(UY_STORE));
    }
    if (req.url === "/bomba") {
      res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
      return res.end(zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, "a")));
    }
    if (req.url === "/salto") {
      res.writeHead(302, { Location: "http://169.254.169.254/" });
      return res.end("cuerpo de la redirección");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "sesion=abc" });
    res.end(UY_STORE);
  });
  await new Promise<void>((done) => local.listen(0, "127.0.0.1", done));
  const port = (local.address() as AddressInfo).port;
  // El nombre no existe: si el pedido llega, es porque se conectó a la IP indicada y no a lo que diga el DNS.
  const at = (path: string, extra: Partial<PageRequest> = {}): PageRequest => ({ url: new URL(`http://tienda-de-prueba.invalid:${port}${path}`), ip: "127.0.0.1", timeoutMs: 4000, maxBytes: VERIFY_LIMITS.maxBodyBytes, ...extra });
  try {
    const plainRes = await nodeRequest(at("/"));
    assert(plainRes.status === 200 && plainRes.body.toString("utf8") === UY_STORE && !plainRes.truncated, "El pedido se conecta a la IP ya resuelta, aunque el nombre no exista en el DNS");
    const h = seen[0];
    assert(h["user-agent"] === VERIFY_USER_AGENT && /UyMarginBot/.test(VERIFY_USER_AGENT) && h.host === `tienda-de-prueba.invalid:${port}`, "User-Agent fijo de UyMargin y Host del sitio pedido");
    assert(h.cookie === undefined && h.authorization === undefined && h.referer === undefined && h.origin === undefined && h["x-forwarded-for"] === undefined, "Sin cookies, sin Authorization, sin Referer ni datos del usuario");
    assert(Object.keys(h).sort().join() === "accept,accept-encoding,accept-language,connection,host,user-agent", `Los encabezados son solo los propios (${Object.keys(h).sort().join()})`);
    const bigRes = await nodeRequest(at("/grande"));
    await new Promise((r) => setTimeout(r, 300));
    assert(bigRes.truncated && bigRes.body.length === VERIFY_LIMITS.maxBodyBytes, `Tope de tamaño: se guardan exactamente 400 KB (${bigRes.body.length})`);
    assert(sentBytes < 4 * 1024 * 1024, `Al llegar al tope se corta la lectura: el servidor no llegó a mandar todo (${Math.round(sentBytes / 1024)} KB de 8 MB)`);
    const bomb = await nodeRequest(at("/bomba"));
    assert(bomb.truncated && bomb.body.length === VERIFY_LIMITS.maxBodyBytes, "Un cuerpo comprimido que se expande a 20 MB también se corta en 400 KB");
    const gz = await nodeRequest(at("/gzip"));
    assert(gz.body.toString("utf8") === UY_STORE && !gz.truncated, "Un cuerpo comprimido normal se lee bien");
    const pdf = await nodeRequest(at("/pdf"));
    assert(pdf.status === 200 && pdf.body.length === 0 && /pdf/.test(pdf.contentType), "Lo que no es HTML no se descarga");
    const hop = await nodeRequest(at("/salto"));
    assert(hop.status === 302 && hop.location === "http://169.254.169.254/" && hop.body.length === 0, "Una redirección se informa sin seguirla y sin leer su cuerpo");
    const started = Date.now();
    const slow = await nodeRequest(at("/lenta", { timeoutMs: 250 })).then(() => "respondió", (err: { code?: string }) => err.code);
    assert(slow === "TIMEOUT" && Date.now() - started < 1500, "Si la página no responde a tiempo, se corta");
    const refused = await nodeRequest({ ...at("/"), url: new URL("http://tienda-de-prueba.invalid:1/") }).then(() => "respondió", (err: { code?: string }) => err.code);
    assert(refused === "ECONNREFUSED", "Conexión rechazada: se informa como tal");
  } finally {
    await new Promise<void>((done) => local.close(() => done()));
  }

  console.log("--- Permisos firmados ---");
  const signer = createVerifySigner(SECRET);
  const token = signer.sign("https://tienda.com/p", "ana", NOW);
  assert(signer.open(token, "ana", NOW) === "https://tienda.com/p" && signer.open(token, "ana", NOW + VERIFY_LIMITS.tokenTtlMs - 1) === "https://tienda.com/p", "Un permiso válido devuelve su dirección, hasta 30 minutos después");
  assert(signer.open(token, "ana", NOW + VERIFY_LIMITS.tokenTtlMs) === null && VERIFY_LIMITS.tokenTtlMs === 30 * 60 * 1000, "A los 30 minutos vence");
  assert(signer.open(token, "beto", NOW) === null && signer.open(token, "", NOW) === null, "El permiso de un usuario no le sirve a otro");
  assert(createVerifySigner("otra-clave-distinta-0123456789abcdef0123").open(token, "ana", NOW) === null, "Firmado con otra clave no vale");
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify(["http://169.254.169.254/", NOW + 60_000])).toString("base64url");
  assert(signer.open(`${forged}.${signature}`, "ana", NOW) === null, "Cambiar la dirección de un permiso lo invalida: no se puede apuntar a otra URL");
  const longer = Buffer.from(JSON.stringify(["https://tienda.com/p", NOW + 10 * VERIFY_LIMITS.tokenTtlMs])).toString("base64url");
  assert(signer.open(`${longer}.${signature}`, "ana", NOW) === null, "Tampoco se puede estirar el vencimiento");
  for (const junk of ["", "abc", "a.b", "a.b.c", `${payload}.`, `.${signature}`, `${payload}.${signature}x`, "https://tienda.com/p", null, undefined, 7, {}, ["x"], "x".repeat(5000)]) {
    assert(signer.open(junk, "ana", NOW) === null, `Permiso inválido (${typeof junk === "string" ? junk.slice(0, 18) || "vacío" : String(junk)}): no abre nada`);
  }
  assert(!token.includes("ana") && !token.includes(SECRET) && !Buffer.from(payload, "base64url").toString().includes("ana") && cleanVerifyToken(token) === token, "El permiso no lleva la clave ni el id del usuario, y tiene la forma que acepta la pantalla");
  assert(cleanVerifyToken("https://x.com") === undefined && cleanVerifyToken("a.b.c") === undefined && cleanVerifyToken(7) === undefined && cleanVerifyToken("<script>.x") === undefined, "La pantalla descarta lo que no tiene forma de permiso");

  console.log("--- Verificación de un lote ---");
  n = fakeNet({ "caida.com": "ENOTFOUND" }, {
    "https://casadelmate.com/termo": html(UY_STORE),
    "https://outdoorgear.com/bottle": html(US_STORE),
    "https://outdoorgear.com/": html(US_STORE),
    "https://sinpistas.com/producto/1": html(page("<h1>Termo</h1><p>US$ 45</p>")),
    "https://sinpistas.com/": html(page("<p>Bienvenidos</p><footer>Montevideo. Envíos a todo el país.</footer>")),
    "https://vieja.com/producto": { status: 404, body: Buffer.from("no") },
    "https://protegida.com/p": html(ROBOTS, { status: 403 }),
    "https://enventa.com/": html(PARKED),
    "https://agotada.com.uy/p": html(page("<h1>Termo</h1>", '<script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/OutOfStock"}}</script>')),
  });
  let batch = await verifySites(["https://casadelmate.com/termo", "https://outdoorgear.com/bottle", "https://sinpistas.com/producto/1", "https://vieja.com/producto", "https://protegida.com/p", "https://enventa.com/", "https://caida.com/x", "https://agotada.com.uy/p"], { net: n.net });
  assert(batch[0].live === "alive" && batch[0].uruguay === "confirmed" && batch[0].signals.includes("teléfono +598") && batch[0].signals.includes("dirección en Montevideo"), "Tienda con dirección en Montevideo y +598: Activa, Uruguay confirmado");
  assert(batch[1].live === "alive" && batch[1].uruguay === "none" && batch[1].signals.length === 0, "El .com de EE.UU.: Activa, sin indicios de Uruguay");
  assert(batch[2].live === "alive" && batch[2].uruguay === "probable" && batch[2].signals.join() === "envíos a todo el país,Montevideo en el pie de página", `Sin indicios en el producto, se mira la página de inicio: probable (${batch[2].signals.join()})`);
  assert(batch[3].live === "dead" && batch[3].uruguay === null, "404: Caída");
  assert(batch[4].live === "unknown" && batch[4].uruguay === null && batch[4].signals.length === 0, "Protección contra robots: «No se pudo verificar», sin opinar si es de Uruguay");
  assert(batch[5].live === "dead" && batch[5].uruguay === null && batch[5].signals.length === 0 && batch[6].live === "dead", "Página parqueada (aunque nombre a Uruguay) y dominio que no resuelve: Caída, sin indicios");
  assert(batch[7].live === "alive" && batch[7].outOfStock === true, "Producto agotado: Activa + agotado");
  assert(n.maxActive() <= VERIFY_LIMITS.concurrency && n.maxActive() > 1, `Como mucho 4 páginas a la vez (${n.maxActive()})`);
  const perSite = new Map<string, number>();
  for (const u of n.urls()) perSite.set(new URL(u).hostname, (perSite.get(new URL(u).hostname) ?? 0) + 1);
  assert([...perSite.values()].every((c) => c <= VERIFY_LIMITS.maxRequestsPerSite) && perSite.get("outdoorgear.com") === 2 && perSite.get("sinpistas.com") === 2 && perSite.get("casadelmate.com") === 1, "Como mucho 2 pedidos por sitio: la página de inicio solo se abre si en el resultado no hay indicios");
  assert(perSite.get("vieja.com") === 1 && perSite.get("protegida.com") === 1 && perSite.get("enventa.com") === 1, "De una página caída o sin verificar no se abre la de inicio");

  n = fakeNet({}, { "https://tienda.com/a": html(page("<p>a</p>")), "https://tienda.com/b": html(page("<p>b</p>")), "https://tienda.com/c": html(page("<p>c</p>")), "https://tienda.com/": html(UY_STORE) });
  batch = await verifySites(["https://tienda.com/a", "https://tienda.com/b", "https://tienda.com/c"], { net: n.net });
  assert(n.opened.length === 2 && batch[2].live === "unknown", "Tres resultados del mismo sitio: se abren dos y el tercero queda sin verificar");

  const mlCalls: string[] = [];
  n = fakeNet({}, {});
  batch = await verifySites(
    ["https://www.amazon.com/dp/B0001", "https://www.mercadolibre.com.ar/x", "https://tienda.es/p", "https://articulo.mercadolibre.com.uy/MLU-123456789-termo-_JM", null, "http://169.254.169.254/", "notaurl"],
    { net: n.net, mercadoLibre: async (u) => { mlCalls.push(u); return { live: "alive", outOfStock: false, uruguay: null, signals: [] }; } }
  );
  assert(n.opened.length === 0 && n.resolved.length === 0, "Sitios de la lista del exterior, Mercado Libre, permisos inválidos y direcciones no permitidas: no se abre ni se resuelve nada");
  assert(batch.slice(0, 3).every((v) => v.live === "unknown") && batch[4] === UNKNOWN_VERDICT && batch[5].live === "unknown" && batch[6].live === "unknown", "Todos esos quedan «sin verificar»");
  assert(mlCalls.length === 1 && batch[3].live === "alive", "Mercado Libre Uruguay se consulta por su API, nunca abriendo la página");
  batch = await verifySites(["https://articulo.mercadolibre.com.uy/MLU-123456789-termo-_JM"], { net: n.net });
  assert(batch[0].live === "unknown" && n.opened.length === 0, "Sin cliente de la API, Mercado Libre queda «sin verificar» sin intentar nada");

  console.log("--- Mercado Libre Uruguay por su API ---");
  assert(JSON.stringify(mercadoLibreLookup("https://articulo.mercadolibre.com.uy/MLU-1489106628-stanley-termo-classic-original-_JM")) === '{"kind":"item","id":"MLU1489106628"}', "De articulo.mercadolibre.com.uy/MLU-… sale el id de la publicación");
  assert(JSON.stringify(mercadoLibreLookup("https://www.mercadolibre.com.uy/termo-stanley/p/MLU19754321?pdp_filters=item_id:MLU1")) === '{"kind":"product","id":"MLU19754321"}', "De …/p/MLU… sale el id del producto de catálogo");
  assert(mercadoLibreLookup("https://www.mercadolibre.com.uy/termo-stanley/up/MLUU2680513921") === null && mercadoLibreLookup("https://listado.mercadolibre.com.uy/termo") === null && mercadoLibreLookup("https://articulo.mercadolibre.com.ar/MLA-123456789-x") === null && mercadoLibreLookup("https://mercadolibre.com.uy.imitador.com/MLU-123456789") === null, "Direcciones sin id reconocible, de otro país o de un imitador: no se consulta nada");
  const apiCalls: { url: string; auth: string }[] = [];
  let apiReply: { status: number; body: unknown } | "boom" = { status: 200, body: { id: "MLU1", status: "active" } };
  const ml = createMercadoLibreChecker({
    token: async () => "TOKEN-DE-ML-DE-PRUEBA",
    fetch: async (url, init) => {
      apiCalls.push({ url, auth: init.headers.Authorization });
      if (apiReply === "boom") throw new Error("sin red");
      const { status, body } = apiReply;
      return { status, json: async () => body };
    },
  });
  const item = "https://articulo.mercadolibre.com.uy/MLU-1489106628-stanley-termo-_JM";
  assert((await ml(item)).live === "alive" && apiCalls[0].url === "https://api.mercadolibre.com/items/MLU1489106628?attributes=id,status" && apiCalls[0].auth === "Bearer TOKEN-DE-ML-DE-PRUEBA", "Publicación activa: Activa. La consulta va a api.mercadolibre.com, no a la página");
  apiReply = { status: 200, body: { status: "paused" } };
  const paused = await ml(item);
  assert(paused.live === "alive" && paused.outOfStock, "Publicación pausada: Agotado");
  apiReply = { status: 200, body: { status: "closed" } };
  assert((await ml(item)).live === "dead", "Publicación cerrada: Caída");
  apiReply = { status: 404, body: null };
  assert((await ml(item)).live === "dead", "La API dice 404: Caída");
  for (const reply of [{ status: 403, body: {} }, { status: 429, body: {} }, { status: 500, body: {} }, { status: 200, body: { status: "under_review" } }, { status: 200, body: null }, "boom"] as const) {
    apiReply = reply;
    assert((await ml(item)).live === "unknown", `La API no dice nada claro (${reply === "boom" ? "sin red" : `${reply.status}`}): «sin verificar»`);
  }
  const before = apiCalls.length;
  assert((await ml("https://www.mercadolibre.com.uy/termo/up/MLUU2680513921")).live === "unknown" && apiCalls.length === before, "Sin id reconocible no se consulta la API");
  assert((await createMercadoLibreChecker({ token: async () => null, fetch: async () => ({ status: 200, json: async () => ({ status: "active" }) }) })(item)).live === "unknown", "Sin acceso a la API de Mercado Libre: «sin verificar»");

  console.log("--- Lo que valida la pantalla ---");
  const fromServer = parseVerifyResponse({ ok: true, results: [{ live: "alive", outOfStock: false, uruguay: "confirmed", signals: ["dirección en Montevideo", "teléfono +598"] }, { live: "dead" }, { live: "unknown", uruguay: "confirmed", signals: ["RUT"] }] }, 3);
  assert(fromServer !== null && signalsPhrase(fromServer[0]) === "Uruguay: dirección en Montevideo, teléfono +598" && fromServer[1].live === "dead", "Respuesta válida: un veredicto por sitio y la frase «Uruguay: dirección en Montevideo, teléfono +598»");
  assert(fromServer?.[2].uruguay === null && fromServer[2].signals.length === 0, "Un sitio «sin verificar» nunca trae opinión sobre Uruguay");
  const dirty = parseVerifyResponse({ ok: true, results: [{ live: "alive", outOfStock: "sí", uruguay: "seguro", signals: ['<img src=x onerror="alert(1)">', "x".repeat(200), 7, "javascript:alert(1)", "teléfono +598", "a", "b", "c", "d", "e"] }, "texto"] }, 2);
  assert(dirty !== null && dirty[0].signals.join() === "teléfono +598", `Indicios con etiquetas, demasiado largos, de una letra o que no son texto: se descartan (${dirty?.[0].signals.join()})`);
  assert(dirty?.[0].signals.every((s) => !/[<>:="]/.test(s)) === true && dirty[0].signals.length <= VERIFY_LIMITS.maxSignals && dirty[0].uruguay === null && dirty[0].outOfStock === false && dirty[1].live === "unknown", "Lo que llega a la pantalla es texto plano, corto y acotado");
  assert(parseVerifyResponse({ ok: true, results: [] }, 2) === null && parseVerifyResponse({ ok: false }, 0) === null && parseVerifyResponse(null, 1) === null && parseVerifyResponse({ ok: true, results: "x" }, 1) === null, "Una respuesta con otra forma, o con otra cantidad de sitios, se rechaza");
  assert(VERIFY_MESSAGES.alive === "Activa" && VERIFY_MESSAGES.outOfStock === "Agotado" && VERIFY_MESSAGES.unknown === "No se pudo verificar" && VERIFY_MESSAGES.checking === "Verificando…" && VERIFY_MESSAGES.failed === "No se pudo verificar los sitios", "Los rótulos de la pantalla son los pedidos");

  console.log("--- Límite de uso ---");
  assert(RATE_RULES.verify.scope === "verify" && RATE_RULES.verify.perMinute === 6 && RATE_RULES.verify.perDay === 60, "Scope propio «verify»: 6 por minuto y 60 por día");
  assert(new Set(Object.values(RATE_RULES).map((r) => r.scope)).size === Object.keys(RATE_RULES).length, "Ningún otro límite comparte ese contador");
  const minuteStore = createMemoryRateStore();
  const minute = [];
  for (let i = 0; i < 7; i++) minute.push(await checkRate(minuteStore, "ana", RATE_RULES.verify, NOW));
  assert(minute.slice(0, 6).every((d) => d.ok) && minute[6].ok === false && (await checkRate(minuteStore, "beto", RATE_RULES.verify, NOW)).ok, "Por minuto y por usuario: pasan 6 y la séptima se frena");
  const dayStore = createMemoryRateStore();
  let dayOk = 0;
  for (let i = 0; i < 60; i++) if ((await checkRate(dayStore, "ana", RATE_RULES.verify, NOW + i * 60_000)).ok) dayOk++;
  const dayBlocked = await checkRate(dayStore, "ana", RATE_RULES.verify, NOW + 60 * 60_000);
  assert(dayOk === 60 && dayBlocked.ok === false && dayBlocked.window === "día", "Por día: pasan 60 y la siguiente se frena hasta el otro día");
  const migration = fs.readFileSync(new URL("../supabase/migrations/20261008120000_ronda5_acceso.sql", import.meta.url), "utf8");
  assert(/p_scope text/.test(migration) && /scope text not null/.test(migration) && !/check\s*\(\s*scope/i.test(migration), "El contador de Supabase guarda el scope como texto libre: el scope nuevo no necesita migración");

  console.log("--- Endpoint (red simulada), sin registrar direcciones ni contenido ---");
  const logs: string[] = [];
  const consoleKeys = ["log", "info", "warn", "error", "debug"] as const;
  const originalConsole = Object.fromEntries(consoleKeys.map((k) => [k, console[k]])) as Record<(typeof consoleKeys)[number], (...a: unknown[]) => void>;
  const routeNet = fakeNet({ "privada.com": ["10.0.0.9"] }, {
    "https://casadelmate.com/termo": html(UY_STORE),
    "https://outdoorgear.com/bottle": html(US_STORE),
    "https://outdoorgear.com/": html(US_STORE),
    "https://vieja.com/producto": { status: 404 },
    "https://salta.com/p": redirect("http://169.254.169.254/latest/meta-data/"),
    "https://privada.com/": html(UY_STORE),
  });
  let configured = true;
  let user = "ana";
  let clockNow = NOW;
  const limiterStore = createMemoryRateStore();
  const rateLimit = createRateLimiter({ store: () => limiterStore, fallback: limiterStore, userId: () => user, now: () => clockNow });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.post("/api/verify-sites", ...createVerifySitesRoute({ signer: () => (configured ? signer : null), limiter: rateLimit(RATE_RULES.verify), userId: () => user, net: routeNet.net, now: () => clockNow }));
  const sign = (_res: unknown, url: string) => (configured ? signer.sign(url, user, clockNow) : null);
  const lensItems = [{ url: "https://casadelmate.com/termo", title: "Termo", source: "", thumbnail: "", price: null, currency: null }, { url: "https://www.amazon.com/dp/1", title: "Termo", source: "", thumbnail: "", price: null, currency: null }, { url: "https://www.instagram.com/p/x/", title: "Termo", source: "", thumbnail: "", price: null, currency: null }, { url: "https://tienda.com.uy/termo", title: "Termo", source: "", thumbnail: "", price: null, currency: null }];
  const visualCache = createVisualCache();
  app.post("/api/visual-search", ...createVisualSearchRoute({ lens: () => async () => lensItems, limiter: (_q, _s, next) => next(), cache: visualCache, sign }));
  app.post("/api/web-sellers", ...createWebSellersRoute({ search: () => async () => [{ url: "https://tienda.com.uy/termo", title: "Termo", description: "" }, { url: "https://www.amazon.com/dp/1", title: "Termo", description: "" }, { url: "https://www.youtube.com/watch?v=1", title: "Video", description: "" }, { url: "https://dudosa.com/termo", title: "Termo", description: "" }], limiter: (_q, _s, next) => next(), sign }));
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const responses: string[] = [];
  const post = async (path: string, body: unknown, type = "application/json") => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": type }, body: typeof body === "string" || Buffer.isBuffer(body) ? (body as BodyInit) : JSON.stringify(body) });
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
  const verify = (tokens: unknown) => post("/api/verify-sites", { tokens });
  const t = (url: string, who = "ana", when = NOW) => signer.sign(url, who, when);
  for (const k of consoleKeys) console[k] = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  const r: Record<string, Awaited<ReturnType<typeof post>>> = {};
  const opensAt: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<Awaited<ReturnType<typeof post>>>) => {
    const beforeOpens = routeNet.opened.length + routeNet.resolved.length;
    r[name] = await run();
    opensAt[name] = routeNet.opened.length + routeNet.resolved.length - beforeOpens;
  };
  let visual: any = null;
  let visualAgain: any = null;
  let visualOther: any = null;
  let web: any = null;
  let visualNoSecret: any = null;
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
  try {
    await step("ok", () => verify([t("https://casadelmate.com/termo"), t("https://outdoorgear.com/bottle"), t("https://vieja.com/producto"), t("https://salta.com/p"), t("https://privada.com/")]));
    await step("freeUrl", () => post("/api/verify-sites", { urls: ["https://casadelmate.com/termo"], tokens: ["https://casadelmate.com/termo"] }));
    await step("plainUrls", () => post("/api/verify-sites", { url: "http://169.254.169.254/", urls: ["http://169.254.169.254/"] }));
    await step("expired", () => verify([t("https://casadelmate.com/termo", "ana", NOW - VERIFY_LIMITS.tokenTtlMs - 1)]));
    await step("otherUser", () => verify([t("https://casadelmate.com/termo", "beto")]));
    await step("garbage", () => verify(["no.es", "", 7, null]));
    await step("empty", () => verify([]));
    await step("notArray", () => verify("https://casadelmate.com/termo"));
    await step("tooMany", () => verify(Array.from({ length: 9 }, () => t("https://casadelmate.com/termo"))));
    await step("mixed", () => verify([t("https://casadelmate.com/termo", "beto"), t("https://casadelmate.com/termo"), "basura"]));
    configured = false;
    await step("noSecret", () => verify([t("https://casadelmate.com/termo")]));
    visualNoSecret = (await post("/api/visual-search", JPEG, "image/jpeg")).data;
    configured = true;

    visual = (await post("/api/visual-search", JPEG, "image/jpeg")).data;
    visualAgain = (await post("/api/visual-search", JPEG, "image/jpeg")).data;
    user = "beto";
    visualOther = (await post("/api/visual-search", JPEG, "image/jpeg")).data;
    user = "ana";
    web = (await post("/api/web-sellers", { query: "termo stanley" })).data;
    await step("fromVisual", () => verify(visual.results.map((m: any) => m.verifyToken).filter(Boolean)));

    user = "frecuente";
    clockNow = NOW + 5 * 60_000;
    for (let i = 0; i < RATE_RULES.verify.perMinute; i++) await verify([t("https://casadelmate.com/termo", "frecuente", clockNow)]);
    await step("rate", () => verify([t("https://casadelmate.com/termo", "frecuente", clockNow)]));
    await step("rateInvalid", () => verify(["basura"]));
    user = "ana";
    clockNow = NOW;
  } finally {
    for (const k of consoleKeys) console[k] = originalConsole[k];
    await new Promise<void>((done) => server.close(() => done()));
  }

  const okData = r.ok.data;
  assert(r.ok.status === 200 && okData.ok === true && okData.results.length === 5 && Object.keys(okData).sort().join() === "ok,results", "Permisos válidos: 200 con un veredicto por sitio, en el mismo orden");
  assert(okData.results[0].live === "alive" && okData.results[0].uruguay === "confirmed" && okData.results[1].uruguay === "none" && okData.results[2].live === "dead", "Tienda de Uruguay confirmada, .com de EE.UU. sin indicios y página caída");
  assert(okData.results[3].live === "unknown" && okData.results[4].live === "unknown" && !routeNet.urls().some((u) => /169\.254|privada\.com/.test(u)), "Redirección a la IP de metadatos y DNS a una IP privada: no se abren, quedan «sin verificar»");
  assert(Object.keys(okData.results[0]).sort().join() === "live,outOfStock,signals,uruguay", "Cada veredicto trae solo live, outOfStock, uruguay y signals: ni la dirección ni contenido");
  for (const k of ["freeUrl", "plainUrls", "expired", "otherUser", "garbage", "empty", "notArray", "tooMany"]) {
    assert(r[k].status === 400 && r[k].data.code === "VERIFY_INVALID_TOKEN" && opensAt[k] === 0, `Sin permiso válido («${k}»): 400 y no se abre ni se resuelve nada`);
  }
  assert(r.mixed.status === 200 && r.mixed.data.results.map((v: any) => v.live).join() === "unknown,alive,unknown" && opensAt.mixed === 2, "Con permisos mezclados solo se abre el válido; los demás quedan «sin verificar»");
  assert(r.noSecret.status === 503 && r.noSecret.data.code === "VERIFY_NOT_CONFIGURED" && r.noSecret.data.message === VERIFY_MESSAGES.notConfigured && opensAt.noSecret === 0, "Sin VERIFY_SECRET: VERIFY_NOT_CONFIGURED, sin abrir nada");
  assert(visualNoSecret.ok === true && visualNoSecret.results.every((m: any) => !("verifyToken" in m)), "Sin VERIFY_SECRET la búsqueda sigue funcionando, sin permisos");

  const tokenOf = (data: any, site: string) => data.results.find((m: any) => m.site === site)?.verifyToken;
  assert(typeof tokenOf(visual, "casadelmate.com") === "string" && typeof tokenOf(visual, "tienda.com.uy") === "string" && tokenOf(visual, "amazon.com") === undefined && tokenOf(visual, "instagram.com") === undefined, "/api/visual-search firma un permiso por tienda visible; ni los ocultos del exterior ni las redes llevan permiso");
  assert(signer.open(tokenOf(visual, "casadelmate.com"), "ana", NOW) === "https://casadelmate.com/termo" && signer.open(tokenOf(visual, "casadelmate.com"), "beto", NOW) === null, "Ese permiso es de la dirección del resultado y de ese usuario");
  assert(visualAgain.cached === true && typeof tokenOf(visualAgain, "casadelmate.com") === "string" && visualOther.cached === true && signer.open(tokenOf(visualOther, "casadelmate.com"), "beto", NOW) === "https://casadelmate.com/termo" && signer.open(tokenOf(visualOther, "casadelmate.com"), "ana", NOW) === null, "Una respuesta que sale de la memoria se firma de nuevo para quien la pide");
  assert(visualCache.size() === 1 && !JSON.stringify(visualCache.get(imageHash(JPEG))).includes("verifyToken"), "Los permisos no quedan en la memoria de respuestas");
  assert(typeof tokenOf(web, "tienda.com.uy") === "string" && typeof tokenOf(web, "dudosa.com") === "string" && tokenOf(web, "amazon.com") === undefined && tokenOf(web, "youtube.com") === undefined, "/api/web-sellers también: permiso para tiendas visibles, no para el exterior ni para lo que no es tienda");
  assert(parseVisualResponse(visual)?.results.find((m) => m.site === "casadelmate.com")?.verifyToken === tokenOf(visual, "casadelmate.com") && parseWebSellersResponse(web)?.results.find((m) => m.site === "dudosa.com")?.verifyToken === tokenOf(web, "dudosa.com"), "La pantalla conserva el permiso al validar la respuesta");
  assert(r.fromVisual.status === 200 && r.fromVisual.data.results.length === 2 && r.fromVisual.data.results.some((v: any) => v.live === "alive" && v.uruguay === "confirmed"), "Con los permisos de una búsqueda se verifica");
  assert(r.rate.status === 429 && r.rate.data.code === "RATE_LIMITED" && r.rate.retryAfter !== null && /6 usos por minuto/.test(r.rate.data.message) && opensAt.rate === 0, "Pasado el tope por minuto: 429 con Retry-After, sin abrir nada");
  assert(r.rateInvalid.status === 400, "Un pedido sin permisos válidos se rechaza antes de contar un uso");
  for (const k of Object.keys(r)) {
    if (r[k].status !== 200) assert(r[k].data?.ok === false && typeof r[k].data.message === "string" && r[k].data.message === r[k].data.error, `Error «${k}»: JSON con ok:false y el mismo texto en message y error`);
  }

  const leaked = (text: string) => text.includes(MARKER) || /Casa del Mate|18 de Julio|Outdoor Gear|Portland/.test(text);
  assert(logs.length > 0 && logs.some((l) => /sitios: 5, activas: 2, caídas: 1, sin verificar: 2/.test(l)), `Queda un registro mínimo: cantidades por estado (${logs[0]})`);
  assert(!logs.some((l) => /https?:\/\/|casadelmate|outdoorgear|vieja\.com|salta\.com|privada\.com|169\.254/.test(l)), "Ninguna dirección ni dominio queda en los logs");
  assert(!logs.some(leaked) && !responses.some((t2) => t2.includes(MARKER)), "Ningún contenido de las páginas queda en los logs ni vuelve en las respuestas");
  assert(!logs.some((l) => l.includes(SECRET)) && !responses.some((t2) => t2.includes(SECRET)), "La clave de firma no aparece en logs ni en respuestas");
  assert(logs.every((l) => l.length < 160), "Cada línea de log es corta");
  assert(!responses.filter((t2) => /"live"/.test(t2)).some((t2) => /https?:\/\//.test(t2)), "Las respuestas de la verificación no devuelven direcciones");

  const source = fs.readFileSync(new URL("../server/verifySites.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert(!/from "node:fs"|from "fs"|writeFile|appendFile|createWriteStream|supabase|cloud\.js/i.test(code), "server/verifySites.ts no usa el sistema de archivos ni Supabase: no guarda nada");
  const logLines = code.split("\n").filter((l) => /console\./.test(l));
  assert(logLines.length > 0 && logLines.every((l) => !/url|html|body|token|secret|host|signals/i.test(l)), "Ningún console.* recibe direcciones, contenido, permisos ni la clave");
  assert(!/\beval\(|new Function|innerHTML|dangerouslySetInnerHTML|vm\./.test(code + fs.readFileSync(new URL("../src/lib/web/verify.ts", import.meta.url), "utf8")), "El contenido de las páginas nunca se ejecuta");
  const ui = ["SiteVerification.tsx", "VisualMatches.tsx", "WebSellers.tsx"].map((f) => fs.readFileSync(new URL(`../src/components/search/${f}`, import.meta.url), "utf8")).join("\n");
  assert(!/dangerouslySetInnerHTML|innerHTML/.test(ui), "La pantalla no inserta HTML: los textos van como texto plano");
  assert(!/cookie|req\.headers/i.test(code), "El verificador no lee ni reenvía cookies ni encabezados del pedido del usuario");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { functions: Record<string, { maxDuration: number }> };
  assert(vercel.functions["api/verify-sites.ts"]?.maxDuration === 60 && fs.existsSync(new URL("../api/verify-sites.ts", import.meta.url)), "La función de Vercel existe y tiene 60 s");
  assert(VERIFY_LIMITS.maxSites === 8 && VERIFY_LIMITS.maxRedirects === 3 && VERIFY_LIMITS.pageTimeoutMs === 8000 && VERIFY_LIMITS.maxBodyBytes === 400 * 1024 && VERIFY_LIMITS.concurrency === 4 && VERIFY_LIMITS.maxRequestsPerSite === 2, "Límites: 8 sitios, 3 redirecciones, 8 s, 400 KB, 4 en paralelo, 2 pedidos por sitio");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de verificación de sitios`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
