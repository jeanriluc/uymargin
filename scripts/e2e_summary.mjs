// Prueba en navegador de la ronda 15: foto del producto en el resumen, encabezado sin el cuadro «UY» y caja USD/UYU compacta.
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_summary.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// Todo lo que sale a la red se simula acá: Mercado Libre, la nube, la búsqueda visual, la IA y las imágenes.
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

// --- PNG liso armado a mano, para las imágenes simuladas y la foto que «sube» el usuario ---
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uymargin-resumen-"));
const USER_PHOTO = path.join(dir, "mate.png");
fs.writeFileSync(USER_PHOTO, png(1200, 800, [180, 90, 40]));
// Foto de producto apaisada (alto < ancho): tiene que entrar entera en el cuadro, sin deformarlo.
const PRODUCT_PNG = png(300, 180, [30, 110, 70]);

const GOOD_IMG = "https://http2.mlstatic.com/D_NQ_NP_termo-bueno.webp";
const BROKEN_IMG = "https://http2.mlstatic.com/D_NQ_NP_rota.webp";
const EVIL_IMG = "https://mlstatic.com.evil.com/a.jpg";
const GOOGLE_IMG = "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});

// Historial guardado antes de la ronda 15 (sin el campo), una entrada con foto y dos con valores que no se deben mostrar.
const channel = { netProfit: 100, netMargin: 0.1, roi: 0.2, viability: "good" };
const inputsOf = (name, extra = {}) => ({
  productName: name,
  query: name,
  cost: { amount: 10, currency: "USD" },
  freight: { amount: 0, currency: "UYU" },
  exchangeRate: 40.5,
  salePrice: 900,
  tax: { regime: "literal_e", costIncludesVat: true, feesInvoicedWithRut: true, provisionIrae: false, iraeRate: 0.25 },
  ml: { listingType: "classic", classicRate: 0.13, premiumRate: 0.175, fixedFeeThreshold: 1200, fixedFee: 40, shippingMode: "buyer", sellerShippingCost: 210 },
  direct: { gateway: "mercadopago", shippingMode: "seller", shippingCost: 190 },
  ...extra,
});
const HISTORY = [
  { id: "h-vieja", savedAt: "2026-08-01T12:00:00.000Z", inputs: inputsOf("Entrada vieja sin foto"), market: null, ml: channel, direct: channel },
  { id: "h-foto", savedAt: "2026-10-01T12:00:00.000Z", inputs: inputsOf("Entrada con foto", { productImage: GOOGLE_IMG }), market: null, ml: channel, direct: channel },
  { id: "h-mala", savedAt: "2026-10-02T12:00:00.000Z", inputs: inputsOf("Entrada con foto ajena", { productImage: EVIL_IMG }), market: null, ml: channel, direct: channel },
  { id: "h-rara", savedAt: "2026-10-03T12:00:00.000Z", inputs: inputsOf("Entrada con foto rara", { productImage: { url: GOOD_IMG } }), market: null, ml: channel, direct: channel },
];
await page.evaluateOnNewDocument((history) => {
  if (!sessionStorage.getItem("seeded")) {
    localStorage.clear();
    localStorage.setItem("uymargin:history:v1", JSON.stringify(history));
    sessionStorage.setItem("seeded", "1");
  }
}, HISTORY);

