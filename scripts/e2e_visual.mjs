// Prueba en navegador de la búsqueda visual de la pestaña «Por foto» (ronda 13).
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_visual.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// /api/visual-search, /api/identify-product, /api/web-sellers, /api/search-mlu y las miniaturas se simulan acá:
// no se llama a Apify, a Gemini, a Mercado Libre ni a Google.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3917/";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.argv[2] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let total = 0;
function assert(condition, message) {
  total++;
  if (condition) passed++;
  console.log(`${condition ? "✅ [PASS]" : "❌ [FAIL]"} ${message}`);
}

// --- Archivos de prueba (en una carpeta temporal, se borran al final) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};
/** PNG liso de w × h, armado a mano para no depender de ninguna librería. */
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uymargin-foto-"));
const file = (name, data) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};
const PHOTO = file("termo.png", png(1600, 1200, [30, 110, 70]));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
// Los 4xx/5xx simulados dejan un «Failed to load resource» del navegador: es lo esperado, no un error de la app.
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});

const queries = [];
const visualCalls = [];
const identify = [];
const webCalls = [];
const thumbRequests = [];
let visualMode = "ok";
let visualDelayMs = 0;
let identifyMode = "ok";
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:miniatura-de-prueba";
const match = (url, title, group, extra = {}) => ({ site: new URL(url).hostname.replace(/^www\./, ""), source: "", url, title, group, uruguay: null, price: null, thumbnail: null, ...extra });
const MATCHES = [
  match("https://articulo.mercadolibre.com.uy/MLU-1-stanley-termo-classic-original-_JM", "Stanley Termo Classic Original", "ml_uy", { uruguay: "confirmado", source: "Mercado Libre Uruguay", thumbnail: THUMB }),
  match("https://www.mercadolibre.com.uy/termo-stanley-classic-legendary/up/MLUU2", "Termo Stanley Classic Legendary Bottle 1.0 Qt | MercadoLibre", "ml_uy", { uruguay: "confirmado" }),
  match("https://stanley1913.uy/producto/termo-stanley-classic/", "Termo STANLEY CLASSIC LEGENDARY BOTTLE 1.0 QT – Stanley Tienda Oficial", "uy_stores", { uruguay: "confirmado", price: { amount: 3722, currency: "UYU" } }),
  match("https://matesuru.com/producto/stanley-rojo-sin-asa", "Stanley rojo sin asa Rojo 591 ml – Matesuru", "uy_stores", { uruguay: "probable", price: { amount: 2850, currency: "UYU" } }),
  // Miniatura de un origen que no es Google: no se tiene que pedir ni mostrar.
  match("https://electroventas.com.uy/catalogo/termo-stanley-1l", "Termo Stanley 1L Linea Classic - Verde — Electroventas", "uy_stores", { uruguay: "confirmado", thumbnail: "https://sitio-raro.example.net/rastreo.jpg" }),
  match("https://www.mercadolibre.com.ar/termo-stanley-classic-1l/up/MLAU3", "Termo Stanley Classic 1l 2 Picos | MercadoLibre", "abroad"),
  match("https://stanley1913.com.ve/products/termo-stanley-classic", "Termo Stanley Classic Legendary | 1 QT (946ml)", "abroad", { price: { amount: 75, currency: "USD" } }),
  // Moneda inválida: el precio no se muestra.
  match("https://yerbascalzada.com/productos/termo-stanley-classic-950ml-silver/", "Termo Stanley Classic 950ml SILVER - Yerbas Calzada", "abroad", { price: { amount: 159500, currency: "." } }),
  match("https://www.instagram.com/p/DWhZ0jYEQIq/", "Termo Stanley original Pedime el tuyo", "others"),
  match("https://www.idealo.de/preisvergleich/OffersOfProduct/5444562.html", "Stanley Isolierflasche 1 L ab 59,95 €", "others"),
  // Lo que el servidor no debería mandar nunca; la pantalla igual lo tiene que frenar.
  { site: "enlacemalo.com.uy", source: "", url: "javascript:alert(document.domain)", title: "Enlace malo", group: "uy_stores", uruguay: "confirmado", price: null, thumbnail: null },
  match("https://mercadolibre.com.uy.ofertas-termo.com/termo", "Oferta imperdible Mercado Libre", "ml_uy", { uruguay: "confirmado", price: { amount: 990, currency: "UYU" } }),
];
const VISUAL_OK = { ok: true, results: MATCHES, suggestedName: "Stanley Termo Classic Original", recognizedAs: "Termo Stanley Classic Legendary", mlCount: 7, uruguayCount: 10, cached: false };
const VISUAL_ERRORS = {
  notConfigured: [503, "VISUAL_SEARCH_NOT_CONFIGURED", "La búsqueda visual no está configurada en el servidor."],
  noCredit: [503, "VISUAL_SEARCH_NO_CREDIT", "Se agotó el crédito del servicio de búsqueda visual."],
  unavailable: [502, "VISUAL_SEARCH_UNAVAILABLE", "La búsqueda visual no respondió en este momento."],
  timeout: [504, "VISUAL_SEARCH_TIMEOUT", "La búsqueda visual tardó demasiado."],
  noMatches: [404, "VISUAL_SEARCH_NO_MATCHES", "Google Lens no encontró coincidencias para esa foto."],
  rate: [429, "RATE_LIMITED", "Llegaste al límite de 3 usos por minuto. Probá de nuevo en 40 segundos."],
};
const IDENTIFIED = { ok: true, isProduct: true, name: "Termo Stanley Classic 1 litro", alternatives: ["Termo Stanley"], brand: "Stanley", category: "Termos", attributes: ["verde"], confidence: "media", notes: "La marca se lee en el frente." };
const item = (id, price) => ({ id, title: `Termo Stanley Classic ${id}`, price, currency: "UYU", condition: "new", thumbnail: null, permalink: `https://example.com/${id}`, freeShipping: false, activeSellersCount: 2, match: { matches: true, missing: [] } });
const TINY_PNG = png(8, 8, [200, 200, 200]);
await page.setRequestInterception(true);
page.on("request", async (req) => {
  const url = new URL(req.url());
  const json = (body, status = 200, headers = {}) => req.respond({ status, contentType: "application/json", headers, body: JSON.stringify(body) }).catch(() => {});
  // Nada sale a internet: las miniaturas de Google se responden acá y cualquier otro origen externo se corta.
  if (url.hostname.endsWith("gstatic.com") && url.pathname === "/images") {
    thumbRequests.push({ url: req.url(), referer: req.headers().referer ?? null });
    return req.respond({ status: 200, contentType: "image/png", body: TINY_PNG }).catch(() => {});
  }
  if (url.hostname.endsWith("example.net")) {
    thumbRequests.push({ url: req.url(), referer: req.headers().referer ?? null });
    return req.abort().catch(() => {});
  }
  if (url.pathname === "/api/exchange-rate") return json({ ok: true, rate: 40.5, referenceDate: "2026-10-08", fetchedAt: new Date().toISOString(), stale: false });
  if (url.pathname === "/api/visual-search") {
    visualCalls.push({ method: req.method(), type: req.headers()["content-type"], hasBody: req.hasPostData(), authInUrl: /token|key/i.test(url.search) });
    if (visualDelayMs) await sleep(visualDelayMs);
    if (VISUAL_ERRORS[visualMode]) {
      const [status, code, message] = VISUAL_ERRORS[visualMode];
      return json({ ok: false, code, message, error: message }, status, visualMode === "rate" ? { "Retry-After": "40" } : {});
    }
    // Lo que devuelve la plataforma si corta la función antes de que responda: un 504 que no es JSON.
    if (visualMode === "platformTimeout") return req.respond({ status: 504, contentType: "text/plain", body: "FUNCTION_INVOCATION_TIMEOUT" }).catch(() => {});
    if (visualMode === "garbage") return json({ ok: true, results: "muchos" });
    if (visualMode === "few") return json({ ok: true, results: [MATCHES[2], MATCHES[5], MATCHES[8]], suggestedName: "Termo STANLEY CLASSIC LEGENDARY BOTTLE 1.0 QT", recognizedAs: "Termo Stanley Classic", mlCount: 0, uruguayCount: 1, cached: false });
    if (visualMode === "abroadOnly") return json({ ok: true, results: [MATCHES[5], MATCHES[6], MATCHES[8]], suggestedName: "", recognizedAs: "Artemide Nessino Table Lamp", mlCount: 0, uruguayCount: 0, cached: false });
    return json(VISUAL_OK);
  }
  if (url.pathname === "/api/identify-product") {
    identify.push({ method: req.method(), type: req.headers()["content-type"], hasBody: req.hasPostData() });
    if (identifyMode === "fail") return json({ ok: false, code: "AI_ERROR", message: "La IA no pudo analizar la foto en este momento. Probá de nuevo en unos minutos o escribí el nombre en el Radar.", error: "x" }, 502);
    return json(IDENTIFIED);
  }
  if (url.pathname === "/api/web-sellers") {
    webCalls.push(req.postData());
    return json({ ok: true, query: "x", results: [], searchQueries: [], cached: false });
  }
  if (url.pathname !== "/api/search-mlu") return req.continue();
  const q = url.searchParams.get("q") || "";
  queries.push(q);
  const base = { ok: true, query: q, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() };
  const prices = [2400, 2450, 2500, 2500, 2550, 2600];
  return json({ ...base, total: prices.length, items: prices.map((p, i) => item(`P${i}`, p)), stats: { sampleSize: 6, outliersRemoved: 0, min: 2400, max: 2600, average: 2500, median: 2500 }, relevance: null });
});

