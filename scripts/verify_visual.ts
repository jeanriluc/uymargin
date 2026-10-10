// Tests de la búsqueda visual de "Por foto": parser de la respuesta de Apify (Google Lens), clasificación,
// precio, nombre sugerido, códigos de error, límite de uso y memoria por hash. La red es siempre simulada:
// no hay ninguna llamada real a Apify, y no se importa server/app.ts (que lee .env) ni Supabase.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES } from "../server/rateLimit";
import {
  APIFY_LENS_URL,
  VISUAL_CACHE,
  VISUAL_SEARCH_TIMEOUT_MS,
  createApifyLens,
  createVisualCache,
  createVisualSearchRoute,
  imageHash,
  lensInput,
} from "../server/visualSearch";
import type { FetchLike } from "../server/webSellers";
import { PHOTO_LIMITS } from "../src/lib/photo/identify";
import {
  VISUAL_LIMITS,
  VISUAL_MESSAGES,
  buildVisualMatches,
  classifyVisual,
  cleanListingTitle,
  formatVisualPrice,
  isForeignDomain,
  isVisualNonStore,
  mostRepeatedTitle,
  parseLensItems,
  parseVisualResponse,
  safeThumbnailUrl,
  toVisualMatch,
  visualPrice,
  type RawLensItem,
  type VisualSummary,
} from "../src/lib/photo/visual";

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

const fixture = (JSON.parse(fs.readFileSync(new URL("./fixtures/apify_google_lens.json", import.meta.url), "utf8")) as { items: unknown[] }).items;

const item = (url: string, extra: Partial<Record<"title" | "source" | "thumbnail", string>> & { price?: unknown; currency?: unknown } = {}): RawLensItem => ({
  url,
  title: extra.title ?? "Termo Stanley Classic",
  source: extra.source ?? "",
  thumbnail: extra.thumbnail ?? "",
  price: extra.price ?? null,
  currency: extra.currency ?? null,
});
const no = { uyuPrice: false, text: "" };

// Una "imagen" con una marca de texto adentro, para comprobar que no aparece en ningún log ni respuesta.
const MARKER = "CONTENIDO-PRIVADO-DE-LA-FOTO-9042";
const jpeg = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`${MARKER}-${seed}-`.repeat(20), "latin1")]);
const JPEG = jpeg("a");
const TOKEN = "apify_api_TOKEN-DE-PRUEBA-QUE-NO-DEBE-VERSE";
const NOW = Date.UTC(2026, 9, 9, 15, 0, 5);