const imageRequests = [];
const apiBodies = [];
const item = (id, price, thumbnail, title) => ({ id, title: title ?? `Termo Stanley Classic ${id}`, price, currency: "UYU", condition: "new", thumbnail, permalink: `https://example.com/${id}`, freeShipping: false, activeSellersCount: 2, match: { matches: true, missing: [] } });
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = new URL(req.url());
  const json = (body, status = 200) => req.respond({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
  if (url.origin !== new URL(APP_URL).origin) {
    imageRequests.push(url.href);
    if (/mlstatic\.com$|gstatic\.com$/.test(url.hostname) && !/rota/.test(url.pathname)) return req.respond({ status: 200, contentType: "image/png", body: PRODUCT_PNG }).catch(() => {});
    return req.respond({ status: 404, contentType: "text/plain", body: "no" }).catch(() => {});
  }
  if (url.pathname.startsWith("/api/") && req.method() !== "GET") apiBodies.push({ path: url.pathname, type: req.headers()["content-type"] || "", body: req.postData() || "" });
  if (url.pathname === "/api/exchange-rate") return json({ ok: true, rate: 40.25, referenceDate: "2026-10-09", fetchedAt: new Date().toISOString(), stale: false });
  if (url.pathname === "/api/audits") {
    return json({
      audits: [
        { id: "a-vieja", title: "Auditoría vieja sin foto", target_price: 1500, target_currency: "UYU", target_price_uyu: 1500, created_at: "2026-07-01T12:00:00.000Z" },
        { id: "a-foto", title: "Auditoría con foto", thumbnail: GOOD_IMG, target_price: 1800, target_currency: "UYU", target_price_uyu: 1800, created_at: "2026-10-01T12:00:00.000Z" },
        { id: "a-mala", title: "Auditoría con foto ajena", thumbnail: "http://http2.mlstatic.com/sin-https.jpg", target_price: 1900, target_currency: "UYU", target_price_uyu: 1900, created_at: "2026-10-02T12:00:00.000Z" },
      ],
    });
  }
  if (url.pathname === "/api/visual-search") return json({ ok: false, code: "VISUAL_SEARCH_NOT_CONFIGURED", message: "La búsqueda visual no está configurada en el servidor.", error: "x" }, 503);
  if (url.pathname === "/api/identify-product") return json({ ok: true, isProduct: true, name: "Mate imperial de calabaza", alternatives: [], brand: null, category: "Mates", attributes: [], confidence: "alta", notes: "" });
  if (url.pathname === "/api/web-sellers") return json({ ok: false, code: "WEB_SEARCH_NOT_CONFIGURED", message: "No disponible.", error: "x" }, 503);
  if (url.pathname !== "/api/search-mlu") return req.continue();
  const q = url.searchParams.get("q") || "";
  const base = { ok: true, query: q, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() };
  const stats = { sampleSize: 4, outliersRemoved: 0, min: 2400, max: 2700, average: 2550, median: 2550 };
  const items = [item("CON-FOTO", 2400, GOOD_IMG), item("ROTA", 2500, BROKEN_IMG), item("SIN-FOTO", 2600, null), item("AJENA", 2700, EVIL_IMG)];
  return json({ ...base, total: items.length, items, stats, relevance: null });
});

await page.goto(APP_URL, { waitUntil: "networkidle2" });
await sleep(1000);

const click = (re, scope = "body") =>
  page.evaluate((sel, src) => {
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src, "i").test(x.textContent) && x.offsetParent !== null && !x.disabled);
    b?.click();
    return !!b;
  }, scope, re);
const SUMMARY = 'section[aria-label="Resumen Ejecutivo"]';
const SEARCH = '#mercado input[aria-label^="Producto o modelo"]';
/** Estado del cuadro del resumen: foto o icono, su tamaño y si la imagen cargó. */
const thumb = () =>
  page.evaluate((sel) => {
    const box = document.querySelector(`${sel} [data-product-thumb]`);
    if (!box) return null;
    const img = box.querySelector("img");
    const r = box.getBoundingClientRect();
    return {
      kind: box.getAttribute("data-product-thumb"),
      w: Math.round(r.width),
      h: Math.round(r.height),
      src: img?.getAttribute("src") ?? null,
      loaded: !!img && img.complete && img.naturalWidth > 0,
      alt: img?.getAttribute("alt") ?? null,
      lazy: img?.getAttribute("loading") ?? null,
      referrer: img?.getAttribute("referrerpolicy") ?? null,
      fit: img ? getComputedStyle(img).objectFit : null,
      bg: getComputedStyle(box).backgroundColor,
      hasIcon: !!box.querySelector("svg"),
    };
  }, SUMMARY);