await page.goto(APP_URL, { waitUntil: "networkidle2" });
await sleep(1000);
const click = (re, scope = "#mercado") =>
  page.evaluate((sel, src) => {
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src, "i").test(x.textContent) && x.offsetParent !== null && !x.disabled);
    b?.click();
    return !!b;
  }, scope, re);
const visible = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((n) => n.offsetParent !== null), sel);
const textOf = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null).map((n) => n.innerText.replace(/\s+/g, " ").trim()).join(" | "), sel);
const upload = async (p) => {
  const input = await page.$('#mercado input[data-photo-input="file"]');
  await input.uploadFile(p);
  await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
};
const NAME = "#photo-name-input";
const nameValue = () => page.$eval(NAME, (el) => el.value).catch(() => null);
const retype = async (text) => {
  await page.focus(NAME);
  await page.$eval(NAME, (el) => el.select());
  await page.keyboard.press("Backspace");
  await page.type(NAME, text);
};
const overflow = () =>
  page.evaluate(() => {
    const m = document.querySelector("#mercado");
    const limit = Math.min(m.getBoundingClientRect().right, innerWidth) + 1;
    return [...m.querySelectorAll("*:not(.visually-hidden)")].filter((n) => n.offsetParent !== null && !n.closest(".overflow-x-auto") && n.getBoundingClientRect().right > limit).map((n) => `${n.tagName}.${String(n.className).slice(0, 30)}`).slice(0, 3);
  });
