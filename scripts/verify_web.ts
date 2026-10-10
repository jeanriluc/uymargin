// Tests de "En la web (Uruguay)": consulta, parser de la respuesta de Apify, clasificación de dominios,
// lista final, códigos de error, límite de uso y memoria. La red es siempre simulada: no hay ninguna
// llamada real a Apify, y no se importa server/app.ts (que lee .env) ni Supabase.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES } from "../server/rateLimit";
import {
  APIFY_SEARCH_URL,
  WEB_CACHE,
  WEB_SEARCH_TIMEOUT_MS,
  WebSearchError,
  createApifySearcher,
  createWebCache,
  createWebSellersRoute,
  searchInput,
  type FetchLike,
} from "../server/webSellers";
import {
  WEB_LIMITS,
  WEB_MESSAGES,
  buildSearchQuery,
  buildWebSellers,
  classifyUruguay,
  cleanWebQuery,
  googleSearchUrl,
  FOREIGN_BRANDS,
  FOREIGN_SITES,
  FOREIGN_SUFFIXES,
  googleShoppingUrl,
  isForeignSite,
  isInternationalStore,
  isMainSeller,
  isNonStore,
  isUruguayDomain,
  looksLikeImitation,
  normalizeHost,
  parseSearchItems,
  parseWebSellersResponse,
  safeHttpsUrl,
  siteDomain,
  webQueryKey,
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

// Casos armados a mano con la forma del actor: entradas rotas, enlaces inseguros, sitios que no son tiendas
// y dominios inventados para probar la clasificación. La respuesta real está en scripts/fixtures/.
const SYNTHETIC: unknown = [
  {
    "searchQuery": {
      "term": "Termo Stanley Classic 1 litro comprar Uruguay",
      "url": "http://www.google.com.uy/search?q=Termo+Stanley+Classic+1+litro+comprar+Uruguay&gl=uy&hl=es",
      "device": "DESKTOP",
      "page": 1,
      "type": "SEARCH",
      "domain": "google.com.uy",
      "countryCode": "UY",
      "languageCode": "es",
      "locationUule": null
    },
    "relatedQueries": [
      {
        "title": "termo stanley precio uruguay",
        "url": "https://www.google.com.uy/search?q=termo+stanley+precio+uruguay"
      }
    ],
    "paidResults": [
      {
        "title": "Anuncio que no debe aparecer",
        "url": "https://anuncio-pago.com.uy/termo",
        "displayedUrl": "anuncio-pago.com.uy",
        "description": "Resultado pago: no es orgánico.",
        "type": "paid",
        "adPosition": 1
      }
    ],
    "paidProducts": [],
    "organicResults": [
      {
        "title": "Termo Stanley Classic 1 Litro - Ferretería Ejemplo",
        "url": "https://www.ferreteria-ejemplo.com.uy/productos/termo-stanley-classic-1l",
        "displayedUrl": "https://www.ferreteria-ejemplo.com.uy › productos",
        "description": "Termo Stanley Classic de 1 litro, acero inoxidable. Envíos a todo el país. $ 2.490.",
        "emphasizedKeywords": [
          "Termo Stanley Classic",
          "1 litro"
        ],
        "siteLinks": [],
        "productInfo": {},
        "type": "organic",
        "position": 1
      },
      {
        "title": "Termo Stanley Classic 1 Litro | MercadoLibre",
        "url": "https://listado.mercadolibre.com.uy/termo-stanley-classic-1-litro",
        "displayedUrl": "https://listado.mercadolibre.com.uy › termo-stanley",
        "description": "Envíos gratis en el día. Comprá Termo Stanley Classic 1 Litro en cuotas sin interés.",
        "emphasizedKeywords": [
          "Termo Stanley Classic 1 Litro"
        ],
        "siteLinks": [],
        "productInfo": {},
        "type": "organic",
        "position": 2
      },
      {
        "title": "Termo Stanley Classic 1 L Verde",
        "url": "https://articulo.mercadolibre.com.uy/MLU-600000001-termo-stanley-classic-1-l-verde",
        "displayedUrl": "https://articulo.mercadolibre.com.uy › MLU-600000001",
        "description": "Termo Stanley original, 1 litro, color verde.",
        "type": "organic",
        "position": 3
      },
      {
        "title": "Termo Stanley Classic 1 L Negro",
        "url": "https://articulo.mercadolibre.com.uy/MLU-600000002-termo-stanley-classic-1-l-negro",
        "displayedUrl": "https://articulo.mercadolibre.com.uy › MLU-600000002",
        "description": "Tercer resultado del mismo dominio: no debe mostrarse.",
        "type": "organic",
        "position": 4
      },
      {
        "title": "Stanley Classic 1L - Tienda Outdoor",
        "url": "https://tiendaoutdoor-ejemplo.com/uy/termo-stanley-classic-1l",
        "displayedUrl": "https://tiendaoutdoor-ejemplo.com › uy",
        "description": "Termo clásico con tapa vaso.",
        "type": "organic",
        "position": 5
      },
      {
        "title": "Termos Stanley con envío a Uruguay",
        "url": "https://importadora-ejemplo.com/termos/stanley-classic",
        "displayedUrl": "https://importadora-ejemplo.com › termos",
        "description": "Compralo desde Montevideo y recibilo en tu casa.",
        "type": "organic",
        "position": 6
      },
      {
        "title": "Stanley Classic Vacuum Bottle 1L",
        "url": "https://es.aliexpress.com/item/1005000000001.html",
        "displayedUrl": "https://es.aliexpress.com › item",
        "description": "Envío a Uruguay disponible.",
        "type": "organic",
        "position": 7
      },
      {
        "title": "Termo Stanley Classic 1 litro - Oferta",
        "url": "https://mercadolibre.com.uy.ofertas-ejemplo.com/termo-stanley",
        "displayedUrl": "https://mercadolibre.com.uy.ofertas-ejemplo.com",
        "description": "Oferta en Uruguay.",
        "type": "organic",
        "position": 8
      },
      {
        "title": "Termo Stanley Classic: review completo - YouTube",
        "url": "https://www.youtube.com/watch?v=abc123",
        "displayedUrl": "https://www.youtube.com › watch",
        "description": "Probamos el termo Stanley Classic de 1 litro en Uruguay.",
        "type": "organic",
        "position": 9
      },
      {
        "title": "Stanley (marca) - Wikipedia, la enciclopedia libre",
        "url": "https://es.wikipedia.org/wiki/Stanley_(marca)",
        "displayedUrl": "https://es.wikipedia.org › wiki",
        "description": "Stanley es una marca de termos.",
        "type": "organic",
        "position": 10
      },
      {
        "title": "Los mejores termos para el mate - El País",
        "url": "https://www.elpais.com.uy/vida-actual/los-mejores-termos-para-el-mate",
        "displayedUrl": "https://www.elpais.com.uy › vida-actual",
        "description": "Nota sobre termos en Uruguay.",
        "type": "organic",
        "position": 11
      },
      {
        "title": "Cómo elegir un termo - Blog de Tienda Ejemplo",
        "url": "https://tienda-ejemplo.com.uy/blog/como-elegir-un-termo",
        "displayedUrl": "https://tienda-ejemplo.com.uy › blog",
        "description": "Consejos para elegir un termo.",
        "type": "organic",
        "position": 12
      },
      {
        "title": "Sitio sin https",
        "url": "http://sitio-viejo.com.uy/termo",
        "displayedUrl": "sitio-viejo.com.uy",
        "description": "Enlace http: se descarta.",
        "type": "organic",
        "position": 13
      },
      {
        "title": "Enlace a una IP",
        "url": "https://192.168.1.20/termo",
        "description": "Se descarta.",
        "type": "organic",
        "position": 14
      },
      {
        "title": "Sin enlace",
        "description": "Entrada sin url: se descarta.",
        "type": "organic",
        "position": 15
      },
      {
        "title": "Enlace que no es texto",
        "url": {
          "href": "https://ejemplo.uy"
        },
        "type": "organic",
        "position": 16
      },
      {
        "url": "https://solo-enlace-ejemplo.com.uy/termo-stanley",
        "type": "organic",
        "position": 17
      },
      null,
      "texto suelto"
    ],
    "peopleAlsoAsk": []
  }
];

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
    const c = classifyUruguay(host, false);
    assert(isUruguayDomain(host) && c.uruguay === "confirmado" && !c.international, `${host}: confirmado por el dominio, aunque el resultado no nombre a Uruguay`);
  }
  for (const fake of ["mercadolibre.com.uy.evil.com", "ejemplo.uy.com", "uy.ejemplo.com", "tienda-uy.com", "ejemplouy.com", "ejemplo.uyx", "ejemplo.com.uy.tk"]) {
    const c = classifyUruguay(fake, true);
    assert(!isUruguayDomain(fake) && c.uruguay !== "confirmado", `Dominio falso ${fake}: NO queda confirmado aunque el resultado nombre a Uruguay`);
  }
  for (const host of ["aliexpress.com", "es.aliexpress.com", "temu.com", "www.temu.com".replace("www.", ""), "amazon.com", "amazon.es", "amazon.com.mx", "amazon.co.uk", "shein.com", "us.shein.com", "ebay.com", "alibaba.com", "spanish.alibaba.com", "dhgate.com", "walmart.com", "etsy.com"]) {
    const c = classifyUruguay(host, true);
    assert(isInternationalStore(host) && c.international && c.uruguay === "no_confirmado", `${host}: internacional, sin confirmar aunque el resultado diga que envía a Uruguay`);
  }
  for (const host of ["amazon.evil.com", "aliexpress.com.tienda-falsa.net", "miamazon.com", "amazonas.com", "temu.tiendas.com", "ebayuruguay.com"]) {
    assert(!isInternationalStore(host), `${host}: no se toma por la tienda global (la marca tiene que ser el dominio principal)`);
  }
  for (const fake of ["mercadolibre.com.uy.evil.com", "ejemplo.uy.com", "tienda.com.ar.ofertas.net"]) {
    assert(looksLikeImitation(fake) && classifyUruguay(fake, true).uruguay === "no_confirmado" && !classifyUruguay(fake, true).international, `${fake}: lleva adentro la terminación de otro dominio, queda «no confirmado»`);
  }
  assert(!looksLikeImitation("tienda.ejemplo.com.uy") && !looksLikeImitation("tiendaejemplo.com") && !looksLikeImitation("uy.ejemplo.com") && !looksLikeImitation("comercio.net"), "Un dominio común no se toma por imitación");
  assert(!isInternationalStore("amazon.com.uy") && classifyUruguay("amazon.com.uy", false).uruguay === "confirmado", "Un .uy manda aunque lleve el nombre de una tienda global");
  assert(classifyUruguay("tiendaejemplo.com", true).uruguay === "probable" && !classifyUruguay("tiendaejemplo.com", true).international, "Sitio que no es .uy y cuyo resultado nombra a Uruguay: «probable», nunca «confirmado»");
  assert(classifyUruguay("tiendaejemplo.com", false).uruguay === "no_confirmado", "Sitio que no es .uy y no nombra a Uruguay: «no confirmado»");

  console.log("--- Sitios del exterior que no se muestran ---");
  const asked = [".com.mx", ".mx", ".cl", ".com.ar", ".ar", ".com.br", ".br", ".bn", ".es", ".us", ".it", ".fr", ".com.co", ".com.pe", ".com.py", ".com.ve", ".de", ".uk", ".co.uk", ".pt", ".ca", ".au", ".in", ".cn", ".jp"];
  assert(asked.every((suffix) => FOREIGN_SUFFIXES.includes(suffix)), "La lista tiene todas las terminaciones pedidas");
  for (const suffix of FOREIGN_SUFFIXES) {
    assert(isForeignSite(`tienda${suffix}`) && isForeignSite(`www.ofertas.tienda${suffix}`.replace(/^www\./, "")), `Terminación ${suffix}: se oculta el dominio y sus subdominios`);
  }
  for (const site of ["etsy.com", "ebay.com", "walmart.com", "wayfair.com", "temu.com", "aliexpress.com", "alibaba.com", "1stdibs.com", "falabella.com", "mercadolibre.com.ar", "mercadolibre.com.mx", "mercadolibre.cl", "mercadolibre.com.br", "amazon.com", "idealo.de"]) {
    assert(isForeignSite(site) && isForeignSite(`es.${site}`) && isForeignSite(`articulo.tienda.${site}`), `${site}: se oculta, también con subdominio`);
  }
  for (const site of ["amazon.es", "amazon.com.mx", "amazon.co.uk", "amazon.nl", "ebay.es", "ebay.co.uk", "ebay.nl", "idealo.es", "idealo.at", "www.amazon.com".replace("www.", "smile.")]) {
    assert(isForeignSite(site), `${site}: amazon.*, ebay.* e idealo.* se ocultan con cualquier terminación`);
  }
  assert(FOREIGN_SITES.includes("etsy.com") && FOREIGN_BRANDS.join() === "amazon,ebay,idealo", "La lista de sitios y la de marcas están exportadas, en un solo lugar");
  for (const site of ["mercadolibre.com.uy", "articulo.mercadolibre.com.uy", "listado.mercadolibre.com.uy", "tienda.com.uy", "stanley1913.uy", "amazon.uy", "ebay.com.uy", "etsy.com.uy", "walmart.uy", "idealo.uy", "falabella.com.uy", "tienda.es.uy"]) {
    assert(!isForeignSite(site), `${site}: un .uy nunca se oculta`);
  }
  for (const site of ["tienda.com", "vntg.com", "yerbascalzada.com", "matesuru.com", "tienda.co", "tienda.io", "tienda.net", "instagram.com", "amazonas.com", "miebay.com", "walmart.com.tienda.net", "notetsy.com", "tiendaes.com", "tienda.nl"]) {
    assert(!isForeignSite(site), `${site}: no está en la lista, no se oculta`);
  }
  const mixedList = buildWebSellers([
    { url: "https://tienda.com.uy/termo", title: "Termo", description: "" },
    { url: "https://www.mercadolibre.com.ar/termo", title: "Termo - envíos a Uruguay", description: "" },
    { url: "https://www.amazon.com/termo", title: "Termo", description: "" },
    { url: "https://tienda.com/termo", title: "Termo", description: "" },
  ]);
  assert(mixedList.filter((x) => isForeignSite(x.site)).map((x) => x.site).join() === "mercadolibre.com.ar,amazon.com" && mixedList.filter((x) => !isForeignSite(x.site)).map((x) => x.site).join() === "tienda.com.uy,tienda.com", "En «En la web (Uruguay)» la misma lista separa lo que se oculta de lo que se muestra");
  const realList = buildWebSellers(parseSearchItems(JSON.parse(fs.readFileSync(new URL("./fixtures/apify_google_search.json", import.meta.url), "utf8"))) ?? []);
  assert(realList.length === 9 && realList.every((x) => !isForeignSite(x.site)), "De las 9 tiendas de la respuesta real (todas .uy) no se oculta ninguna");

  console.log("--- Sitios que no son tiendas ---");
  for (const host of ["es.wikipedia.org", "youtube.com", "m.youtube.com", "youtu.be", "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "pinterest.com", "ar.pinterest.com", "pinterest.es", "x.com", "elpais.com.uy", "elobservador.com.uy", "infobae.com", "tienda.blogspot.com", "blog.tiendaejemplo.com.uy", "noticias.ejemplo.uy"]) {
    assert(isNonStore(host), `${host}: no es una tienda`);
  }
  assert(isNonStore("tiendaejemplo.com.uy", "https://tiendaejemplo.com.uy/blog/como-elegir") && isNonStore("ejemplo.uy", "https://ejemplo.uy/noticias"), "Una página de blog o de noticias dentro de una tienda tampoco cuenta como vendedor");
  for (const host of ["tiendaejemplo.com.uy", "mercadolibre.com.uy", "ferreteria.com.uy", "youtubers-shop.com.uy", "facebook.com.evil.net", "wikipedia.org.tienda.com", "blogger-store.uy", "mix.com.uy"]) {
    assert(!isNonStore(host, `https://${host}/productos/termo`), `${host}: se trata como tienda`);
  }
  assert(!isNonStore("tiendaejemplo.com.uy", "https://tiendaejemplo.com.uy/blogueras-termo") && !isNonStore("ejemplo.uy", "no es url"), "Una ruta que solo empieza parecido a /blog no alcanza; una dirección rota no rompe");

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

  console.log("--- Consulta que se manda a Google ---");
  assert(buildSearchQuery("Termo Stanley Classic 1 litro") === "Termo Stanley Classic 1 litro comprar Uruguay", "Arma «<nombre> comprar Uruguay», sin comillas");
  assert(buildSearchQuery("Stanley termo 1 litro") === "Stanley termo 1 litro comprar Uruguay", "La consulta de la prueba real: «Stanley termo 1 litro comprar Uruguay»");
  assert(buildSearchQuery('  Mate   "de calabaza" «forrado»  ') === "Mate de calabaza forrado comprar Uruguay", "Recorta espacios y saca las comillas que traiga el nombre");
  for (const name of ['"Termo Stanley"', "“Termo Stanley”", "«Termo Stanley»", "„Termo Stanley‟", "＂Termo Stanley＂", 'Termo "Stanley" 1 litro', '""""', '"a" "b" "c"', 'Termo Stanley" comprar "Uruguay', '" '.repeat(80) + "termo"]) {
    const q = buildSearchQuery(name);
    assert(!/["“”„‟«»＂]/.test(q) && q.endsWith("comprar Uruguay"), `Nunca arma una frase exacta: sin ninguna comilla (${name.slice(0, 26)} → ${q.slice(0, 40)})`);
  }
  const longName = buildSearchQuery("palabra ".repeat(40));
  assert(longName.length <= WEB_LIMITS.nameInSearchMax + " comprar Uruguay".length && longName.endsWith(" comprar Uruguay") && WEB_LIMITS.nameInSearchMax === 100 && !/ {2}/.test(longName), `El nombre se limita a 100 caracteres (${longName.length} en total)`);
  assert(buildSearchQuery("x".repeat(300)) === `${"x".repeat(100)} comprar Uruguay`, "Un nombre larguísimo se corta en 100 caracteres");
  assert(typeof buildSearchQuery("termo") === "string" && !buildSearchQuery("a\nb").includes("\n"), "Es una sola consulta: sin saltos de línea que el actor tomaría como varias");

  console.log("--- Respuesta real de Apify (fixture) ---");
  const fixture: unknown = JSON.parse(fs.readFileSync(new URL("./fixtures/apify_google_search.json", import.meta.url), "utf8"));
  const realRaw = parseSearchItems(fixture);
  assert(realRaw !== null && realRaw.length === 9, `El parser lee los 9 resultados de la búsqueda real (${realRaw?.length})`);
  assert(realRaw !== null && realRaw.every((x) => x.url.startsWith("https://") && x.title.length > 0 && x.description.length > 0), "Cada uno con enlace, título y descripción");
  const realBuilt = buildWebSellers(realRaw ?? []);
  assert(realBuilt.length === 9, `Salen 9 resultados (${realBuilt.length})`);
  assert(realBuilt.every((x) => x.kind === "store"), "Todos son de tipo tienda: ninguno cae en «Otros resultados»");
  assert(realBuilt.every((x) => x.uruguay === "confirmado" && !x.international), "Todos con Uruguay confirmado (todos son .uy)");
  assert(realBuilt.every(isMainSeller), "Los 9 van a la lista principal");
  assert(realBuilt.map((x) => x.site).join() === "tienda.farmashop.com.uy,planb.com.uy,almacenrural.com.uy,bagual.com.uy,bagual.com.uy,listado.mercadolibre.com.uy,alem.uy,stanley1913.uy,electroventas.com.uy", `Se respeta el orden de Google (${realBuilt.map((x) => x.site).join()})`);
  const bagual = realBuilt.filter((x) => siteDomain(x.site) === "bagual.com.uy");
  assert(bagual.length === 2 && bagual.length <= WEB_LIMITS.maxPerDomain && WEB_LIMITS.maxPerDomain === 2 && /rosa/.test(bagual[0].url) && /verde/.test(bagual[1].url), "Bagual respeta el máximo por dominio: sus dos productos entran");
  const thirdBagual = buildWebSellers([...(realRaw ?? []), { url: "https://www.bagual.com.uy/catalogo/termo-stanley-1l-azul", title: "Termo Stanley 1L Azul - Bagual", description: "" }, { url: "https://tienda.bagual.com.uy/otro", title: "Otro", description: "" }]);
  assert(thirdBagual.filter((x) => siteDomain(x.site) === "bagual.com.uy").length === 2 && thirdBagual.length === 9, "Un tercer y un cuarto resultado de Bagual (incluso desde un subdominio) no entran");
  assert(new Set(realBuilt.map((x) => x.url)).size === 9 && realBuilt[0].url === "https://tienda.farmashop.com.uy/marcas/stanley.html" && realBuilt[8].url === "https://electroventas.com.uy/catalogo/termo-stanley-the-legendary-classic-nuevo-modelo-1-litro-silver_SDT15_994386", "Los enlaces llegan tal cual, sin tocar");
  const page0 = (fixture as { organicResults: Record<string, unknown>[] }[])[0];
  assert(page0.organicResults.every((e) => Object.keys(e).sort().join() === "description,displayedUrl,title,url"), "El fixture guarda solo title, url, displayedUrl y description de cada resultado");
  assert(!/apify_api_|token|@/i.test(JSON.stringify(page0.organicResults)), "El fixture no tiene token ni datos personales");

  console.log("--- Parser defensivo (casos armados a mano) ---");
  const raw = parseSearchItems(SYNTHETIC);
  assert(raw !== null && raw.length === 15, `Lee los resultados orgánicos que tienen enlace (${raw?.length})`);
  assert(raw !== null && raw[0].title === "Termo Stanley Classic 1 Litro - Ferretería Ejemplo" && raw[0].url === "https://www.ferreteria-ejemplo.com.uy/productos/termo-stanley-classic-1l" && /acero inoxidable/.test(raw[0].description), "Toma title, url y description tal como vienen");
  assert(raw !== null && !raw.some((x) => /anuncio-pago/.test(x.url)), "Los resultados pagos no entran: solo organicResults");
  assert(raw !== null && raw.some((x) => x.url === "https://solo-enlace-ejemplo.com.uy/termo-stanley" && x.title === "" && x.description === ""), "Una entrada con solo el enlace se acepta, con título y descripción vacíos");
  assert(raw !== null && !raw.some((x) => typeof x.url !== "string"), "Entradas sin enlace, con un enlace que no es texto, null o texto suelto se saltean sin romper");
  for (const [label, data] of [
    ["una lista vacía", []],
    ["una página sin resultados", [{ searchQuery: {}, organicResults: [] }]],
  ] as const) {
    assert(parseSearchItems(data)?.length === 0, `${label}: respuesta válida sin resultados`);
  }
  for (const [label, data] of [
    ["null", null],
    ["un texto", "error"],
    ["un número", 7],
    ["un objeto de error", { error: { type: "run-failed", message: "x" } }],
    ["páginas sin organicResults", [{ searchQuery: {} }, { foo: 1 }]],
    ["organicResults que no es lista", [{ organicResults: "ninguno" }]],
    ["una lista de cosas sueltas", [1, "a", null]],
  ] as const) {
    assert(parseSearchItems(data) === null, `${label}: no es la forma esperada`);
  }
  assert(parseSearchItems({ organicResults: [{ url: "https://a.uy/x", title: "T" }] })?.length === 1, "Acepta también una sola página suelta");
  assert(parseSearchItems([{ organicResults: [{ url: "https://a.uy/1" }] }, { organicResults: [{ url: "https://b.uy/2" }] }])?.length === 2, "Si vinieran varias páginas, junta sus resultados");
  const huge = parseSearchItems([{ organicResults: Array.from({ length: 500 }, (_, i) => ({ url: `https://t${i}.uy/`, title: "t".repeat(900), description: "d".repeat(900) })) }]);
  assert(huge !== null && huge.length === WEB_LIMITS.maxRawResults && huge[0].title.length === WEB_LIMITS.titleMax && huge[0].description.length === WEB_LIMITS.descriptionMax, "Una respuesta enorme se acota: cantidad, título y descripción");
  const dirtyRaw = parseSearchItems([{ organicResults: [{ url: "  https://a.uy/x  ", title: "Termo\n\tStanley\u0000 ", description: 5 }] }]);
  assert(dirtyRaw !== null && dirtyRaw[0].url === "https://a.uy/x" && dirtyRaw[0].title === "Termo Stanley" && dirtyRaw[0].description === "", "Limpia espacios y caracteres de control; un campo con otro tipo queda vacío");

  console.log("--- Lista final ---");
  const built = buildWebSellers(raw ?? []);
  const row = (site: string) => built.filter((s) => s.site === site);
  assert(built.length === WEB_LIMITS.maxResults && WEB_LIMITS.maxResults === 10, `Como mucho 10 resultados (${built.length})`);
  assert(built.map((s) => s.site).join() === "ferreteria-ejemplo.com.uy,listado.mercadolibre.com.uy,articulo.mercadolibre.com.uy,solo-enlace-ejemplo.com.uy,tiendaoutdoor-ejemplo.com,importadora-ejemplo.com,mercadolibre.com.uy.ofertas-ejemplo.com,es.aliexpress.com,youtube.com,es.wikipedia.org", `Orden: tiendas de Uruguay, después sin confirmar, internacionales y al final lo que no es tienda (${built.map((s) => s.site).join()})`);
  assert(built.filter((s) => siteDomain(s.site) === "mercadolibre.com.uy").length === 2 && !built.some((s) => /MLU-600000002/.test(s.url)), "Como mucho 2 resultados por dominio: el tercero de Mercado Libre no entra");
  assert(row("ferreteria-ejemplo.com.uy")[0].uruguay === "confirmado" && row("listado.mercadolibre.com.uy")[0].uruguay === "confirmado" && row("ferreteria-ejemplo.com.uy")[0].kind === "store", "Los .uy quedan confirmados");
  assert(row("tiendaoutdoor-ejemplo.com")[0].uruguay === "probable" && row("importadora-ejemplo.com")[0].uruguay === "probable", "Un sitio que no es .uy queda «probable» si el resultado nombra a Uruguay, a Montevideo o tiene /uy/ en la ruta");
  assert(row("es.aliexpress.com")[0].international && row("es.aliexpress.com")[0].uruguay === "no_confirmado" && !isMainSeller(row("es.aliexpress.com")[0]), "AliExpress va como internacional sin confirmar, aunque diga que envía a Uruguay");
  const fake = row("mercadolibre.com.uy.ofertas-ejemplo.com")[0];
  assert(fake.uruguay === "no_confirmado" && !fake.international && !isMainSeller(fake), "El parecido mercadolibre.com.uy.ofertas-ejemplo.com queda «no confirmado», con su nombre completo, fuera de la lista principal");
  assert(row("youtube.com")[0].kind === "other" && row("es.wikipedia.org")[0].kind === "other" && !isMainSeller(row("youtube.com")[0]) && !isMainSeller(row("es.wikipedia.org")[0]), "YouTube y Wikipedia van a «Otros resultados», no como vendedores (aunque nombren a Uruguay)");
  assert(built.filter(isMainSeller).map((s) => s.site).join() === "ferreteria-ejemplo.com.uy,listado.mercadolibre.com.uy,articulo.mercadolibre.com.uy,solo-enlace-ejemplo.com.uy,tiendaoutdoor-ejemplo.com,importadora-ejemplo.com", "Lista principal: solo tiendas de Uruguay confirmadas o probables");
  assert(!built.some((s) => /sitio-viejo|192\.168/.test(s.url)), "Un enlace http o a una IP se descarta");
  assert(built.every((s) => s.url.startsWith("https://") && Object.keys(s).sort().join() === "international,kind,site,title,url,uruguay,why"), "Cada resultado tiene exactamente los campos del contrato y un enlace https");
  assert(row("ferreteria-ejemplo.com.uy")[0].title === "Termo Stanley Classic 1 Litro - Ferretería Ejemplo" && row("ferreteria-ejemplo.com.uy")[0].why === "Termo Stanley Classic de 1 litro, acero inoxidable. Envíos a todo el país. $ 2.490.", "Título y descripción son los de Google, sin agregar ni inventar nada");
  assert(row("solo-enlace-ejemplo.com.uy")[0].title === "solo-enlace-ejemplo.com.uy" && row("solo-enlace-ejemplo.com.uy")[0].why === "", "Sin título se muestra el dominio; sin descripción, nada");
  const lower = buildWebSellers((raw ?? []).filter((x) => /elpais|tienda-ejemplo\.com\.uy\/blog/.test(x.url)));
  assert(lower.length === 2 && lower.every((s) => s.kind === "other"), "Un diario y la página de blog de una tienda van a «Otros resultados»");
  assert(buildWebSellers([]).length === 0, "Sin resultados de Google, lista vacía");
  const dupUrl = buildWebSellers([{ url: "https://a.uy/x", title: "1", description: "" }, { url: "https://a.uy/x", title: "2", description: "" }, { url: "https://www.a.uy/y", title: "3", description: "" }, { url: "https://tienda.a.uy/z", title: "4", description: "" }]);
  assert(dupUrl.length === 2 && dupUrl.map((s) => s.title).join() === "1,3", "El mismo enlace no se repite, y los subdominios cuentan como el mismo dominio");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "https://localhost/x", "https://10.0.0.1/x", "https://usuario:clave@tienda.uy/x", "https://tienda.uy:8443/x", "file:///etc/passwd", "no es un enlace"]) {
    assert(buildWebSellers([{ url: bad, title: "x", description: "" }]).length === 0, `Resultado con enlace inseguro (${bad.slice(0, 30)}): se descarta`);
  }

  console.log("--- Lo que valida la pantalla ---");
  const screen = parseWebSellersResponse({ ok: true, query: "termo", cached: true, searchQueries: ["termo comprar Uruguay", 5, ""], results: [{ site: "ejemplo.uy", url: "https://ejemplo.uy/a", title: "T", why: "W", uruguay: "confirmado", international: false, kind: "store", price: 100 }, { site: "mercadolibre.com.uy", url: "https://otra-tienda.com/a", title: "", why: "", uruguay: "confirmado", international: false, kind: "store" }, { site: "mala.com", url: "javascript:alert(1)", title: "x" }, { site: "youtube.com", url: "https://www.youtube.com/watch?v=1", kind: "store", uruguay: "probable" }, "basura"] });
  assert(screen !== null && screen.results.length === 3 && !("price" in screen.results[0]) && screen.cached && screen.searchQueries.join() === "termo comprar Uruguay", "Pasan solo los campos esperados; una entrada con enlace inseguro se descarta");
  assert(screen !== null && screen.results[1].site === "otra-tienda.com" && screen.results[1].uruguay === "probable" && screen.results[1].title === "otra-tienda.com", "El dominio se lee del enlace (no del campo site) y un «confirmado» en un dominio que no es .uy baja a «probable»");
  assert(screen !== null && screen.results[2].kind === "other", "YouTube queda como «otro» aunque el servidor dijera tienda");
  assert(parseWebSellersResponse({ ok: false }) === null && parseWebSellersResponse({ ok: true }) === null && parseWebSellersResponse(null) === null && parseWebSellersResponse("x") === null, "Una respuesta con otra forma no se muestra");

  console.log("--- Llamada a Apify (fetch simulado) ---");
  const TOKEN = "apify_api_TOKEN-DE-PRUEBA-NO-DEBE-SALIR-9d2f";
  const fetchCalls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  type Reply = { status: number; body: unknown } | "network" | "hang";
  let reply = { status: 201, body: SYNTHETIC } as Reply;
  const fakeFetch: FetchLike = async (url, init) => {
    fetchCalls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (reply === "network") throw new TypeError("fetch failed");
    if (reply === "hang") {
      // El proceso sigue vivo mientras espera, como con un socket de verdad.
      const alive = setInterval(() => {}, 50);
      await new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))).finally(() => clearInterval(alive));
    }
    const current = reply as { status: number; body: unknown };
    return { status: current.status, json: async () => { if (current.body === "no-json") throw new SyntaxError("Unexpected token"); return current.body; } };
  };
  const searcher = createApifySearcher({ token: TOKEN, fetch: fakeFetch, timeoutMs: 200 });
  const outcome = async (): Promise<string> => {
    try {
      return `ok:${(await searcher("termo comprar Uruguay")).length}`;
    } catch (err) {
      return err instanceof WebSearchError ? `${err.code}|${err.detail}|${err.message}` : `otro:${String(err)}`;
    }
  };

  assert((await outcome()) === "ok:15", "Con una respuesta 201 devuelve los resultados orgánicos");
  const sent = fetchCalls[0];
  assert(fetchCalls.length === 1 && sent.method === "POST" && sent.url === "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items" && sent.url === APIFY_SEARCH_URL, "Un solo POST al actor apify~google-search-scraper (run-sync-get-dataset-items)");
  assert(sent.headers.Authorization === `Bearer ${TOKEN}` && sent.headers["Content-Type"] === "application/json", "El token va en el encabezado Authorization: Bearer");
  assert(!sent.url.includes(TOKEN) && !sent.url.includes("token") && !sent.url.includes("?") && !sent.body.includes(TOKEN), "La dirección de la llamada no lleva el token (ni como parámetro), y el cuerpo tampoco");
  const sentBody = JSON.parse(sent.body);
  assert(
    JSON.stringify(sentBody) === JSON.stringify({ queries: "termo comprar Uruguay", countryCode: "uy", languageCode: "es", maxPagesPerQuery: 1, mobileResults: false, saveHtml: false, saveHtmlToKeyValueStore: false }),
    "El cuerpo es el pedido: una consulta, Uruguay, español, una página, sin HTML"
  );
  assert(typeof sentBody.queries === "string" && !sentBody.queries.includes("\n") && JSON.stringify(searchInput("x")) === JSON.stringify({ ...sentBody, queries: "x" }), "Una sola consulta por búsqueda");
  assert(WEB_SEARCH_TIMEOUT_MS === 45_000, "La espera máxima por defecto es de 45 segundos");
  reply = { status: 201, body: fixture };
  assert((await outcome()) === "ok:9", "Con la respuesta real devuelve sus 9 resultados");
  reply = { status: 201, body: SYNTHETIC };

  const errorCases: [string, Reply, string][] = [
    ["401 (token inválido)", { status: 401, body: { error: { type: "invalid-token", message: `Token ${TOKEN} is not valid` } } }, "WEB_SEARCH_NOT_CONFIGURED"],
    ["402 (sin crédito)", { status: 402, body: { error: { type: "x402-payment-required", message: "Payment required" } } }, "WEB_SEARCH_NO_CREDIT"],
    ["403 con «not-enough-usage-to-run-paid-actor»", { status: 403, body: { error: { type: "not-enough-usage-to-run-paid-actor", message: "x" } } }, "WEB_SEARCH_NO_CREDIT"],
    ["403 con «monthly-usage-limit-too-low»", { status: 403, body: { error: { type: "monthly-usage-limit-too-low", message: "x" } } }, "WEB_SEARCH_NO_CREDIT"],
    ["400 con «limit-reached»", { status: 400, body: { error: { type: "limit-reached", message: "x" } } }, "WEB_SEARCH_NO_CREDIT"],
    ["403 por permisos", { status: 403, body: { error: { type: "insufficient-permissions", message: "x" } } }, "WEB_SEARCH_UNAVAILABLE"],
    ["400 (pedido inválido o corrida fallida)", { status: 400, body: { error: { type: "run-failed", message: "x" } } }, "WEB_SEARCH_UNAVAILABLE"],
    ["408 (el actor tardó demasiado)", { status: 408, body: { error: { type: "run-timeout-exceeded", message: "x" } } }, "WEB_SEARCH_UNAVAILABLE"],
    ["429 (demasiados pedidos)", { status: 429, body: { error: { type: "rate-limit-exceeded", message: "x" } } }, "WEB_SEARCH_UNAVAILABLE"],
    ["500", { status: 500, body: "no-json" }, "WEB_SEARCH_UNAVAILABLE"],
    ["502 sin cuerpo", { status: 502, body: null }, "WEB_SEARCH_UNAVAILABLE"],
    ["201 con un cuerpo que no es JSON", { status: 201, body: "no-json" }, "WEB_SEARCH_UNAVAILABLE"],
    ["201 con otra forma", { status: 201, body: { error: { type: "x" } } }, "WEB_SEARCH_UNAVAILABLE"],
    ["error de red", "network", "WEB_SEARCH_UNAVAILABLE"],
  ];
  for (const [label, r, code] of errorCases) {
    reply = r;
    const calls = fetchCalls.length;
    const out = await outcome();
    assert(out.startsWith(`${code}|`) && fetchCalls.length === calls + 1 && !out.includes(TOKEN), `Apify responde ${label}: ${code}, sin reintentar y sin el token en el error`);
  }
  reply = "hang";
  const startedAt = Date.now();
  const timedOut = await outcome();
  assert(timedOut === "WEB_SEARCH_UNAVAILABLE|tiempo agotado|WEB_SEARCH_UNAVAILABLE" && Date.now() - startedAt < 2000, "Si Apify no contesta, se corta por tiempo: WEB_SEARCH_UNAVAILABLE");
  reply = { status: 201, body: [] };
  assert((await outcome()) === "ok:0", "Una respuesta vacía es una búsqueda sin resultados, no un error");

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

  console.log("--- Endpoint (buscador simulado) ---");
  const logs: string[] = [];
  const consoleKeys = ["log", "info", "warn", "error", "debug"] as const;
  const originalConsole = Object.fromEntries(consoleKeys.map((k) => [k, console[k]])) as Record<(typeof consoleKeys)[number], (...a: unknown[]) => void>;

  // La ruta completa, con el buscador de Apify de verdad y solo el fetch simulado.
  let configured = true;
  let rateUser = "ana";
  const limiterStore = createMemoryRateStore();
  const rateLimit = createRateLimiter({ store: () => limiterStore, fallback: limiterStore, userId: () => rateUser, now: () => NOW });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.post("/api/web-sellers", ...createWebSellersRoute({ search: () => (configured ? searcher : null), limiter: rateLimit(RATE_RULES.web) }));
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
    const before = fetchCalls.length;
    r[name] = await run();
    callsAt[name] = fetchCalls.length - before;
  };
  try {
    reply = { status: 201, body: SYNTHETIC };
    await step("ok", () => post({ query: "  Termo Stanley Classic 1 litro " }));
    await step("cached", () => post({ query: "termo  STANLEY classic 1 litro" }));
    reply = { status: 201, body: fixture };
    await step("real", () => post({ query: "Stanley termo 1 litro" }));
    reply = { status: 201, body: [] };
    await step("empty", () => post({ query: "producto que no existe" }));
    reply = { status: 401, body: { error: { type: "invalid-token", message: `Token ${TOKEN} is not valid` } } };
    await step("badToken", () => post({ query: "token inválido" }));
    reply = { status: 402, body: { error: { type: "x402-payment-required", message: "Payment required" } } };
    await step("noCredit", () => post({ query: "sin crédito" }));
    await step("noCreditAgain", () => post({ query: "sin crédito" }));
    reply = { status: 500, body: { error: { type: "internal", message: `fallo interno con ${TOKEN}` } } };
    await step("down", () => post({ query: "apify caído" }));
    reply = "hang";
    await step("timeout", () => post({ query: "apify colgado" }));
    reply = "network";
    await step("network", () => post({ query: "sin red" }));
    reply = { status: 201, body: { cualquier: "cosa" } };
    await step("shape", () => post({ query: "otra forma" }));

    reply = { status: 201, body: [] };
    await step("short", () => post({ query: "a" }));
    await step("long", () => post({ query: "x".repeat(121) }));
    await step("missing", () => post({}));
    await step("wrongType", () => post({ query: ["termo"] }));
    configured = false;
    await step("noToken", () => post({ query: "sin token" }));
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
  assert(r.ok.status === 200 && ok.ok === true && ok.cached === false && ok.query === "Termo Stanley Classic 1 litro" && ok.results.length === 10, "Búsqueda válida: 200 con los resultados");
  assert(fetchCalls.some((c) => JSON.parse(c.body).queries === "Termo Stanley Classic 1 litro comprar Uruguay") && ok.searchQueries.join() === "Termo Stanley Classic 1 litro comprar Uruguay", "A Google se le pregunta «<nombre> comprar Uruguay», sin comillas, y la respuesta dice qué se buscó");
  assert(!fetchCalls.some((c) => String(JSON.parse(c.body).queries).includes('"')), "Ninguna consulta enviada a Apify lleva comillas");
  const realAnswer = r.real.data;
  assert(r.real.status === 200 && realAnswer.results.length === 9 && realAnswer.results.every((x: any) => x.kind === "store" && x.uruguay === "confirmado") && realAnswer.searchQueries.join() === "Stanley termo 1 litro comprar Uruguay", "Con la respuesta real, el endpoint devuelve las 9 tiendas, todas confirmadas");
  assert(callsAt.ok === 1, "Una sola llamada a Apify por búsqueda");
  assert(Object.keys(ok).sort().join() === "cached,ok,query,results,searchQueries", "La respuesta tiene la misma forma de antes: ok, query, results, searchQueries, cached");
  assert(ok.results[0].site === "ferreteria-ejemplo.com.uy" && ok.results[0].uruguay === "confirmado" && ok.results.at(-1).kind === "other", "Los resultados llegan clasificados y ordenados");
  assert(r.cached.status === 200 && r.cached.data.cached === true && callsAt.cached === 0 && JSON.stringify(r.cached.data.results) === JSON.stringify(ok.results), "Repetir la consulta (con otras mayúsculas y espacios) sale de la memoria: no se llama a Apify");
  assert(r.empty.status === 200 && r.empty.data.results.length === 0, "Sin resultados: 200 con la lista vacía");
  assert(r.noToken.status === 503 && r.noToken.data.code === "WEB_SEARCH_NOT_CONFIGURED" && callsAt.noToken === 0, "Sin APIFY_TOKEN: WEB_SEARCH_NOT_CONFIGURED, sin llamar a nadie");
  assert(r.badToken.status === 503 && r.badToken.data.code === "WEB_SEARCH_NOT_CONFIGURED" && r.badToken.data.message === WEB_MESSAGES.notConfigured, "Token inválido (401): también WEB_SEARCH_NOT_CONFIGURED");
  assert(r.noCredit.status === 503 && r.noCredit.data.code === "WEB_SEARCH_NO_CREDIT" && r.noCredit.data.message === "Se agotó el crédito del servicio de búsqueda web", "Sin crédito (402): WEB_SEARCH_NO_CREDIT con su mensaje");
  assert(callsAt.noCreditAgain === 1, "Un error no se guarda en la memoria");
  for (const k of ["down", "timeout", "network", "shape"]) {
    assert(r[k].status === 502 && r[k].data.code === "WEB_SEARCH_UNAVAILABLE" && r[k].data.message === WEB_MESSAGES.unavailable && callsAt[k] === 1, `Apify falla («${k}»): WEB_SEARCH_UNAVAILABLE, sin reintentar por su cuenta`);
  }
  assert(!/WEB_SEARCH_NEEDS_BILLING|facturaci[oó]n|Gemini/i.test(responses.join(" ")), "Ya no existe el aviso viejo de facturación de Google");
  assert([r.short, r.long, r.missing, r.wrongType].every((x) => x.status === 400 && x.data.code === "INVALID_QUERY") && ["short", "long", "missing", "wrongType"].every((k) => callsAt[k] === 0), "Consulta inválida: 400 sin llamar a Apify");
  assert(r.rate.status === 429 && r.rate.data.code === "RATE_LIMITED" && r.rate.retryAfter === "55" && callsAt.rate === 0, "Pasado el tope por minuto: 429 con Retry-After, sin llamar a Apify");
  assert(r.rateButCached.status === 200 && r.rateButCached.data.cached === true, "Una consulta que está en memoria se responde aunque el usuario esté en el tope: no gasta nada");
  for (const k of Object.keys(r)) {
    if (r[k].status !== 200) assert(r[k].data?.ok === false && typeof r[k].data.message === "string" && r[k].data.message === r[k].data.error, `Error «${k}»: JSON con ok:false y el mismo texto en message y error`);
  }
  assert(Object.keys(r).filter((k) => r[k].status !== 200).every((k) => !/apify|token|HTTP \d|invalid-token|x402|internal/i.test(r[k].data.message)), "Ningún mensaje de error nombra al proveedor, al token ni detalles internos");

  assert(logs.length > 0, `Queda un registro mínimo para depurar (${logs.length} líneas)`);
  assert(!logs.some((l) => l.includes(TOKEN) || /apify_api_|Bearer/i.test(l)), "El token no aparece en ningún log");
  assert(!responses.some((t) => t.includes(TOKEN) || /apify_api_|Bearer/i.test(t)), "El token no aparece en ninguna respuesta");
  assert(!logs.some((l) => /termo stanley|ferreteria-ejemplo|mercadolibre|sin crédito|apify caído/i.test(l)), "Los logs no llevan la consulta ni los sitios");
  assert(logs.every((l) => l.length < 160), "Cada línea de log es corta: cantidad de resultados o código de error");
  assert(fetchCalls.every((c) => c.url === APIFY_SEARCH_URL && !c.url.includes(TOKEN)), "Todas las llamadas fueron a la misma dirección de Apify, sin el token");

  const source = fs.readFileSync(new URL("../server/webSellers.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert(!/from "node:fs"|from "fs"|writeFile|appendFile|supabase|cloud\.js/i.test(code), "server/webSellers.ts no usa el sistema de archivos ni Supabase");
  assert(!/genai|googleSearch|groundingChunks|vertexaisearch|GEMINI/i.test(source), "No queda nada de Gemini, de groundingChunks ni del resolvedor de redirecciones");
  const logLines = code.split("\n").filter((l) => /console\./.test(l));
  assert(logLines.length > 0 && logLines.every((l) => !/token|query|searchQuery|results\b(?!\.length)|url|headers|body/i.test(l.replace("value.results.length", ""))), "Ningún console.* recibe el token, la consulta, los resultados ni los enlaces");
  assert((code.match(/options\.fetch\(/g) ?? []).length === 1 && !/\bfetch\(/.test(code.replace(/options\.fetch\(/g, "")) && /options\.fetch\(APIFY_SEARCH_URL,/.test(code), "El único pedido de red del archivo va a la dirección fija de Apify: los enlaces de los resultados nunca se visitan");
  assert(!/[?&]token=/.test(source), "El código no arma ninguna dirección con ?token=");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de búsqueda web`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