const summaryHeight = () => page.$eval(SUMMARY, (s) => Math.round(s.getBoundingClientRect().height));
const title = () => page.$eval(`${SUMMARY} h1`, (h) => h.textContent.trim());
const setText = async (selector, text) => {
  await page.focus(selector);
  await page.$eval(selector, (el) => el.select());
  await page.keyboard.press("Backspace");
  if (text) await page.type(selector, text);
};
const search = async (q) => {
  await setText(SEARCH, q);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("#mercado button")].some((b) => b.textContent.trim() === "Simular" && b.offsetParent !== null), { timeout: 10000 });
  await sleep(300);
};
/** «Simular» de la tarjeta del Radar cuyo título contiene `id`. */
const simulateCard = (id) =>
  page.evaluate((needle) => {
    const b = [...document.querySelectorAll("#mercado button")].find((x) => x.textContent.trim() === "Simular" && x.offsetParent !== null && x.closest(".group")?.textContent.includes(needle));
    b?.click();
    return !!b;
  }, id);
const waitThumb = (kind) => page.waitForFunction((sel, k) => document.querySelector(`${sel} [data-product-thumb]`)?.getAttribute("data-product-thumb") === k, { timeout: 8000 }, SUMMARY, kind).then(() => true, () => false);
// La imagen es lazy: hay que tener el resumen a la vista para que el navegador la pida.
const waitLoaded = () => page.evaluate(() => window.scrollTo(0, 0)).then(() => page.waitForFunction((sel) => { const i = document.querySelector(`${sel} [data-product-thumb] img`); return !!i && i.complete && i.naturalWidth > 0; }, { timeout: 8000 }, SUMMARY)).then(() => true, () => false);

// ------------------------------------------------------------------
console.log("--- Resumen: sin producto, el icono de siempre ---");
const empty = await thumb();
assert(empty?.kind === "icon" && empty.hasIcon && empty.src === null, "Sin producto cargado el cuadro muestra el icono");
assert(empty.w === 56 && empty.h === 56, `El cuadro mide 56 × 56 px en escritorio (mide ${empty.w} × ${empty.h})`);
await page.type("#wholesale-cost", "10");

console.log("--- Radar: elegir un producto con foto ---");
await search("termo stanley");
assert(await simulateCard("CON-FOTO"), "Hay un «Simular» en la tarjeta del producto con foto");
assert((await waitThumb("image")) && (await waitLoaded()), "El cuadro del resumen muestra la foto del producto elegido");
const withPhoto = await thumb();
assert(withPhoto.src === GOOD_IMG, "La foto es la miniatura de la tarjeta elegida");
assert(withPhoto.w === empty.w && withPhoto.h === empty.h, "El cuadro mide lo mismo con foto que con icono");
assert(withPhoto.fit === "contain" && withPhoto.bg === "rgb(255, 255, 255)" && !withPhoto.hasIcon, "La foto entra entera (object-contain) sobre fondo blanco, sin el icono");
assert(withPhoto.lazy === "lazy" && withPhoto.referrer === "no-referrer", "La imagen lleva loading=lazy y referrerPolicy=no-referrer");
assert(withPhoto.alt === "Foto de termo stanley", `El texto alternativo nombra el producto («${withPhoto.alt}»)`);
const heightWithPhoto = await summaryHeight();
if (SHOTS) await shots("con-foto");

console.log("--- Precio de las estadísticas: no es otro producto, la foto queda ---");
await click("Mediana", "#mercado");
await sleep(300);
assert((await thumb()).src === GOOD_IMG, "Usar la mediana como precio no cambia la foto");

console.log("--- Editar el nombre a mano conserva la foto ---");
await setText("#product-name", "Termo Stanley editado a mano");
await sleep(300);
const edited = await thumb();
assert((await title()) === "Termo Stanley editado a mano" && edited.src === GOOD_IMG && edited.alt === "Foto de Termo Stanley editado a mano", "Con el nombre editado en el panel de costos la foto se mantiene");
await setText("#product-name", "");