const shot = async (name, width) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: await page.$eval("#mercado", (el, w) => { const b = el.getBoundingClientRect(); return { x: w === 390 ? 0 : b.left, y: b.top + scrollY, width: w === 390 ? 390 : b.width, height: Math.min(b.height, 2400) }; }, width) });
};
const FOTO = "#mercado #photo-panel-foto";
const PRIVACY = "La foto se envía a un servicio externo de búsqueda visual (Apify / Google Lens). UyMargin no la guarda.";
const cards = () =>
  page.$$eval(`${FOTO} [data-visual-match]`, (els) =>
    els.map((el) => ({
      site: el.getAttribute("data-visual-match"),
      group: el.closest("[data-visual-group]")?.getAttribute("data-visual-group") ?? null,
      shown: el.checkVisibility(),
      price: el.querySelector("[data-visual-price]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
      uruguay: el.querySelector("[data-visual-uruguay]")?.innerText.trim() ?? null,
      img: el.querySelector("img")?.getAttribute("src") ?? null,
      imgPolicy: el.querySelector("img")?.getAttribute("referrerpolicy") ?? null,
      link: el.querySelector("a")?.href ?? null,
      target: el.querySelector("a")?.target ?? null,
      rel: el.querySelector("a")?.rel ?? null,
    }))
  );
const errorBox = () => page.$eval(`${FOTO} [data-visual-error]`, (el) => `${el.getAttribute("data-visual-error")}|${el.getAttribute("role")}|${el.querySelector("[data-visual-retry]") ? "con-reintento" : "sin-reintento"}`).catch(() => "");
const searchPhoto = async (mode, waitFor) => {
  visualMode = mode;
  if (await visible('#mercado button[aria-label="Quitar la foto"]')) {
    await page.click('#mercado button[aria-label="Quitar la foto"]');
    await sleep(150);
  }
  await upload(PHOTO);
  await click("Buscar dónde se vende");
  await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => null);
  await sleep(150);
};

// --- Aviso de privacidad, antes de subir nada ---
await click("^Por foto$");
await page.waitForSelector('#mercado input[data-photo-input="file"]', { timeout: 15000 });
assert((await textOf("#mercado [data-visual-privacy]")) === PRIVACY, "El aviso de privacidad se ve antes de subir la foto, con el texto pedido");
assert(/dónde se vende en Uruguay/.test(await textOf("#mercado")), "La pestaña explica que la foto sirve para ver dónde se vende en Uruguay");