async function main() {
  console.log("--- Respuesta del actor: parseo ---");
  const parsed = parseLensItems(fixture);
  assert(parsed.ok && parsed.items.length === 10, "La muestra real se lee entera: 10 items");
  assert(parsed.ok && parsed.items[0].price === 3722 && parsed.items[0].currency === "UYU" && parsed.items[1].price === null, "Precio y moneda se conservan como vinieron (número, o null)");
  for (const [label, bad] of [["null", null], ["un texto", "error"], ["un objeto", { items: [] }], ["un número", 7]] as const) {
    const p = parseLensItems(bad);
    assert(p.ok === false && p.reason === "otra forma", `Si la respuesta es ${label}, se rechaza por forma`);
  }
  const empty = parseLensItems([]);
  assert(empty.ok && empty.items.length === 0, "Una lista vacía es válida: no hubo coincidencias");
  const errorItem = parseLensItems([{ resultType: "error", errorMessage: `search_type products is discontinued (${TOKEN})` }]);
  assert(errorItem.ok === false && errorItem.reason === "item de error", "Un dataset con un solo item {resultType, errorMessage} se reconoce como falla del actor");
  assert(JSON.stringify(errorItem).includes("discontinued") === false, "El mensaje crudo del actor no sale del parser");
  const unknownShape = parseLensItems([{ link: "https://tienda.com.uy/a", name: "Termo" }]);
  assert(unknownShape.ok === false && unknownShape.reason === "otra forma", "Items sin url ni error: el actor cambió de formato, no es «sin coincidencias»");
  const mixed = parseLensItems([null, "texto", ["x"], { url: "   " }, { url: 5 }, { url: "https://tienda.com.uy/a", title: 9, source: null, thumbnail: {} }, { errorMessage: "parcial" }]);
  assert(mixed.ok && mixed.items.length === 1 && mixed.items[0].title === "" && mixed.items[0].thumbnail === "", "Entradas rotas se saltean sin romper; los campos de otro tipo quedan vacíos");
  const many = parseLensItems(Array.from({ length: 200 }, (_, i) => ({ url: `https://tienda${i}.com.uy/p` })));
  assert(many.ok && many.items.length === VISUAL_LIMITS.maxRawItems, `Se miran como mucho ${VISUAL_LIMITS.maxRawItems} items`);
  const dirty = parseLensItems([{ url: "https://tienda.com.uy/a", title: `Termo\u0000\n  Stanley ${"x".repeat(300)}`, source: "Tienda\tUno" }]);
  assert(dirty.ok && !/[\u0000-\u001f]/.test(dirty.items[0].title) && dirty.items[0].title.length <= VISUAL_LIMITS.titleMax && dirty.items[0].source === "Tienda Uno", "Título y sitio salen en una línea, sin caracteres de control y acotados");

  console.log("--- Precio ---");
  assert(JSON.stringify(visualPrice(3722, "UYU")) === '{"amount":3722,"currency":"UYU"}', "Número + UYU: se muestra");
  assert(visualPrice(75, "US$")?.currency === "USD" && visualPrice(75, "USD")?.currency === "USD" && visualPrice(75, " usd ")?.currency === "USD", "US$ y USD se muestran como dólares");
  assert(visualPrice(159500, ".") === null, "Moneda inválida («.»): no se muestra precio");
  for (const [p, c] of [[100, ""], [100, null], [100, "$"], [100, "ARS"], [100, "€"], [100, "BRL"], [100, 858]] as const) {
    assert(visualPrice(p, c) === null, `Moneda ${JSON.stringify(c)}: no se muestra precio`);
  }
  for (const p of ["3722", "3.722", null, undefined, NaN, Infinity, 0, -5, 2e9, {}, [3722]]) {
    assert(visualPrice(p, "UYU") === null, `Precio ${typeof p === "number" ? String(p) : JSON.stringify(p)}: no es un número usable, no se muestra`);
  }
  assert(formatVisualPrice({ amount: 3722, currency: "UYU" }) === "$U 3.722" && formatVisualPrice({ amount: 75, currency: "USD" }) === "US$ 75", "Formato: «$U 3.722» y «US$ 75»");
  assert(formatVisualPrice({ amount: 1234567.5, currency: "UYU" }) === "$U 1.234.567,50" && formatVisualPrice({ amount: 59.95, currency: "USD" }) === "US$ 59,95", "Formato con miles y decimales");
  assert(/precio informado por Google, confirmar en la tienda/.test(VISUAL_MESSAGES.priceNote), "El rótulo del precio dice que lo informa Google y que hay que confirmarlo");

  console.log("--- Clasificación ---");
  const group = (host: string, url = `https://${host}/p`, signals = no) => classifyVisual(host, url, signals).group;
  assert(group("articulo.mercadolibre.com.uy") === "ml_uy" && group("mercadolibre.com.uy") === "ml_uy" && group("listado.mercadolibre.com.uy") === "ml_uy", "mercadolibre.com.uy y sus subdominios: bloque Mercado Libre Uruguay");
  assert(group("stanley1913.uy") === "uy_stores" && group("electroventas.com.uy") === "uy_stores" && classifyVisual("tienda.com.uy", "https://tienda.com.uy/p", no).uruguay === "confirmado", "Un .uy es una tienda de Uruguay confirmada");
  for (const host of ["mercadolibre.com.ar", "tienda.com.br", "falabella.cl", "tienda.com.py", "stanley1913.com.ve", "mercadolibre.com.mx", "tienda.de", "mercadolibre.com.co"]) {
    assert(group(host, `https://${host}/p`, { uyuPrice: true, text: "envíos a Uruguay" }) === "abroad" && isForeignDomain(host), `${host}: otro país, aunque el resultado nombre a Uruguay`);
  }
  assert(group("amazon.com") === "abroad" && group("es.aliexpress.com") === "abroad", "Tiendas globales: no se dan por uruguayas");
  assert(!isForeignDomain("tienda.com") && !isForeignDomain("tienda.co") && !isForeignDomain("tienda.io") && !isForeignDomain("tienda.uy") && !isForeignDomain("tienda.com.uy"), ".com, .co, .io y .uy no cuentan como «otro país»");
  assert(group("yerbascalzada.com") === "abroad", "Una tienda .com sin ninguna señal de Uruguay queda en «Otros países o sin confirmar»");
  const probable = classifyVisual("matesuru.com", "https://matesuru.com/p", { uyuPrice: true, text: "" });
  assert(probable.group === "uy_stores" && probable.uruguay === "probable", "Una tienda .com con precio en pesos uruguayos entra como «probable», nunca «confirmado»");
  assert(group("tienda.com", "https://tienda.com/p", { uyuPrice: false, text: "Termo - Envíos a todo Uruguay" }) === "uy_stores" && group("tienda.com", "https://tienda.com/uy/termo") === "uy_stores", "También si el resultado nombra a Uruguay o la ruta es /uy/");
  for (const host of ["instagram.com", "facebook.com", "youtube.com", "pinterest.com", "es.wikipedia.org", "idealo.de", "idealo.es", "kelkoo.com", "pricerunner.com", "gub.uy".replace("gub", "impo.gub"), "dgi.gub.uy", "usa.gov", "elpais.com.uy", "blog.tienda.com"]) {
    assert(group(host, `https://${host}/p`, { uyuPrice: true, text: "Uruguay" }) === "others", `${host}: no es una tienda, va a «Otros resultados»`);
  }
  assert(isVisualNonStore("tienda.com.uy", "https://tienda.com.uy/blog/termos") && !isVisualNonStore("tienda.com.uy", "https://tienda.com.uy/termos"), "La ruta /blog/ también cuenta como «no es tienda»");
  for (const host of ["mercadolibre.com.uy.ofertas-termo.com", "stanley1913.uy.tienda-segura.net", "electroventas.com.uy.pagos.xyz"]) {
    assert(group(host, `https://${host}/p`, { uyuPrice: true, text: "Mercado Libre Uruguay" }) === "others", `Dominio imitador (${host}): no entra a Mercado Libre ni a tiendas de Uruguay`);
  }
  const fake = toVisualMatch(item("https://mercadolibre.com.uy.ofertas-termo.com/termo", { price: 990, currency: "UYU", source: "Mercado Libre Uruguay" }));
  assert(fake !== null && fake.group === "others" && fake.price === null && fake.uruguay === null, "Al imitador tampoco se le muestra el precio");
  assert(toVisualMatch(item("https://www.instagram.com/p/abc/", { price: 500, currency: "UYU" }))?.price === null, "Lo que no es una tienda no muestra precio");

  console.log("--- Enlaces y miniaturas ---");
  for (const bad of ["http://tienda.com.uy/termo", "javascript:alert(1)", "data:text/html,<script>1</script>", "https://127.0.0.1/termo", "https://localhost/termo", "https://usuario:clave@tienda.com.uy/", "https://tienda.com.uy:8443/", "https://intranet.local/termo", "//tienda.com.uy/termo", "ftp://tienda.com.uy/a", "", "tienda.com.uy"]) {
    assert(toVisualMatch(item(bad)) === null, `Enlace inseguro descartado: ${bad || "(vacío)"}`);
  }
  assert(toVisualMatch(item("https://WWW.Tienda.com.uy/termo"))?.site === "tienda.com.uy", "El sitio sale del enlace, en minúsculas y sin www");
  assert(toVisualMatch(item("https://tienda.com.uy/a", { title: "" }))?.title === "tienda.com.uy", "Sin título se muestra el dominio");
  assert(safeThumbnailUrl("https://encrypted-tbn0.gstatic.com/images?q=tbn:abc") !== null && safeThumbnailUrl("https://lh3.googleusercontent.com/abc") !== null, "Miniatura servida por Google: se acepta");
  for (const bad of ["http://encrypted-tbn0.gstatic.com/images?q=x", "https://tienda.com.uy/foto.jpg", "https://gstatic.com.sitio-raro.net/a.jpg", "https://notgstatic.com/a.jpg", "data:image/png;base64,AAAA", "javascript:alert(1)", "", null]) {
    assert(safeThumbnailUrl(bad) === null, `Miniatura descartada: ${bad === null ? "null" : bad || "(vacía)"}`);
  }

  console.log("--- Lista final con la muestra real ---");
  const real = buildVisualMatches(parsed.ok ? parsed.items : []);
  const sites = (g: string) => real.results.filter((m) => m.group === g).map((m) => m.site).join();
  assert(real.results.length === 10, "Los 10 resultados de la muestra se muestran (ningún dominio se repite más de dos veces)");
  assert(sites("ml_uy") === "articulo.mercadolibre.com.uy,mercadolibre.com.uy" && real.mlCount === 2, "Mercado Libre Uruguay: bloque propio con sus 2 publicaciones");
  assert(sites("uy_stores") === "stanley1913.uy,matesuru.com,electroventas.com.uy", `Tiendas de Uruguay: Stanley, Matesuru y Electroventas (${sites("uy_stores")})`);
  assert(sites("abroad") === "mercadolibre.com.ar,yerbascalzada.com,stanley1913.com.ve", `Otros países o sin confirmar: Mercado Libre Argentina, Yerbas Calzada y Stanley Venezuela (${sites("abroad")})`);
  assert(sites("others") === "instagram.com,idealo.de", "Otros resultados: Instagram e Idealo");
  assert(real.results.map((m) => m.group).join() === "ml_uy,ml_uy,uy_stores,uy_stores,uy_stores,abroad,abroad,abroad,others,others", "Orden de los grupos: Mercado Libre, tiendas, otros países, otros");
  const priceOf = (site: string) => {
    const m = real.results.find((x) => x.site === site);
    return m?.price ? formatVisualPrice(m.price) : null;
  };
  assert(priceOf("stanley1913.uy") === "$U 3.722" && priceOf("matesuru.com") === "$U 2.850" && priceOf("electroventas.com.uy") === "$U 3.205" && priceOf("stanley1913.com.ve") === "US$ 75", "Precios en UYU y en US$ se muestran");
  assert(priceOf("yerbascalzada.com") === null && priceOf("mercadolibre.com.uy") === null && priceOf("instagram.com") === null, "Yerbas Calzada (moneda «.») y los que vienen sin precio no muestran nada");
  assert(real.results.find((m) => m.site === "matesuru.com")?.uruguay === "probable" && real.results.find((m) => m.site === "stanley1913.uy")?.uruguay === "confirmado", "Matesuru (.com con precio en pesos) queda «probable»; el .uy, «confirmado»");
  assert(real.uruguayCount === 5, "Cuenta 5 resultados de Uruguay");
  assert(real.suggestedName === "Stanley Termo Classic Original", `Nombre sugerido a partir de Mercado Libre Uruguay (${real.suggestedName})`);
  assert(real.results.every((m) => m.thumbnail === null), "La muestra no trae miniaturas: no se inventa ninguna");

  console.log("--- Duplicados, límite por dominio y orden ---");
  const repeated = buildVisualMatches([
    item("https://tienda.com.uy/a"),
    item("https://tienda.com.uy/a"),
    item("https://www.tienda.com.uy/b"),
    item("https://ofertas.tienda.com.uy/c"),
    item("https://tienda.com.uy/d"),
    item("https://otra.com.uy/a"),
  ]);
  assert(repeated.results.map((m) => m.url).join() === "https://tienda.com.uy/a,https://www.tienda.com.uy/b,https://otra.com.uy/a", "La misma dirección no se repite y quedan como mucho 2 por dominio, contando subdominios");
  assert(repeated.uruguayCount === 5, "La cuenta de resultados de Uruguay es la de antes de limitar por dominio (sin duplicados)");
  const manyMl = buildVisualMatches(Array.from({ length: 7 }, (_, i) => item(`https://articulo.mercadolibre.com.uy/MLU-${i}`, { title: i < 3 ? "Termo Stanley Classic 1 Litro Verde | MercadoLibre" : `Termo Stanley edición ${i} Cuotas sin interés` })));
  assert(manyMl.results.length === 2 && manyMl.mlCount === 7 && manyMl.uruguayCount === 7, "Con 7 publicaciones de Mercado Libre se muestran 2 y se informa que hay 7");
  assert(manyMl.suggestedName === "Termo Stanley Classic 1 Litro Verde", `El nombre sale del título más repetido, mirando las 7 y no solo las 2 que se muestran (${manyMl.suggestedName})`);
  const ordered = buildVisualMatches([
    item("https://sinprecio.com.uy/a"),
    item("https://conprecio.com.uy/a", { price: 1500, currency: "UYU" }),
    item("https://monedarara.com.uy/a", { price: 1500, currency: "." }),
    item("https://dolares.com.uy/a", { price: 40, currency: "US$" }),
  ]);
  assert(ordered.results.map((m) => m.site).join() === "conprecio.com.uy,dolares.com.uy,sinprecio.com.uy,monedarara.com.uy", "Entre las tiendas de Uruguay van primero las que traen precio; el resto, en el orden de Google");
  const capped = buildVisualMatches(Array.from({ length: 60 }, (_, i) => item(`https://tienda${i}.com.uy/p`)));
  assert(capped.results.length === VISUAL_LIMITS.maxResults && capped.uruguayCount === 60, `Se devuelven como mucho ${VISUAL_LIMITS.maxResults} resultados`);
  const onlyUnsafe = buildVisualMatches([item("http://tienda.com.uy/a"), item("javascript:alert(1)")]);
  assert(onlyUnsafe.results.length === 0 && onlyUnsafe.suggestedName === "" && onlyUnsafe.uruguayCount === 0, "Si todos los enlaces son inseguros no queda nada");

  console.log("--- Nombre sugerido ---");
  assert(cleanListingTitle("Termo Stanley Classic Legendary Bottle 1.0 Qt De Acero Inox. | MercadoLibre") === "Termo Stanley Classic Legendary Bottle 1.0 Qt De Acero Inox.", "Saca «| MercadoLibre»");
  assert(cleanListingTitle("Termo Stanley Classic 1l - Mercado Libre Uruguay") === "Termo Stanley Classic 1l" && cleanListingTitle("Termo Stanley 📦 Envío gratis | Mercado Libre") === "Termo Stanley", "Saca «Mercado Libre Uruguay», «Envío gratis» y emojis");
  assert(cleanListingTitle("Termo Stanley Classic 1 L Cuotas sin interés") === "Termo Stanley Classic 1 L" && cleanListingTitle("Termo Stanley en 12 cuotas sin interés | MercadoLibre") === "Termo Stanley", "Saca «Cuotas sin interés» (con o sin cantidad)");
  assert(cleanListingTitle("Termo Stanley Classic 1l 2 Picos Original Y Cebador 20% Off | MercadoLibre") === "Termo Stanley Classic 1l 2 Picos Original Y Cebador", "Saca «20% Off»");
  assert(cleanListingTitle("Termo STANLEY CLASSIC 1.0 QT – Stanley Tienda Oficial") === "Termo STANLEY CLASSIC 1.0 QT" && cleanListingTitle("Termo Stanley 1L Linea Classic - Verde — Electroventas") === "Termo Stanley 1L Linea Classic - Verde", "En una tienda saca el nombre del sitio después de la raya, sin tocar el guion del producto");
  assert(cleanListingTitle("Termo Stanley Classic 950ml SILVER - Yerbas Calzada", "Yerbas Calzada") === "Termo Stanley Classic 950ml SILVER", "Saca «- Sitio» cuando coincide con el nombre del sitio");
  assert(cleanListingTitle("x".repeat(300)).length === 120, "El nombre no pasa del largo que admite el Radar");
  assert(mostRepeatedTitle(["Mate imperial", "Termo Stanley", "termo stánley", "Bombilla"]) === "Termo Stanley", "El más repetido gana, sin mirar mayúsculas ni tildes");
  assert(mostRepeatedTitle(["Stanley Termo Classic Original", "Termo Stanley Classic Legendary Bottle 1.0 Qt De Acero Inox."]) === "Stanley Termo Classic Original", "Si ninguno se repite, gana el que más palabras comparte con los demás");
  assert(mostRepeatedTitle([]) === "" && mostRepeatedTitle(["", " ", "-"]) === "", "Sin títulos no hay nombre");
  const noMl = buildVisualMatches([item("https://tienda.com.uy/a", { title: "Mate Imperial Premium – Tienda Uno" }), item("https://otra.com.uy/a", { title: "Mate Imperial Premium | Otra" }), item("https://mercadolibre.com.ar/x", { title: "Otra cosa | MercadoLibre" })]);
  assert(noMl.mlCount === 0 && noMl.suggestedName === "Mate Imperial Premium", "Sin publicaciones de Mercado Libre Uruguay, el nombre sale de las tiendas de Uruguay (nunca de otros países)");
  assert(buildVisualMatches([item("https://mercadolibre.com.ar/x", { title: "Termo | MercadoLibre" }), item("https://www.instagram.com/p/a/")]).suggestedName === "", "Sin resultados de Uruguay no se propone ningún nombre");

  console.log("--- Lo que valida la pantalla ---");
  const fromServer = parseVisualResponse({ ok: true, ...real, cached: false });
  assert(fromServer !== null && JSON.stringify(fromServer.results) === JSON.stringify(real.results) && fromServer.suggestedName === real.suggestedName && fromServer.mlCount === 2 && fromServer.uruguayCount === 5, "Una respuesta válida del servidor llega igual a la pantalla");
  const tampered = parseVisualResponse({
    ok: true,
    suggestedName: `Termo\n${"x".repeat(300)}`,
    mlCount: -4,
    uruguayCount: "muchos",
    cached: "sí",
    results: [
      { url: "javascript:alert(document.domain)", title: "malo", group: "uy_stores" },
      { url: "https://mercadolibre.com.uy.imitador.com/a", title: "Imitador", group: "ml_uy", uruguay: "confirmado", price: { amount: 10, currency: "UYU" } },
      { url: "https://tienda.com.ar/a", title: "Argentina", group: "uy_stores", uruguay: "confirmado", price: { amount: 10, currency: "ARS" } },
      { url: "https://tienda.com.uy/a", title: "Buena", group: "others", price: { amount: "100", currency: "UYU" }, thumbnail: "https://sitio-raro.net/a.jpg", html: "<img src=x onerror=alert(1)>" },
      "texto",
      null,
    ],
  });
  assert(tampered !== null && tampered.results.length === 3 && !JSON.stringify(tampered).includes("javascript:"), "Un enlace javascript: que llegara del servidor no pasa");
  assert(tampered?.results[0].group === "others" && tampered.results[0].price === null && tampered.results[1].group === "abroad" && tampered.results[1].price === null, "La pantalla vuelve a clasificar por el enlace: no le cree al grupo ni al precio que diga el servidor");
  assert(tampered?.results[2].group === "uy_stores" && tampered.results[2].price === null && tampered.results[2].thumbnail === null && !("html" in (tampered.results[2] as object)), "Precio con otro tipo, miniatura de otro origen y campos de más: se descartan");
  assert(tampered?.suggestedName.length === 120 && !/\n/.test(tampered.suggestedName) && tampered.mlCount === 0 && tampered.uruguayCount === 1 && tampered.cached === false, "Nombre acotado y contadores saneados");
  assert(parseVisualResponse(null) === null && parseVisualResponse({ ok: true, results: "muchos" }) === null && parseVisualResponse({ ok: false, results: [] }) === null, "Una respuesta con otra forma se rechaza");

  console.log("--- Llamada a Apify (fetch simulado) ---");
  const fetchCalls: { url: string; headers: Record<string, string>; body: string }[] = [];
  let reply: { status: number; body: unknown } | "hang" | "network" = { status: 201, body: fixture };
  const fakeFetch: FetchLike = (url, init) => {
    fetchCalls.push({ url, headers: init.headers, body: init.body });
    if (reply === "network") return Promise.reject(new Error(`fetch failed con ${TOKEN}`));
    if (reply === "hang") {
      return new Promise((_resolve, reject) => {
        const keepAlive = setInterval(() => {}, 1000);
        init.signal.addEventListener("abort", () => {
          clearInterval(keepAlive);
          reject(new Error("aborted"));
        });
      });
    }
    const { status, body } = reply;
    return Promise.resolve({ status, json: async () => body });
  };
  const lens = createApifyLens({ token: TOKEN, fetch: fakeFetch, timeoutMs: 120 });
  const direct = await lens(JPEG);
  const sent = fetchCalls[0];
  const sentBody = JSON.parse(sent.body);
  assert(direct.length === 10 && fetchCalls.length === 1, "Una búsqueda es una sola llamada a Apify");
  assert(sent.url === APIFY_LENS_URL && /johnvc~google-lens-api\/run-sync-get-dataset-items$/.test(sent.url) && !sent.url.includes("?"), "Va al actor johnvc/google-lens-api, en modo sincrónico y sin parámetros en la dirección");
  assert(sent.headers.Authorization === `Bearer ${TOKEN}` && !sent.url.includes(TOKEN) && !sent.body.includes(TOKEN), "El token viaja solo en el encabezado Authorization: ni en la dirección ni en el cuerpo");
  assert(JSON.stringify(Object.keys(sentBody).sort()) === '["country","image_base64","language","max_results","search_type"]', "El pedido lleva exactamente los cinco campos del actor");
  assert(sentBody.search_type === "visual_matches" && sentBody.max_results === 50 && sentBody.country === "uy" && sentBody.language === "es", "search_type visual_matches (no «products»), 50 resultados, país uy, idioma es");
  assert(Array.isArray(sentBody.image_base64) && sentBody.image_base64.length === 1 && sentBody.image_base64[0] === JPEG.toString("base64") && !sentBody.image_base64[0].startsWith("data:"), "La imagen va en base64, sin el prefijo data:");
  assert(JSON.stringify(lensInput("QUJD")) === '{"image_base64":["QUJD"],"search_type":"visual_matches","max_results":50,"country":"uy","language":"es"}', "lensInput arma el mismo pedido que se probó a mano");
  assert(VISUAL_SEARCH_TIMEOUT_MS === 45_000, "Espera máxima de 45 segundos");
  const failure = async (r: typeof reply) => {
    reply = r;
    const before = fetchCalls.length;
    try {
      await lens(JPEG);
      return { code: "sin error", detail: "", calls: fetchCalls.length - before };
    } catch (err) {
      const e = err as { code?: string; detail?: string };
      return { code: e.code ?? "desconocido", detail: e.detail ?? "", calls: fetchCalls.length - before };
    }
  };
  const f401 = await failure({ status: 401, body: { error: { type: "invalid-token", message: `Token ${TOKEN} is not valid` } } });
  assert(f401.code === "VISUAL_SEARCH_NOT_CONFIGURED" && f401.calls === 1, "401: VISUAL_SEARCH_NOT_CONFIGURED");
  const f402 = await failure({ status: 402, body: { error: { type: "x402-payment-required" } } });
  const f403 = await failure({ status: 403, body: { error: { type: "actor-memory-limit-exceeded-not-enough-usage" } } });
  assert(f402.code === "VISUAL_SEARCH_NO_CREDIT" && f403.code === "VISUAL_SEARCH_NO_CREDIT", "402 o un tipo de error de límite de uso: VISUAL_SEARCH_NO_CREDIT");
  const f500 = await failure({ status: 500, body: { error: { type: "internal" } } });
  const f408 = await failure({ status: 408, body: null });
  assert(f500.code === "VISUAL_SEARCH_UNAVAILABLE" && f408.code === "VISUAL_SEARCH_UNAVAILABLE" && f500.calls === 1, "500 o 408: VISUAL_SEARCH_UNAVAILABLE, sin reintento");
  const fErr = await failure({ status: 201, body: [{ resultType: "error", errorMessage: `Algo falló con ${TOKEN}` }] });
  assert(fErr.code === "VISUAL_SEARCH_UNAVAILABLE" && fErr.detail === "item de error" && fErr.calls === 1, "Corrida SUCCEEDED con un item de error: servicio no disponible, sin reintento y sin copiar el mensaje");
  const fShape = await failure({ status: 200, body: { runId: "x" } });
  assert(fShape.code === "VISUAL_SEARCH_UNAVAILABLE" && fShape.detail === "otra forma", "Respuesta con otra forma: servicio no disponible");
  const fHang = await failure("hang");
  assert(fHang.code === "VISUAL_SEARCH_UNAVAILABLE" && fHang.detail === "tiempo agotado" && fHang.calls === 1, "Si Apify no responde se corta por tiempo, sin reintento");
  const fNet = await failure("network");
  assert(fNet.code === "VISUAL_SEARCH_UNAVAILABLE" && fNet.detail === "error de red" && fNet.calls === 1, "Error de red: servicio no disponible, sin reintento");
  assert([f401, f402, f403, f500, fErr, fShape, fHang, fNet].every((f) => !f.detail.includes(TOKEN) && f.detail.length < 40), "El detalle para el log es corto y nunca lleva el token ni el mensaje del actor");
  reply = { status: 201, body: [] };
  assert((await lens(JPEG)).length === 0, "Dataset vacío: no es un error de Apify, es «sin coincidencias»");

  console.log("--- Límite de uso ---");
  assert(RATE_RULES.visual.scope === "visual" && RATE_RULES.visual.perMinute === 3 && RATE_RULES.visual.perDay === 15, "Scope propio «visual»: 3 por minuto y 15 por día");
  assert(new Set(Object.values(RATE_RULES).map((r) => r.scope)).size === Object.keys(RATE_RULES).length, "Ningún otro límite comparte ese contador");
  const minuteStore = createMemoryRateStore();
  const minute = [];
  for (let i = 0; i < 4; i++) minute.push(await checkRate(minuteStore, "ana", RATE_RULES.visual, NOW));
  assert(minute.slice(0, 3).every((d) => d.ok) && minute[3].ok === false, "Por minuto: pasan 3 y la cuarta se frena");
  assert((await checkRate(minuteStore, "beto", RATE_RULES.visual, NOW)).ok, "El tope es por usuario");
  const dayStore = createMemoryRateStore();
  let dayOk = 0;
  for (let i = 0; i < 15; i++) if ((await checkRate(dayStore, "ana", RATE_RULES.visual, NOW + i * 60_000)).ok) dayOk++;
  const dayBlocked = await checkRate(dayStore, "ana", RATE_RULES.visual, NOW + 15 * 60_000);
  assert(dayOk === 15 && dayBlocked.ok === false && dayBlocked.window === "día", "Por día: pasan 15 y la siguiente se frena hasta el otro día");
  const migration = fs.readFileSync(new URL("../supabase/migrations/20261008120000_ronda5_acceso.sql", import.meta.url), "utf8");
  assert(/p_scope text/.test(migration) && /scope text not null/.test(migration) && !/check\s*\(\s*scope/i.test(migration) && !/scope\s+in\s*\(/i.test(migration), "El contador de Supabase guarda el scope como texto libre: un scope nuevo no necesita migración");

  console.log("--- Memoria por hash ---");
  assert(/^[0-9a-f]{64}$/.test(imageHash(JPEG)) && imageHash(JPEG) === imageHash(Buffer.from(JPEG)) && imageHash(JPEG) !== imageHash(jpeg("b")), "La clave es el SHA-256 de los bytes: igual para la misma foto, distinta para otra");
  let clock = 1_000_000;
  const cache = createVisualCache({ ttlMs: 1000, maxEntries: 3, now: () => clock });
  const summary = (name: string): VisualSummary => ({ results: [], suggestedName: name, mlCount: 0, uruguayCount: 0 });
  cache.set("h1", summary("uno"));
  assert((cache.get("h1") as VisualSummary).suggestedName === "uno" && cache.get("h2") === null, "Devuelve lo guardado para ese hash y nada para otro");
  cache.set("vacía", "sin coincidencias");
  assert(cache.get("vacía") === "sin coincidencias", "También recuerda que una foto no tuvo coincidencias");
  clock += 999;
  assert(cache.get("h1") !== null, "Sigue vigente justo antes de vencer");
  clock += 1;
  assert(cache.get("h1") === null && cache.get("vacía") === null && cache.size() === 0, "Vencida: no se devuelve y se borra");
  for (const h of ["a", "b", "c", "d"]) cache.set(h, summary(h));
  assert(cache.size() === 3 && cache.get("a") === null && cache.get("d") !== null, "Con el tope de entradas sale la más vieja");
  assert(VISUAL_CACHE.ttlMs === 30 * 60 * 1000 && VISUAL_CACHE.maxEntries === 50, "Por defecto: 30 minutos y 50 entradas");

  console.log("--- Endpoint (Apify simulado), sin registrar ni guardar la imagen ---");
  const logs: string[] = [];
  const consoleKeys = ["log", "info", "warn", "error", "debug"] as const;
  const originalConsole = Object.fromEntries(consoleKeys.map((k) => [k, console[k]])) as Record<(typeof consoleKeys)[number], (...a: unknown[]) => void>;
  const diskWrites: string[] = [];
  const fsKeys = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "openSync", "open"] as const;
  const fsAny = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originalFs = Object.fromEntries(fsKeys.map((k) => [k, fsAny[k]]));
  const promisesAny = fs.promises as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originalPromises = { writeFile: promisesAny.writeFile, appendFile: promisesAny.appendFile, open: promisesAny.open };

  // La ruta completa, con el cliente de Apify de verdad y solo el fetch simulado. Mismo armado que server/app.ts.
  let configured = true;
  let rateUser = "ana";
  const limiterStore = createMemoryRateStore();
  const rateLimit = createRateLimiter({ store: () => limiterStore, fallback: limiterStore, userId: () => rateUser, now: () => NOW });
  const routeCache = createVisualCache();
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.post("/api/visual-search", ...createVisualSearchRoute({ lens: () => (configured ? lens : null), limiter: rateLimit(RATE_RULES.visual), cache: routeCache }));
  const server = http.createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/visual-search`;
  const responses: string[] = [];
  let userSeq = 0;
  const post = async (body: Buffer | string, type: string | null, sameUser = false) => {
    if (!sameUser) rateUser = `usuario-${++userSeq}`;
    const res = await fetch(url, { method: "POST", headers: type ? { "Content-Type": type } : {}, body: typeof body === "string" ? body : new Uint8Array(body) });
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

  for (const k of consoleKeys) console[k] = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === "string" ? a : Buffer.isBuffer(a) ? a.toString("latin1") : JSON.stringify(a))).join(" ")); };
  for (const k of fsKeys) fsAny[k] = (...args: unknown[]) => { diskWrites.push(`${k}(${String(args[0])})`); throw new Error("escritura en disco no permitida en este test"); };
  for (const k of Object.keys(originalPromises)) promisesAny[k] = async (...args: unknown[]) => { diskWrites.push(`promises.${k}(${String(args[0])})`); throw new Error("escritura en disco no permitida en este test"); };

  const r: Record<string, Awaited<ReturnType<typeof post>>> = {};
  const callsAt: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<Awaited<ReturnType<typeof post>>>) => {
    const before = fetchCalls.length;
    r[name] = await run();
    callsAt[name] = fetchCalls.length - before;
  };
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  try {
    reply = { status: 201, body: fixture };
    await step("ok", () => post(JPEG, "image/jpeg"));
    await step("cached", () => post(JPEG, "image/jpeg"));
    await step("otherPhoto", () => post(jpeg("otra"), "image/jpeg"));
    await step("png", () => post(PNG, "image/png"));
    reply = { status: 201, body: [] };
    await step("noMatches", () => post(jpeg("sin-coincidencias"), "image/jpeg"));
    await step("noMatchesAgain", () => post(jpeg("sin-coincidencias"), "image/jpeg"));
    reply = { status: 201, body: [{ url: "http://tienda.com.uy/inseguro" }, { url: "javascript:alert(1)" }] };
    await step("onlyUnsafe", () => post(jpeg("solo-inseguros"), "image/jpeg"));
    reply = { status: 201, body: [{ resultType: "error", errorMessage: `Invalid input: ${TOKEN} ${MARKER}` }] };
    await step("errorItem", () => post(jpeg("item-de-error"), "image/jpeg"));
    await step("errorItemAgain", () => post(jpeg("item-de-error"), "image/jpeg"));
    reply = { status: 401, body: { error: { type: "invalid-token", message: `Token ${TOKEN} is not valid` } } };
    await step("badToken", () => post(jpeg("token-malo"), "image/jpeg"));
    reply = { status: 402, body: { error: { type: "x402-payment-required", message: "Payment required" } } };
    await step("noCredit", () => post(jpeg("sin-credito"), "image/jpeg"));
    reply = { status: 500, body: { error: { type: "internal", message: `fallo interno con ${TOKEN}` } } };
    await step("down", () => post(jpeg("caido"), "image/jpeg"));
    reply = "hang";
    await step("timeout", () => post(jpeg("colgado"), "image/jpeg"));
    reply = "network";
    await step("network", () => post(jpeg("sin-red"), "image/jpeg"));

    reply = { status: 201, body: fixture };
    await step("gif", () => post(Buffer.from("GIF89a-esto-es-un-gif"), "image/gif"));
    await step("noType", () => post(JPEG, null));
    await step("jsonBody", () => post(JSON.stringify({ image: "x" }), "application/json"));
    await step("fake", () => post(Buffer.from("esto no es una imagen, aunque diga jpeg"), "image/jpeg"));
    await step("empty", () => post(Buffer.alloc(0), "image/jpeg"));
    await step("tooBig", () => post(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(PHOTO_LIMITS.maxBytes + 10)]), "image/jpeg"));
    configured = false;
    await step("noToken", () => post(jpeg("sin-token"), "image/jpeg"));
    configured = true;

    rateUser = "usuario-frecuente";
    for (let i = 0; i < RATE_RULES.visual.perMinute; i++) await post(jpeg(`frecuente-${i}`), "image/jpeg", true);
    await step("rate", () => post(jpeg("una-más"), "image/jpeg", true));
    await step("rateButCached", () => post(jpeg("frecuente-0"), "image/jpeg", true));
  } finally {
    for (const k of consoleKeys) console[k] = originalConsole[k];
    for (const k of fsKeys) fsAny[k] = originalFs[k];
    for (const k of Object.keys(originalPromises)) promisesAny[k] = originalPromises[k as keyof typeof originalPromises];
    await new Promise<void>((done) => server.close(() => done()));
  }

  const ok = r.ok.data;
  assert(r.ok.status === 200 && ok.ok === true && ok.cached === false && ok.results.length === 10 && callsAt.ok === 1, "Foto válida: 200 con los resultados, con una sola llamada a Apify");
  assert(Object.keys(ok).sort().join() === "cached,mlCount,ok,results,suggestedName,uruguayCount", "La respuesta trae ok, results, suggestedName, mlCount, uruguayCount y cached");
  assert(Object.keys(ok.results[0]).sort().join() === "group,price,site,source,thumbnail,title,url,uruguay", "Cada resultado trae solo los campos que usa la pantalla");
  assert(ok.suggestedName === "Stanley Termo Classic Original" && ok.mlCount === 2 && ok.uruguayCount === 5, "Trae el nombre sugerido y las cantidades de Uruguay");
  assert(r.cached.status === 200 && r.cached.data.cached === true && callsAt.cached === 0 && JSON.stringify(r.cached.data.results) === JSON.stringify(ok.results), "La misma foto otra vez sale de la memoria: no se vuelve a pagar");
  assert(r.otherPhoto.status === 200 && r.otherPhoto.data.cached === false && callsAt.otherPhoto === 1 && r.png.status === 200, "Otra foto (o un PNG) sí hace su búsqueda");
  assert(r.noMatches.status === 404 && r.noMatches.data.code === "VISUAL_SEARCH_NO_MATCHES" && r.noMatches.data.message === VISUAL_MESSAGES.noMatches && callsAt.noMatches === 1, "Sin coincidencias: VISUAL_SEARCH_NO_MATCHES con su mensaje");
  assert(r.noMatchesAgain.status === 404 && r.noMatchesAgain.data.code === "VISUAL_SEARCH_NO_MATCHES" && callsAt.noMatchesAgain === 0, "«Sin coincidencias» también se recuerda: repetir esa foto no vuelve a pagar");
  assert(r.onlyUnsafe.status === 404 && r.onlyUnsafe.data.code === "VISUAL_SEARCH_NO_MATCHES", "Si lo único que vuelve son enlaces inseguros, es «sin coincidencias»");
  assert(r.errorItem.status === 502 && r.errorItem.data.code === "VISUAL_SEARCH_UNAVAILABLE" && r.errorItem.data.message === VISUAL_MESSAGES.unavailable && callsAt.errorItem === 1, "Item de error del actor: VISUAL_SEARCH_UNAVAILABLE, una sola llamada");
  assert(callsAt.errorItemAgain === 1, "Un error no se guarda en la memoria");
  assert(r.badToken.status === 503 && r.badToken.data.code === "VISUAL_SEARCH_NOT_CONFIGURED" && r.badToken.data.message === VISUAL_MESSAGES.notConfigured, "Token inválido (401): VISUAL_SEARCH_NOT_CONFIGURED");
  assert(r.noToken.status === 503 && r.noToken.data.code === "VISUAL_SEARCH_NOT_CONFIGURED" && callsAt.noToken === 0, "Sin APIFY_TOKEN: VISUAL_SEARCH_NOT_CONFIGURED, sin llamar a nadie");
  assert(r.noCredit.status === 503 && r.noCredit.data.code === "VISUAL_SEARCH_NO_CREDIT" && r.noCredit.data.message === VISUAL_MESSAGES.noCredit, "Sin crédito (402): VISUAL_SEARCH_NO_CREDIT con su mensaje");
  for (const k of ["down", "timeout", "network"]) {
    assert(r[k].status === 502 && r[k].data.code === "VISUAL_SEARCH_UNAVAILABLE" && callsAt[k] === 1, `Apify falla («${k}»): VISUAL_SEARCH_UNAVAILABLE, sin reintentar por su cuenta`);
  }
  assert(r.gif.status === 415 && r.gif.data.code === "UNSUPPORTED_IMAGE" && r.noType.status === 415 && r.jsonBody.status === 415, "Tipo que no es JPG, PNG ni WebP (o sin tipo, o JSON): 415");
  assert(r.fake.status === 400 && r.fake.data.code === "NOT_AN_IMAGE", "Dice ser JPEG pero los bytes no lo son: 400 (se mira la firma de bytes)");
  assert(r.empty.status === 400 && r.empty.data.code === "INVALID_IMAGE", "Cuerpo vacío: 400");
  assert(r.tooBig.status === 413 && r.tooBig.data.code === "IMAGE_TOO_LARGE", "Más de 3 MB: 413");
  assert(["gif", "noType", "jsonBody", "fake", "empty", "tooBig", "noToken", "rate"].every((k) => callsAt[k] === 0), "Ningún pedido rechazado llega a gastar una búsqueda en Apify");
  assert(r.rate.status === 429 && r.rate.data.code === "RATE_LIMITED" && r.rate.retryAfter === "55" && /3 usos por minuto/.test(r.rate.data.message), "Pasado el tope por minuto: 429 con Retry-After y mensaje en español");
  assert(r.rateButCached.status === 200 && r.rateButCached.data.cached === true && callsAt.rateButCached === 0, "Una foto que está en memoria se responde aunque el usuario esté en el tope: no gasta nada");
  for (const k of Object.keys(r)) {
    if (r[k].status !== 200) assert(r[k].data?.ok === false && typeof r[k].data.message === "string" && r[k].data.message === r[k].data.error, `Error «${k}»: JSON con ok:false y el mismo texto en message y error`);
  }
  assert(Object.keys(r).filter((k) => r[k].status !== 200).every((k) => !/apify|lens|token|HTTP \d|invalid|x402|internal|discontinued/i.test(r[k].data.message)), "Ningún mensaje de error nombra al proveedor, al token ni copia el mensaje crudo");

  const base64 = JPEG.toString("base64");
  const leaked = (text: string) => text.includes(MARKER) || text.includes(base64.slice(0, 60)) || text.includes(JPEG.toString("hex").slice(0, 60));
  assert(logs.length > 0, `Queda un registro mínimo para depurar (${logs.length} líneas)`);
  assert(!logs.some(leaked), "Ningún log contiene la imagen (ni en texto, ni en base64, ni en hexadecimal)");
  assert(!responses.some(leaked), "Ninguna respuesta devuelve la imagen");
  assert(!logs.some((l) => l.includes(TOKEN) || /apify_api_|Bearer/i.test(l)), "El token no aparece en ningún log");
  assert(!responses.some((t) => t.includes(TOKEN) || /apify_api_|Bearer/i.test(t)), "El token no aparece en ninguna respuesta");
  assert(!logs.some((l) => l.includes(imageHash(JPEG)) || /[0-9a-f]{64}/.test(l)), "El hash de la foto tampoco queda en los logs");
  assert(!logs.some((l) => /stanley|mercadolibre|matesuru|electroventas|Invalid input/i.test(l)), "Los logs no llevan los sitios, los títulos ni el mensaje del actor");
  assert(logs.every((l) => l.length < 160), "Cada línea de log es corta: cantidad de resultados o código de error");
  assert(fetchCalls.every((c) => c.url === APIFY_LENS_URL && !c.url.includes(TOKEN)), "Todas las llamadas fueron a la misma dirección de Apify, sin el token");
  assert(diskWrites.length === 0, `No se escribió nada en disco${diskWrites.length ? `: ${diskWrites.join(", ")}` : ""}`);
  const cacheDump = JSON.stringify([...Array(1)].map(() => routeCache.get(imageHash(JPEG))));
  assert(routeCache.size() > 0 && !leaked(cacheDump), "En la memoria queda la respuesta, no la imagen");

  const source = fs.readFileSync(new URL("../server/visualSearch.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert(!/from "node:fs"|from "fs"|writeFile|appendFile|createWriteStream|supabase|cloud\.js/i.test(code), "server/visualSearch.ts no usa el sistema de archivos ni Supabase");
  const logLines = code.split("\n").filter((l) => /console\./.test(l));
  assert(logLines.length > 0 && logLines.every((l) => !/token|bytes|hash|base64|image|url|headers|body|errorMessage/i.test(l)), "Ningún console.* recibe el token, la imagen, su hash ni los enlaces");
  assert((code.match(/options\.fetch\(/g) ?? []).length === 1 && !/\bfetch\(/.test(code.replace(/options\.fetch\(/g, "")) && /options\.fetch\(APIFY_LENS_URL,/.test(code), "El único pedido de red del archivo va a la dirección fija de Apify: los enlaces de los resultados nunca se visitan");
  assert(!/[?&]token=/.test(source) && !/"products"/.test(code), "El código no arma ninguna dirección con ?token= ni usa el search_type discontinuado");
  assert(/cache\.set\(hash,/.test(code) && !/cache\.set\(bytes|entries\.set\([^,]*bytes/.test(code), "La memoria se indexa por el hash, nunca por la imagen");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de búsqueda visual`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