console.log("--- Imagen rota: vuelve al icono ---");
assert(await simulateCard("ROTA"), "Se elige el producto cuya foto no carga");
assert(await waitThumb("icon"), "Con la imagen rota el cuadro vuelve al icono");
const broken = await thumb();
assert(broken.hasIcon && broken.src === null && broken.w === empty.w && broken.h === empty.h, "El icono ocupa el mismo cuadro, sin imagen rota a la vista");
assert((await summaryHeight()) === heightWithPhoto, `El alto del resumen es el mismo con la foto y con la imagen rota (${heightWithPhoto} px)`);
assert(await simulateCard("CON-FOTO"), "Se vuelve a elegir el producto con foto");
assert((await waitThumb("image")) && (await waitLoaded()), "Después de una imagen rota, otra foto se muestra normalmente");

console.log("--- Otro producto sin foto: no queda la foto anterior ---");
assert(await simulateCard("SIN-FOTO"), "Se elige un producto sin foto");
assert((await waitThumb("icon")) && (await thumb()).src === null, "Con un producto sin foto queda el icono");
assert((await summaryHeight()) === heightWithPhoto, "El alto del resumen es el mismo con foto y sin foto");
await simulateCard("CON-FOTO");
await waitThumb("image");
assert(await simulateCard("AJENA"), "Se elige un producto con una foto de un host desconocido");
assert((await waitThumb("icon")) && (await thumb()).src === null, "Una foto de un host parecido (mlstatic.com.evil.com) no se muestra en el resumen");
await sleep(300);
assert(!(await page.evaluate((sel) => !!document.querySelector(`${sel} img`), SUMMARY)), "El resumen no arma ninguna imagen con esa dirección");

console.log("--- Buscar otra cosa saca la foto ---");
await simulateCard("CON-FOTO");
await waitThumb("image");
await search("termo stanley");
assert((await thumb()).src === GOOD_IMG, "Repetir la misma búsqueda conserva la foto");
await search("auriculares f9");
assert((await thumb()).kind === "icon", "Buscar otro producto en el Radar saca la foto del anterior");

console.log("--- Nueva simulación ---");
await simulateCard("CON-FOTO");
assert((await waitThumb("image")) && (await waitLoaded()), "Hay foto antes de «Nueva»");
await click("^Nueva$", SUMMARY);
await sleep(500);
const fresh = await thumb();
assert(fresh.kind === "icon" && fresh.src === null && (await title()) === "Producto en Análisis", "«Nueva simulación» deja el icono y el título por defecto");

console.log("--- Guardar y recargar ---");
await page.type("#wholesale-cost", "10");
await search("termo stanley");
await simulateCard("CON-FOTO");
await waitThumb("image");
await sleep(700); // el borrador se guarda con una demora corta
const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("uymargin:draft:v1")));
assert(draft.productImage === GOOD_IMG, "El borrador guarda solo la dirección de la foto");
await click("^Guardar$", SUMMARY);
await sleep(400);
const savedEntry = await page.evaluate(() => JSON.parse(localStorage.getItem("uymargin:history:v1"))[0]);
assert(savedEntry.inputs.productImage === GOOD_IMG && !JSON.stringify(savedEntry).includes("data:image"), "El historial guarda la dirección de la foto, nunca una imagen en base64");
await page.reload({ waitUntil: "networkidle2" });
await sleep(800);
assert((await waitThumb("image")) && (await thumb()).src === GOOD_IMG, "Al recargar la página la foto del producto sigue ahí");