// --- La foto no se busca sola ---
await upload(PHOTO);
assert(visualCalls.length === 0 && identify.length === 0 && queries.length === 0, "Elegir la foto no gasta una búsqueda visual, ni la IA, ni busca en Mercado Libre");
assert(/^Buscar dónde se vende$/i.test(await textOf("#mercado [data-visual-search]")) && (await page.$("#mercado [data-ai-identify]")) === null, "El paso principal es «Buscar dónde se vende»; la IA no se ofrece todavía");
assert((await page.$(NAME)) === null && (await page.$("#mercado [role='tablist']")) === null, "Antes de buscar no hay nombre ni vistas");
assert((await textOf("#mercado [data-visual-privacy]")) === PRIVACY, "El aviso de privacidad sigue visible con la foto cargada");

// --- Cargando y cancelar ---
visualDelayMs = 1500;
await click("Buscar dónde se vende");
await page.waitForFunction(() => /Buscando… puede tardar hasta 1 minuto/.test(document.querySelector("#mercado").innerText), { timeout: 5000 }).catch(() => null);
assert(/^Buscando… puede tardar hasta 1 minuto$/.test(await textOf("#mercado [role='status']")) && (await click("^Cancelar$")), "Mientras busca muestra «Buscando… puede tardar hasta 1 minuto» (role=status) y deja cancelar");
await sleep(1800);
assert((await page.$(`${FOTO} [data-visual-results]`)) === null && (await page.$(NAME)) === null && /Cancelaste la búsqueda\. La foto sigue cargada\./.test(await textOf("#mercado [role='status']")), "Cancelada: no aparecen resultados aunque la respuesta llegue después");
assert((await visible("#mercado img[data-photo-preview]")) && (await visible("#mercado [data-visual-search]")), "Cancelar no quita la foto y deja buscar de nuevo");
visualDelayMs = 0;

// --- Resultados ---
const callsBefore = visualCalls.length;
await click("Buscar dónde se vende");
await page.waitForSelector(`${FOTO} [data-visual-results]`, { timeout: 10000 });
await sleep(400);
const sent = visualCalls.at(-1);
assert(visualCalls.length === callsBefore + 1 && sent.method === "POST" && sent.type === "image/jpeg" && sent.hasBody && !sent.authInUrl, `La foto achicada viaja como JPEG en el cuerpo de un POST (${sent.type})`);
assert((await nameValue()) === "Stanley Termo Classic Original", `El nombre sugerido queda precargado en el campo editable (${await nameValue()})`);
assert(await page.$eval(NAME, (el) => !el.readOnly && !el.disabled && document.querySelector(`label[for="${el.id}"]`) !== null && document.activeElement === el), "El campo es editable, tiene etiqueta y recibe el foco");
assert((await page.$("#mercado [data-photo-confidence]")) === null, "Sin IA no se muestra un nivel de confianza de la IA");
const tabs = await page.evaluate(() => [...document.querySelectorAll("#mercado [role='tab']")].map((t) => `${t.textContent.trim()}:${t.getAttribute("aria-selected")}`).join(" | "));
assert(tabs === "Según la foto:true | En la web (Uruguay):false", `Dos vistas: «Según la foto» (elegida) y «En la web (Uruguay)» (${tabs})`);
assert(/^Analizar en Radar$/i.test(await textOf("#mercado [data-radar-search]")), "El botón junto al nombre es «Analizar en Radar»");
assert(/10 resultados de Uruguay para esta foto\./.test(await textOf(`${FOTO} [data-visual-results] [role='status']`)) && /pueden ser productos parecidos, no idénticos/.test(await textOf(FOTO)), "Dice cuántos resultados de Uruguay hay y aclara que pueden ser productos parecidos");

let c = await cards();
const by = (g) => c.filter((x) => x.group === g);
assert(by("ml_uy").map((x) => x.site).join() === "articulo.mercadolibre.com.uy,mercadolibre.com.uy" && by("ml_uy").every((x) => x.shown), "Mercado Libre Uruguay tiene su bloque, a la vista");
const mlText = await textOf(`${FOTO} [data-visual-group="ml_uy"]`);
assert(/^Mercado Libre Uruguay \(7\)/i.test(mlText) && /Se muestran 2 de 7 publicaciones\./.test(mlText) && /usá «Analizar en Radar»/.test(mlText), "El bloque dice la cantidad (7), que se muestran 2 y que los precios reales están en el Radar");
assert(by("uy_stores").map((x) => x.site).join() === "stanley1913.uy,matesuru.com,electroventas.com.uy" && by("uy_stores").every((x) => x.shown) && /^Tiendas de Uruguay \(3\)/i.test(await textOf(`${FOTO} [data-visual-group="uy_stores"]`)), "Tiendas de Uruguay: bloque propio con su cantidad");
assert(by("uy_stores")[0].price === "$U 3.722 (precio informado por Google, confirmar en la tienda)" && by("uy_stores")[1].price === "$U 2.850 (precio informado por Google, confirmar en la tienda)", `El precio en pesos lleva el rótulo «precio informado por Google, confirmar en la tienda» (${by("uy_stores")[0].price})`);
assert(by("uy_stores")[2].price === null && by("ml_uy").every((x) => x.price === null), "Sin precio informado no se muestra ninguno");
assert(by("uy_stores")[0].uruguay === "Uruguay: confirmado" && by("uy_stores")[1].uruguay === "Uruguay: probable", "Un .uy dice «confirmado»; una tienda .com con precio en pesos, «probable»");
assert(by("abroad").map((x) => x.site).join() === "mercadolibre.com.ar,stanley1913.com.ve,yerbascalzada.com" && by("abroad").every((x) => !x.shown) && (await page.$eval(`${FOTO} details[data-visual-group="abroad"]`, (d) => !d.open)), "Otros países van plegados");
assert(/^Otros países o sin confirmar: confirmá que envían a Uruguay \(3\)$/.test(await textOf(`${FOTO} details[data-visual-group="abroad"] summary`)), "El bloque de otros países avisa que hay que confirmar el envío a Uruguay");
assert(by("abroad")[1].price === "US$ 75 (precio informado por Google, confirmar en la tienda)" && by("abroad")[2].price === null, "Precio en US$ se muestra; el de moneda inválida («.») no");
assert(by("others").map((x) => x.site).join() === "instagram.com,idealo.de,mercadolibre.com.uy.ofertas-termo.com" && by("others").every((x) => !x.shown && x.price === null && x.uruguay === null), "Instagram, Idealo y el dominio imitador van a «Otros resultados», plegado y sin precio");
assert(!c.some((x) => x.site === "enlacemalo.com.uy") && !(await page.evaluate((s) => document.querySelector(s).innerHTML.includes("javascript:"), FOTO)), "Un enlace javascript: que llegara del servidor no se muestra");
assert(c.length === 11 && c.every((x) => x.link.startsWith("https://") && x.target === "_blank" && x.rel === "noopener noreferrer"), `Todos los enlaces son https, abren en pestaña nueva y llevan rel="noopener noreferrer" (${c.length})`);
assert(c[0].img === THUMB && c[0].imgPolicy === "no-referrer" && c.filter((x) => x.img !== null).length === 1, "La miniatura de Google se muestra, sin referrer; la de otro origen no");
// La miniatura es lazy: se pide recién cuando se acerca a la pantalla.
assert(thumbRequests.length === 0 || thumbRequests[0].url === THUMB, "Las miniaturas se cargan de forma diferida");
await page.$eval(`${FOTO} [data-visual-match] img`, (img) => img.scrollIntoView({ block: "center" }));
await page.waitForFunction((sel) => { const img = document.querySelector(`${sel} [data-visual-match] img`); return !!img && img.complete && img.naturalWidth > 0; }, { timeout: 8000 }, FOTO).catch(() => null);
assert(thumbRequests.length === 1 && thumbRequests[0].url === THUMB && !thumbRequests[0].referer, `El navegador solo pidió la miniatura de Google, y sin decir desde qué página (${JSON.stringify(thumbRequests)})`);
assert((await page.$("#mercado [data-ai-identify]")) === null && identify.length === 0 && (await page.$("#mercado [data-ai-name-note]")) === null, "Con 3 o más resultados de Uruguay la IA no corre ni se ofrece");
assert((await page.$(`${FOTO} [data-visual-recognized]`)) === null, "Habiendo resultados de Uruguay no se muestra «Google Lens lo reconoce como»");
assert((await overflow()).length === 0, "Resultados a 1280 px: sin desborde horizontal");
await shot("r13-visual-resultados-1280", 1280);
await page.click(`${FOTO} details[data-visual-group="abroad"] summary`);
await sleep(200);
c = await cards();
assert(c.filter((x) => x.group === "abroad").every((x) => x.shown), "Al abrir «Otros países» se ven sus resultados");
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const o390 = await overflow();
assert(o390.length === 0, `Resultados a 390 px: sin desborde horizontal${o390.length ? ` (${o390.join(", ")})` : ""}`);
await shot("r13-visual-resultados-390", 390);
await page.setViewport({ width: 1280, height: 900 });
await sleep(300);