console.log("--- Historial: entradas viejas y valores que no se muestran ---");
const loadEntry = async (name) => {
  const ok = await page.evaluate((needle) => {
    const row = [...document.querySelectorAll("#historial tbody tr")].find((r) => r.textContent.includes(needle));
    const b = row?.querySelector('button[title="Cargar simulación en el dashboard"]');
    b?.click();
    return !!b;
  }, name);
  await sleep(500);
  return ok;
};
assert(await loadEntry("Entrada vieja sin foto"), "Hay una entrada del historial guardada antes de esta ronda (sin el campo)");
assert((await title()) === "Entrada vieja sin foto" && (await thumb()).kind === "icon", "Abrir una entrada vieja sin el campo: carga el producto y queda el icono");
assert(problems.length === 0, `Abrir la entrada vieja no da errores${problems.length ? `: ${problems.join(" | ")}` : ""}`);
assert((await loadEntry("Entrada con foto")) && (await waitThumb("image")) && (await thumb()).src === GOOGLE_IMG, "Una entrada con foto de Google la restaura");
assert((await loadEntry("Entrada con foto ajena")) && (await waitThumb("icon")) && (await thumb()).src === null, "Una entrada con una dirección desconocida queda con el icono");
await loadEntry("Entrada con foto");
await waitThumb("image");
assert((await loadEntry("Entrada con foto rara")) && (await waitThumb("icon")), "Una entrada con un valor que no es texto queda con el icono, sin errores");

console.log("--- Auditorías de la nube ---");
const loadAudit = async (name) => {
  await page.click('header button[aria-label*="auditorías guardadas"]');
  await page.waitForFunction((needle) => document.body.textContent.includes(needle), { timeout: 8000 }, name);
  await sleep(300);
  const ok = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Cargar" && x.closest("div.group, li, article, div")?.parentElement?.closest("*") && (function up(n) { for (let p = n; p; p = p.parentElement) { if (p.textContent.includes(needle) && [...p.querySelectorAll("button")].filter((y) => y.textContent.trim() === "Cargar").length === 1) return true; } return false; })(x));
    b?.click();
    return !!b;
  }, name);
  await sleep(600);
  return ok;
};
assert(await loadAudit("Auditoría vieja sin foto"), "Hay una auditoría de la nube guardada sin foto");
assert((await title()) === "Auditoría vieja sin foto" && (await thumb()).kind === "icon", "Abrir una auditoría vieja sin foto: carga el producto y queda el icono (no la foto anterior)");
assert((await loadAudit("Auditoría con foto")) && (await waitThumb("image")) && (await thumb()).src === GOOD_IMG, "Una auditoría con foto de Mercado Libre la muestra en el resumen");
assert((await loadAudit("Auditoría con foto ajena")) && (await waitThumb("icon")), "Una auditoría con la foto en http (sin https) queda con el icono");
assert(problems.length === 0, `Abrir auditorías viejas no da errores${problems.length ? `: ${problems.join(" | ")}` : ""}`);