// --- Analizar en Radar: la búsqueda de siempre, con el nombre del campo ---
await click("Analizar en Radar");
await page.waitForSelector("#mercado [data-reliability]", { timeout: 15000 }).catch(() => null);
assert(queries.join("|") === "Stanley Termo Classic Original", `«Analizar en Radar» busca en Mercado Libre con el nombre sugerido (${queries.join("|")})`);
assert((await textOf("#mercado [data-reliability]")).toLowerCase() === "dato sólido" && /2\.500/.test(await textOf("#mercado")), "Se ve el resumen de mercado del Radar, con precios reales");
await retype("Termo Stanley Classic");
await page.keyboard.press("Enter");
await sleep(800);
assert(queries.at(-1) === "Termo Stanley Classic" && visualCalls.length === callsBefore + 1 && identify.length === 0, "Corregir el nombre y buscar de nuevo no gasta otra búsqueda visual ni usa la IA");
assert((await page.$$eval(`${FOTO} [data-visual-match]`, (e) => e.length)) === 11, "Los resultados de la foto siguen ahí después de analizar en el Radar");

// --- La vista web por nombre sigue disponible ---
await click("^En la web \\(Uruguay\\)$");
await sleep(200);
assert(/^Buscar en la web de Uruguay$/i.test(await textOf("#mercado [data-web-search]")) && (await page.$eval("#mercado #photo-panel-foto", (el) => el.hidden)), "«En la web (Uruguay)» sigue disponible una vez que hay nombre");
const google = await page.$$eval("#mercado #photo-panel-web a[data-google]", (as) => as.map((a) => new URL(a.href).searchParams.get("q")));
assert(google.length === 2 && google[0] === "Termo Stanley Classic Uruguay" && webCalls.length === 0, "Sus botones de Google usan el nombre del campo, y abrir la vista no busca nada");
await click("^Según la foto$");
await sleep(200);

// --- El estado se conserva al cambiar de pestaña ---
await click("^Lote CSV$");
await sleep(500);
await click("^Por foto$");
await sleep(300);
assert((await nameValue()) === "Termo Stanley Classic" && (await page.$$eval(`${FOTO} [data-visual-match]`, (e) => e.length)) === 11 && visualCalls.length === callsBefore + 1, "Ir a Lote CSV y volver conserva el nombre y los resultados, sin repetir la búsqueda visual");

// --- Menos de 3 resultados de Uruguay: el nombre se le pide solo a la IA ---
const aiNote = () => textOf("#mercado [data-ai-name-note]");
const waitAi = () => page.waitForSelector("#mercado [data-ai-name-note]", { timeout: 10000 }).catch(() => null);
let aiCalls = identify.length;
let visualBefore = visualCalls.length;
await searchPhoto("few", `${FOTO} [data-visual-results]`);
await waitAi();
assert(/1 resultado de Uruguay para esta foto\./.test(await textOf(`${FOTO} [data-visual-results] [role='status']`)), "Con una sola tienda de Uruguay lo dice");
assert(identify.length === aiCalls + 1 && identify.at(-1).method === "POST" && identify.at(-1).type === "image/jpeg" && identify.at(-1).hasBody, "Con menos de 3 resultados de Uruguay se llama sola a /api/identify-product, con la misma foto");
assert(visualCalls.length === visualBefore + 1, "Pedir el nombre a la IA no gasta otra búsqueda visual");
assert((await nameValue()) === IDENTIFIED.name, `El nombre de la IA queda precargado y reemplaza al que había salido de la única tienda (${await nameValue()})`);
assert(/^Nombre sugerido por IA a partir de la foto: «Termo Stanley Classic 1 litro»\.$/.test(await aiNote()) && (await textOf("#mercado [data-photo-confidence]")) === "Puede ser", `La pantalla aclara «Nombre sugerido por IA a partir de la foto» (${await aiNote()})`);
assert((await page.$("#mercado [data-ai-identify]")) === null && (await page.$$eval(`${FOTO} [data-visual-match]`, (e) => e.length)) === 3, "Los resultados de la foto siguen a la vista; con el nombre ya puesto, el botón de la IA no hace falta");
assert((await page.$(`${FOTO} [data-visual-recognized]`)) === null, "Con algún resultado de Uruguay no se muestra «Google Lens lo reconoce como»");
assert(queries.length === 2, "El nombre automático no dispara ninguna búsqueda en Mercado Libre");

// --- Resultados solo del exterior: «Google Lens lo reconoce como» ---
aiCalls = identify.length;
await searchPhoto("abroadOnly", `${FOTO} [data-visual-results]`);
await waitAi();
assert(/No encontré esta foto en sitios de Uruguay/.test(await textOf(`${FOTO} [data-visual-results] [role='status']`)), "Sin resultados de Uruguay lo dice");
assert((await page.$eval(`${FOTO} [data-visual-recognized]`, (el) => el.textContent.replace(/\s+/g, " ").trim()).catch(() => null)) === "Google Lens lo reconoce como: Artemide Nessino Table Lamp", "Debajo de los grupos aparece «Google Lens lo reconoce como: …»");
assert(await page.evaluate((sel) => { const line = document.querySelector(`${sel} [data-visual-recognized]`); const groups = [...document.querySelectorAll(`${sel} [data-visual-group]`)]; return !!line && groups.length === 2 && groups.every((g) => g.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) && line.querySelector("a, button") === null; }, FOTO), "Ese renglón va después de los grupos y es solo texto: no es un botón ni un enlace");
assert(identify.length === aiCalls + 1 && (await nameValue()) === IDENTIFIED.name && /Nombre sugerido por IA a partir de la foto/.test(await aiNote()), "Con 0 resultados de Uruguay el nombre lo pone la IA, no el texto de Lens");
assert(queries.length === 2 && webCalls.length === 0, "«Lo reconoce como» es informativo: no se busca nada con ese texto");
await shot("r13-visual-exterior-1280", 1280);

// --- Sin ninguna coincidencia: mensaje propio y nombre automático ---
aiCalls = identify.length;
await searchPhoto("noMatches", `${FOTO} [data-visual-error]`);
await waitAi();
const noMatchText = await textOf(`${FOTO} [data-visual-error]`);
assert((await page.$eval(`${FOTO} [data-visual-error]`, (el) => `${el.getAttribute("data-visual-error")}|${el.getAttribute("role")}|${el.querySelector("[data-visual-retry]") ? "con-reintento" : "sin-reintento"}`)) === "VISUAL_SEARCH_NO_MATCHES|alert|sin-reintento" && /^Google Lens no encontró coincidencias para esa foto\./.test(noMatchText), `0 resultados: «Google Lens no encontró coincidencias para esa foto» (${noMatchText.slice(0, 60)}…)`);
assert(identify.length === aiCalls + 1 && (await nameValue()) === IDENTIFIED.name && /Nombre sugerido por IA/.test(await aiNote()), "Con 0 resultados también se le pide el nombre a la IA sola");

// --- Si la IA automática falla, queda el botón manual ---
identifyMode = "fail";
aiCalls = identify.length;
await searchPhoto("abroadOnly", `${FOTO} [data-visual-results]`);
await page.waitForSelector("#mercado [data-photo-error]", { timeout: 10000 }).catch(() => null);
assert(identify.length === aiCalls + 1 && (await nameValue()) === "" && (await page.$("#mercado [data-ai-name-note]")) === null && /La IA no pudo analizar la foto/.test(await textOf("#mercado [data-photo-error]")), "Si la IA falla, el nombre queda vacío y se avisa");
assert(/^Identificar nombre con IA \(gratis\)$/i.test(await textOf("#mercado [data-ai-identify]")) && (await page.$$eval(`${FOTO} [data-visual-match]`, (e) => e.length)) === 3, "Queda el botón manual «Identificar nombre con IA (gratis)» y los resultados siguen ahí");
identifyMode = "ok";
await click("Identificar nombre con IA");
await waitAi();
assert(identify.length === aiCalls + 2 && (await nameValue()) === IDENTIFIED.name && !(await visible("#mercado [data-photo-error]")), "Con el botón manual se reintenta la IA y el aviso se va");