console.log("--- Por foto: la miniatura del usuario, solo en esta sesión ---");
await click("^Nueva$", SUMMARY);
await sleep(400);
await page.type("#wholesale-cost", "10");
await click("^Por foto$", "#mercado");
await page.waitForSelector('#mercado input[data-photo-input="file"]', { timeout: 10000 });
await (await page.$('#mercado input[data-photo-input="file"]')).uploadFile(USER_PHOTO);
await page.waitForSelector("#mercado [data-visual-search]", { timeout: 10000 });
await click("Buscar dónde se vende", "#mercado");
await page.waitForFunction(() => document.querySelector("#photo-name-input")?.value.length > 1, { timeout: 15000 }).catch(async () => {
  await click("Identificar nombre con IA", "#mercado");
  await page.waitForFunction(() => document.querySelector("#photo-name-input")?.value.length > 1, { timeout: 15000 });
});
apiBodies.length = 0;
await page.click("#mercado [data-radar-search]");
assert((await waitThumb("image")) && (await waitLoaded()), "Al analizar en el Radar con una foto propia, el resumen muestra su miniatura");
const mine = await thumb();
const size = await page.$eval(`${SUMMARY} [data-product-thumb] img`, (i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
assert(/^data:image\/jpeg;base64,/.test(mine.src) && Math.max(size.w, size.h) === 160 && size.h === 107, `La miniatura se arma en el navegador: JPEG de 160 px de lado mayor (${size.w} × ${size.h})`);
assert(mine.w === empty.w && mine.h === empty.h && (await title()) === "Mate imperial de calabaza", "Ocupa el mismo cuadro y el título es el nombre buscado");
await sleep(700);
const draftMine = await page.evaluate(() => localStorage.getItem("uymargin:draft:v1"));
assert(!draftMine.includes("data:image") && JSON.parse(draftMine).productImage === null, "La foto del usuario no queda en el borrador");
await page.waitForFunction(() => [...document.querySelectorAll("#mercado button")].some((b) => b.textContent.trim() === "Simular" && b.offsetParent !== null), { timeout: 10000 });
await click("Mediana", "#mercado");
await sleep(300);
assert(/^data:image\/jpeg/.test((await thumb()).src ?? ""), "Usar un precio de las estadísticas conserva la foto del usuario");
await click("^Guardar$", SUMMARY);
await sleep(400);
const savedMine = await page.evaluate(() => JSON.parse(localStorage.getItem("uymargin:history:v1"))[0]);
assert(savedMine.inputs.productName === "" && savedMine.inputs.query === "Mate imperial de calabaza" && savedMine.inputs.productImage === null, "Al guardar, la foto del usuario se guarda como null");
assert(!(await page.evaluate(() => Object.values({ ...localStorage }).join(""))).includes("data:image"), "Nada de lo guardado en el navegador contiene la imagen");
assert(apiBodies.every((b) => !b.body.includes("data:image") && !/^image\//.test(b.type)), "La miniatura no se manda a ningún servidor");
assert(/^data:image\/jpeg/.test((await thumb()).src ?? ""), "Guardar no saca la foto de la pantalla");
await page.reload({ waitUntil: "networkidle2" });
await sleep(800);
assert((await thumb()).kind === "icon" && (await title()) === "Mate imperial de calabaza", "Al recargar, la foto del usuario ya no está (era solo de esa sesión)");
await click("^Radar MLU$", "#mercado");

// ------------------------------------------------------------------
console.log("--- Encabezado ---");
const header = () =>
  page.evaluate(() => {
    const h = document.querySelector("header");
    const vis = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const find = (re) => [...h.querySelectorAll("span, p")].find((n) => re.test(n.textContent.trim()) && n.children.length === 0);
    const brand = find(/^UyMargin$/);
    const row = h.firstElementChild;
    const kids = [...row.children].map((c) => c.getBoundingClientRect());
    const box = h.querySelector("[data-rate-box]").getBoundingClientRect();
    const refresh = h.querySelector('button[aria-label^="Actualizar cotización"]');
    const input = h.querySelector("#header-rate");
    return {
      height: Math.round(h.getBoundingClientRect().height),
      position: getComputedStyle(h).position,
      brand: vis(brand),
      brandText: brand?.textContent.trim(),
      tag: vis(find(/^MONTEVIDEO$/)),
      subtitle: vis(find(/^Analizador Financiero/)),
      blackBox: [...h.querySelectorAll("*")].some((n) => n.textContent.trim() === "UY" && n.children.length === 0),
      roleImg: !!h.querySelector('[role="img"]'),
      free: Math.round(kids[1].left - kids[0].right),
      overflow: document.documentElement.scrollWidth > innerWidth,
      rateBox: { w: Math.round(box.width), h: Math.round(box.height) },
      refresh: { w: Math.round(refresh.getBoundingClientRect().width), h: Math.round(refresh.getBoundingClientRect().height), title: refresh.title, label: refresh.getAttribute("aria-label") },
      inputWidth: Math.round(input.getBoundingClientRect().width),
      inputValue: input.value,
      inputClipped: input.scrollWidth > input.clientWidth,
      label: document.querySelector('label[for="header-rate"]')?.textContent.trim(),
      cloudText: vis([...h.querySelectorAll("span")].find((n) => n.textContent.trim() === "Nube")),
      rateLabelInline: (() => { const l = [...h.querySelectorAll("span")].find((n) => n.textContent.trim() === "USD/UYU"); const a = l.getBoundingClientRect(); const b = input.getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4 && a.right <= b.left + 1; })(),
    };
  });
const pending = () =>
  page.evaluate(() => {
    const g = document.querySelector('header [role="group"][aria-label="Confirmar cotización manual"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const h = document.querySelector("header").getBoundingClientRect();
    const box = document.querySelector("header [data-rate-box]").getBoundingClientRect();
    return {
      buttons: [...g.querySelectorAll("button")].map((b) => b.textContent.trim()),
      position: getComputedStyle(g).position,
      below: r.top >= h.bottom - 1 && r.top >= box.bottom && r.top - box.bottom <= 24,
      inside: r.left >= 0 && r.right <= innerWidth,
      onTop: (() => { const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && g.contains(el); })(),
    };
  });
const summaryRate = () => page.$eval(SUMMARY, (s) => /USD\/UYU:\s*([\d.,]+)/.exec(s.textContent)?.[1] ?? null);

for (const width of [1280, 1024, 768, 375]) {
  await page.setViewport({ width, height: 900 });
  await sleep(400);
  const h = await header();
  console.log(`· ${width} px`);
  assert(h.brand && h.brandText === "UyMargin" && !h.blackBox && !h.roleImg, `${width} px: se lee «UYMARGIN» como texto y no hay cuadro «UY»`);
  assert(h.position === "sticky" && !h.overflow, `${width} px: el encabezado sigue fijo arriba y la página no se desborda a lo ancho`);
  assert(h.free >= 0, `${width} px: la marca y los controles entran en una fila sin pisarse (sobran ${h.free} px)`);
  assert(h.tag === width >= 640 && h.subtitle === width >= 1024, `${width} px: «MONTEVIDEO» ${width >= 640 ? "visible" : "oculta"} y subtítulo ${width >= 1024 ? "visible" : "oculto"}`);
  assert(h.rateBox.h <= 32 && h.rateBox.w <= (width >= 1024 ? 160 : 145), `${width} px: la caja USD/UYU es una fila baja (${h.rateBox.w} × ${h.rateBox.h} px)`);
  assert(h.rateLabelInline, `${width} px: la etiqueta «USD/UYU» y el valor van lado a lado`);
  assert(h.refresh.w === 24 && h.refresh.h === 24, `${width} px: el botón de actualizar mide 24 px`);
  assert(h.inputValue === "40,25" && h.inputWidth <= 44 && !h.inputClipped, `${width} px: el campo tiene el ancho justo para «40,25» (${h.inputWidth} px) y el valor se ve entero`);
  if (width === 375) {
    assert(h.height <= 56, `375 px: el encabezado mide ${h.height} px de alto (hasta 56)`);
    // En esta prueba no hay sesión, así que falta el botón «Salir» (34 px + separación): tiene que haber lugar para él.
    assert(h.free >= 40, `375 px: queda lugar para el botón «Salir» de una sesión real (sobran ${h.free} px, hacen falta 40)`);
    assert(!h.cloudText && !h.tag && !h.subtitle, "375 px: solo «UYMARGIN»; el texto «Nube» queda oculto");
  }
  assert(h.label === "Cotización del dólar en pesos uruguayos" && /^Actualizar cotización desde el BCU\. En uso: /.test(h.refresh.label) && /Actualizar desde el BCU$/.test(h.refresh.title) && h.refresh.title.length > 30, `${width} px: siguen el label oculto, el aria-label del botón y la fuente en el title`);

  // Cotización tipeada a mano, sin confirmar.
  const before = await summaryRate();
  await setText("#header-rate", "41,5");
  await sleep(300);
  const p = await pending();
  const hp = await header();
  assert(p && p.buttons.join("|") === "Usar este valor|Cancelar", `${width} px: al tipear aparecen «Usar este valor» y «Cancelar»`);
  assert(hp.height === h.height && hp.rateBox.w === h.rateBox.w && hp.rateBox.h === h.rateBox.h, `${width} px: no agrandan la caja ni el encabezado (${hp.height} px)`);
  assert(p.position === "absolute" && p.below && p.inside && p.onTop, `${width} px: flotan debajo de la caja, dentro de la pantalla y por encima del contenido`);
  assert((await summaryRate()) === before, `${width} px: el valor tipeado no se usa hasta confirmar (el resumen sigue en ${before})`);
  if (SHOTS) await shots("cotizacion-pendiente", { only: width });
  if (width === 1280) {
    await page.focus("#header-rate");
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.textContent.trim());
    await page.keyboard.press("Tab");
    const second = await page.evaluate(() => document.activeElement?.textContent.trim());
    assert(first === "Usar este valor" && second === "Cancelar", "Con Tab se llega del campo a «Usar este valor» y a «Cancelar»");
    await page.keyboard.press("Enter");
    await sleep(300);
    assert((await pending()) === null && (await summaryRate()) === before && (await header()).inputValue === "40,25", "«Cancelar» con el teclado descarta el valor y vuelve a 40,25");
    await setText("#header-rate", "41,5");
    await sleep(200);
    await click("Usar este valor", "header");
    await sleep(300);
    assert((await pending()) === null && (await summaryRate()) === "41,50", "«Usar este valor» lo aplica y cierra el panel");
    await page.click('header button[aria-label^="Actualizar cotización"]');
    await page.waitForFunction((sel) => /USD\/UYU:\s*40,25/.test(document.querySelector(sel).textContent), { timeout: 8000 }, SUMMARY);
    await sleep(300);
  } else {
    await click("^Cancelar$", "header");
    await sleep(300);
    assert((await pending()) === null && (await header()).inputValue === "40,25", `${width} px: «Cancelar» cierra el panel y vuelve a 40,25`);
  }
}

// ------------------------------------------------------------------
// Capturas: encabezado y resumen en 375, 768 y 1280 px, claro y oscuro.
async function shots(state, { only = null } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const back = page.viewport();
  const startTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  for (const width of only ? [only] : [375, 768, 1280]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    for (const theme of ["light", "dark"]) {
      if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== theme) await page.click("#theme-toggle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(350);
      const bottom = await page.$eval('section[aria-label="Resumen Ejecutivo"]', (s) => Math.ceil(s.getBoundingClientRect().bottom) + 12);
      await page.screenshot({ path: path.join(SHOTS, `${state}-${width}-${theme === "light" ? "claro" : "oscuro"}.png`), clip: { x: 0, y: 0, width, height: bottom } });
    }
  }
  if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== startTheme) await page.click("#theme-toggle");
  await page.setViewport(back);
  await sleep(300);
}

if (SHOTS) {
  console.log("--- Capturas ---");
  await page.setViewport({ width: 1280, height: 900 });
  await click("^Nueva$", SUMMARY);
  await sleep(400);
  await shots("sin-foto");
  await page.type("#wholesale-cost", "10");
  await search("termo stanley");
  await simulateCard("CON-FOTO");
  await waitThumb("image");
  await waitLoaded();
  await setText("#product-name", "Botella térmica Stanley Classic Legendary de acero inoxidable 1,4 litros con tapa vaso y manija plegable verde martillado edición aniversario");
  await sleep(300);
  await shots("nombre-largo-con-foto");
  await simulateCard("SIN-FOTO");
  await waitThumb("icon");
  await shots("nombre-largo-sin-foto");
  console.log(`Capturas en ${SHOTS}`);
}

assert(problems.length === 0, `Sin errores de JavaScript en toda la prueba${problems.length ? `: ${problems.join(" | ")}` : ""}`);

console.log("=================================================");
console.log(`Resumen y encabezado: ${passed}/${total} verificaciones`);
console.log("=================================================");
fs.rmSync(dir, { recursive: true, force: true });
await browser.close();
if (passed !== total) process.exit(1);