// --- Errores: mensaje claro, IA y botones gratuitos de Google ---
const errorCase = async (mode, code, re, retry, label) => {
  const aiBeforeCase = identify.length;
  await searchPhoto(mode, `${FOTO} [data-visual-error]`);
  const text = await textOf(`${FOTO} [data-visual-error]`);
  assert((await errorBox()) === `${code}|alert|${retry ? "con-reintento" : "sin-reintento"}` && re.test(text), `${label} (${text.slice(0, 60)}…)`);
  assert((await visible("#mercado [data-ai-identify]")) && (await nameValue()) === "" && (await visible("#mercado img[data-photo-preview]")), `${label.split(":")[0]}: se ofrece «Identificar nombre con IA», el nombre queda para escribirlo y la foto sigue cargada`);
  assert(!/apify|token|HTTP|50[234]|404|stack|FUNCTION_INVOCATION/i.test(text), `${label.split(":")[0]}: el aviso no nombra a Apify ni expone detalles internos`);
  assert(identify.length === aiBeforeCase, `${label.split(":")[0]}: la IA no corre sola`);
};
await errorCase("notConfigured", "VISUAL_SEARCH_NOT_CONFIGURED", /La búsqueda visual no está configurada en el servidor\./, false, "Sin configurar: aviso claro, sin reintentar");
assert(/Escribí el nombre del producto para armar la búsqueda/.test(await textOf(FOTO)) && (await page.$$eval(`${FOTO} a[data-google]`, (a) => a.length)) === 0, "Sin nombre, los botones de Google piden que lo escribas");
await retype("termo stanley");
const freeLinks = await page.$$eval(`${FOTO} a[data-google]`, (as) => as.map((a) => ({ q: new URL(a.href).searchParams.get("q"), host: new URL(a.href).host, target: a.target, rel: a.rel, shown: a.offsetParent !== null })));
assert(freeLinks.length === 2 && freeLinks.every((a) => a.shown && a.q === "termo stanley Uruguay" && a.host === "www.google.com" && a.target === "_blank" && a.rel === "noopener noreferrer"), "Con un nombre escrito aparecen los dos botones gratuitos de Google");
await errorCase("noCredit", "VISUAL_SEARCH_NO_CREDIT", /Se agotó el crédito del servicio de búsqueda visual\./, false, "Sin crédito: aviso claro, sin reintentar");
await errorCase("timeout", "VISUAL_SEARCH_TIMEOUT", /^La búsqueda visual tardó demasiado\./, true, "Se cortó por tiempo: «La búsqueda visual tardó demasiado» con «Reintentar»");
await errorCase("platformTimeout", "VISUAL_SEARCH_TIMEOUT", /^La búsqueda visual tardó demasiado\./, true, "La plataforma cortó la función (504 sin JSON): el mismo aviso, con «Reintentar»");
await errorCase("rate", "RATE_LIMITED", /Llegaste al límite de 3 usos por minuto/, false, "Límite de uso: muestra el mensaje del servidor, sin invitar a reintentar");
await errorCase("garbage", "error", /La búsqueda visual no respondió en este momento\./, true, "Respuesta con forma inesperada: no se muestra, se avisa");
await errorCase("unavailable", "VISUAL_SEARCH_UNAVAILABLE", /^La búsqueda visual no respondió en este momento\./, true, "Servicio caído: aviso distinto al de tiempo agotado, con botón «Reintentar»");
await shot("r13-visual-error-1280", 1280);
await retype("mi termo");
const beforeRetry = visualCalls.length;
visualMode = "ok";
await page.click(`${FOTO} [data-visual-retry]`);
await page.waitForSelector(`${FOTO} [data-visual-results]`, { timeout: 10000 }).catch(() => null);
await sleep(300);
assert(visualCalls.length === beforeRetry + 1 && (await page.$(`${FOTO} [data-visual-error]`)) === null && (await page.$$eval(`${FOTO} [data-visual-match]`, (e) => e.length)) === 11, "«Reintentar» repite la búsqueda una vez y muestra los resultados");
assert((await nameValue()) === "mi termo", "Si ya habías escrito un nombre, el reintento no lo pisa");

// --- Error y después IA: el camino alternativo completo ---
await searchPhoto("noCredit", `${FOTO} [data-visual-error]`);
const aiBefore = identify.length;
await click("Identificar nombre con IA");
await page.waitForSelector("#mercado [data-photo-confidence]", { timeout: 10000 }).catch(() => null);
assert(identify.length === aiBefore + 1 && (await nameValue()) === IDENTIFIED.name, "Sin crédito, la identificación con IA igual propone un nombre");
await click("Analizar en Radar");
await sleep(800);
assert(queries.at(-1) === IDENTIFIED.name, "Y con ese nombre se puede analizar en el Radar");

// --- Quitar la foto limpia todo ---
await page.click('#mercado button[aria-label="Quitar la foto"]');
await sleep(200);
assert((await page.$(NAME)) === null && (await page.$(`${FOTO}`)) === null && (await page.$("#mercado img[data-photo-preview]")) === null && /Arrastrá una foto acá/.test(await textOf("#mercado")), "Quitar la foto borra el nombre, los resultados y el aviso");
await upload(PHOTO);
assert((await page.$(NAME)) === null && (await visible("#mercado [data-visual-search]")), "Con una foto nueva se arranca de cero");

await page.setViewport({ width: 390, height: 844 });
await searchPhoto("unavailable", `${FOTO} [data-visual-error]`);
await sleep(300);
const e390 = await overflow();
assert(e390.length === 0, `Aviso de error a 390 px: sin desborde horizontal${e390.length ? ` (${e390.join(", ")})` : ""}`);
await shot("r13-visual-error-390", 390);
assert(problems.length === 0, `Sin errores en la consola${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
if (passed !== total) process.exit(1);
