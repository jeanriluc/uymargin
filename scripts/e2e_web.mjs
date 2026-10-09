// Prueba en navegador de la vista «En la web (Uruguay)» de la pestaña «Por foto».
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_web.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// /api/identify-product, /api/web-sellers y /api/search-mlu se simulan acá: no se llama a Gemini, a Google ni a Mercado Libre.
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
const webCalls = [];
let webMode = "ok";
let webDelayMs = 0;
const seller = (site, extra = {}) => ({ site, url: `https://${site}/termo-stanley`, title: `Termo Stanley Classic en ${site}`, why: "Vende el termo Stanley Classic de 1 litro.", confidence: "alta", uruguay: "confirmado", international: false, ...extra });
const SELLERS = [
  seller("ferreteria.com.uy"),
  seller("tiendaejemplo.com", { uruguay: "probable", confidence: "media" }),
  seller("sinenlace.com.uy", { url: null, uruguay: "probable" }),
  // Lo que el servidor no debería mandar nunca; la pantalla igual lo tiene que frenar.
  seller("enlacemalo.com.uy", { url: "javascript:alert(document.domain)" }),
  seller("es.aliexpress.com", { uruguay: "no_confirmado", international: true }),
  seller("dudosa.com", { uruguay: "no_confirmado", confidence: "baja" }),
];
const identify = [];
let mode = "ok";
let delayMs = 0;
const IDENTIFIED = {
  ok: true,
  isProduct: true,
  name: "Termo Stanley Classic 1 litro",
  alternatives: ["Termo Stanley", "Termo acero inoxidable"],
  brand: "Stanley",
  category: "Termos",
  attributes: ["verde", "acero inoxidable"],
  confidence: "media",
  notes: "La marca se lee en el frente; el modelo no.",
};
const item = (id, price) => ({ id, title: `Termo Stanley Classic ${id}`, price, currency: "UYU", condition: "new", thumbnail: null, permalink: `https://example.com/${id}`, freeShipping: false, activeSellersCount: 2, match: { matches: true, missing: [] } });
await page.setRequestInterception(true);
page.on("request", async (req) => {
  const url = new URL(req.url());
  const json = (body, status = 200, headers = {}) => req.respond({ status, contentType: "application/json", headers, body: JSON.stringify(body) }).catch(() => {});
  if (url.pathname === "/api/exchange-rate") return json({ ok: true, rate: 40.5, referenceDate: "2026-10-08", fetchedAt: new Date().toISOString(), stale: false });
  if (url.pathname === "/api/identify-product") {
    identify.push({ method: req.method(), type: req.headers()["content-type"], hasBody: req.hasPostData() });
    if (delayMs) await sleep(delayMs);
    const fail = (status, code, message, headers) => json({ ok: false, code, message, error: message }, status, headers);
    if (mode === "noProduct") return json({ ok: true, isProduct: false, name: "", alternatives: [], brand: null, category: null, attributes: [], confidence: "baja", notes: "Solo se ve un paisaje." });
    if (mode === "provider") return fail(502, "AI_ERROR", "La IA no pudo analizar la foto en este momento. Probá de nuevo en unos minutos o escribí el nombre en el Radar.");
    if (mode === "notConfigured") return fail(503, "AI_NOT_CONFIGURED", "La identificación por foto no está disponible: falta configurar la IA en el servidor.");
    if (mode === "tooLarge") return fail(413, "IMAGE_TOO_LARGE", "La foto es demasiado pesada. Probá con una más liviana o sacale una captura.");
    if (mode === "rate") return fail(429, "RATE_LIMITED", "Llegaste al límite de 5 usos por minuto. Probá de nuevo en 40 segundos.", { "Retry-After": "40" });
    if (mode === "garbage") return json({ ok: true, isProduct: "sí", name: 7 });
    return json(IDENTIFIED);
  }
  if (url.pathname === "/api/web-sellers") {
    let body = null;
    try { body = JSON.parse(req.postData() || "null"); } catch { /* queda en null */ }
    webCalls.push({ method: req.method(), type: req.headers()["content-type"], body });
    if (webDelayMs) await sleep(webDelayMs);
    const fail = (status, code, message, headers) => json({ ok: false, code, message, error: message }, status, headers);
    if (webMode === "billing") return fail(503, "WEB_SEARCH_NEEDS_BILLING", "La búsqueda web necesita activar la facturación de la clave de Gemini.");
    if (webMode === "provider") return fail(502, "AI_ERROR", "No se pudo hacer la búsqueda web en este momento. Probá de nuevo en unos minutos o usá los botones de Google.");
    if (webMode === "rate") return fail(429, "RATE_LIMITED", "Llegaste al límite de 5 usos por minuto. Probá de nuevo en 40 segundos.", { "Retry-After": "40" });
    if (webMode === "garbage") return json({ ok: true, results: "muchos" });
    if (webMode === "empty") return json({ ok: true, query: body?.query ?? "", results: [], searchQueries: [], cached: false });
    if (webMode === "onlyOthers") return json({ ok: true, query: body?.query ?? "", results: [SELLERS[4]], searchQueries: [], cached: false });
    return json({ ok: true, query: body?.query ?? "", results: SELLERS, searchQueries: ["termo stanley classic comprar Uruguay"], cached: false });
  }
  if (url.pathname !== "/api/search-mlu") return req.continue();
  const q = url.searchParams.get("q") || "";
  queries.push(q);
  const base = { ok: true, query: q, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() };
  // Con la medida en el nombre no coincide nada; sin ella hay seis precios parejos.
  if (/1 litro/i.test(q)) return json({ ...base, total: 0, items: [], stats: null, relevance: null });
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
};
const NAME = "#photo-name-input";
/** Reemplaza el nombre escribiendo, como lo haría el usuario. */
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
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: await page.$eval("#mercado", (el, w) => { const b = el.getBoundingClientRect(); return { x: w === 390 ? 0 : b.left, y: b.top + scrollY, width: w === 390 ? 390 : b.width, height: Math.min(b.height, 1700) }; }, width) });
};

const WEB = "#mercado #photo-panel-web";
const tabState = () => page.evaluate(() => [...document.querySelectorAll("#mercado [role='tab']")].map((t) => `${t.textContent.trim()}:${t.getAttribute("aria-selected")}:${t.tabIndex}`).join(" | "));
const panelHidden = (id) => page.$eval(`#mercado #${id}`, (el) => el.hidden);
const links = (sel) => page.$$eval(sel, (as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel, text: a.innerText.replace(/\s+/g, " ").trim(), shown: a.offsetParent !== null })));
const webError = () => textOf(`${WEB} [data-web-error]`);

// --- Preparación: foto identificada ---
await click("^Por foto$");
await page.waitForSelector('#mercado input[data-photo-input="file"]', { timeout: 15000 });
await upload(PHOTO);
await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
assert((await page.$("#mercado [role='tablist']")) === null, "Antes de identificar el producto no hay vistas: primero se confirma el nombre");
await click("Identificar producto");
await page.waitForSelector(NAME, { timeout: 10000 });

// --- Dos vistas accesibles; «Mercado Libre» es la de siempre ---
assert((await tabState()) === "Mercado Libre:true:0 | En la web (Uruguay):false:-1", `Hay dos vistas con role=tab; arranca en «Mercado Libre» (${await tabState()})`);
assert(
  await page.evaluate(() => {
    const list = document.querySelector("#mercado [role='tablist']");
    return !!list?.getAttribute("aria-label") && [...list.querySelectorAll("[role='tab']")].every((t) => { const p = document.getElementById(t.getAttribute("aria-controls")); return p?.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby") === t.id; });
  }),
  "Cada pestaña está unida a su panel (aria-controls / aria-labelledby) y la lista tiene nombre"
);
assert((await visible("#mercado [data-web-search]")) === false && /^Buscar en Mercado Libre$/i.test(await textOf("#mercado [data-photo-result] button[type='submit']")) && (await panelHidden("photo-panel-web")), "En «Mercado Libre» el botón es el de siempre y la vista web está oculta");
assert(/Los resultados aparecen acá abajo, igual que en el Radar/.test(await textOf("#mercado #photo-panel-ml")), "La vista «Mercado Libre» conserva su texto");

// --- Abrir la vista web: nada se busca solo ---
await click("^En la web \\(Uruguay\\)$");
await sleep(200);
assert((await tabState()) === "Mercado Libre:false:-1 | En la web (Uruguay):true:0" && (await panelHidden("photo-panel-ml")) && !(await panelHidden("photo-panel-web")), "Al elegir «En la web (Uruguay)» cambia la vista y se oculta la otra");
assert(webCalls.length === 0 && queries.length === 0, "Abrir la vista no busca nada: ni en la web ni en Mercado Libre");
assert(/^Buscar en la web de Uruguay$/i.test(await textOf("#mercado [data-web-search]")) && !/Mercado Libre/i.test(await textOf("#mercado [data-photo-result] button[type='submit']")), "El botón pasa a ser «Buscar en la web de Uruguay»");
assert(/Usa la búsqueda de Google\. Los resultados pueden ser productos parecidos: verificá en cada sitio\./.test(await textOf(WEB)), "Muestra el aviso de la búsqueda de Google");

// --- Botones de Google: siempre visibles y con la búsqueda bien armada ---
let google = await links(`${WEB} a[data-google]`);
const q0 = "Termo Stanley Classic 1 litro Uruguay";
assert(google.length === 2 && google.every((a) => a.shown) && /Buscar en Google Uruguay/i.test(google[0].text) && /Google Shopping Uruguay/i.test(google[1].text), "Están «Buscar en Google Uruguay» y «Google Shopping Uruguay» sin haber buscado nada");
assert(google[0].href === `https://www.google.com/search?q=${encodeURIComponent(q0)}&gl=uy&hl=es-419`, `Google Uruguay: URL armada con el nombre + Uruguay (${google[0].href})`);
assert(google[1].href === `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q0)}&gl=uy&hl=es-419`, "Google Shopping: lo mismo con tbm=shop");
assert(google.every((a) => a.target === "_blank" && a.rel === "noopener noreferrer"), "Los dos abren en pestaña nueva con rel=\"noopener noreferrer\"");
await retype('Mate & bombilla "acero" #1 +ñ?');
google = await links(`${WEB} a[data-google]`);
const gq = new URL(google[0].href);
assert(gq.searchParams.get("q") === 'Mate & bombilla "acero" #1 +ñ? Uruguay' && gq.searchParams.get("gl") === "uy" && [...gq.searchParams.keys()].join() === "q,gl,hl" && gq.hash === "", "Con &, comillas, #, + y ? en el nombre, la URL queda bien codificada");
await retype("a");
assert((await links(`${WEB} a[data-google]`)).length === 0 && /Escribí el nombre del producto/.test(await textOf(WEB)), "Con un nombre de una letra no arma una búsqueda rota: pide el nombre");
await retype("Termo Stanley Classic");

// --- Teclado ---
await page.focus("#photo-tab-web");
await page.keyboard.press("ArrowLeft");
await sleep(200);
assert((await tabState()).startsWith("Mercado Libre:true:0") && (await page.evaluate(() => document.activeElement?.id)) === "photo-tab-ml", "Con la flecha izquierda se pasa a «Mercado Libre» y el foco acompaña");
await page.keyboard.press("ArrowRight");
await sleep(200);
assert((await page.evaluate(() => document.activeElement?.id)) === "photo-tab-web" && webCalls.length === 0, "Con la flecha derecha se vuelve; moverse entre vistas no busca");

// --- Cargando y cancelar ---
webDelayMs = 1500;
await page.click("#mercado [data-web-search]");
await page.waitForFunction((s) => /Buscando en la web…/.test(document.querySelector(s)?.innerText ?? ""), { timeout: 5000 }, WEB).catch(() => null);
assert(/Buscando en la web…/.test(await textOf(`${WEB} [role='status']`)) && (await click("^Cancelar$", WEB)), "Mientras busca muestra «Buscando en la web…» (role=status) y deja cancelar");
await sleep(1800);
assert((await page.$(`${WEB} [data-web-results]`)) === null && /Cancelaste la búsqueda web/.test(await textOf(`${WEB} [role='status']`)), "Cancelada: no aparecen resultados aunque la respuesta llegue después");
webDelayMs = 0;

// --- Resultados ---
const callsBefore = webCalls.length;
await page.focus(NAME);
await page.keyboard.press("Enter");
await page.waitForSelector(`${WEB} [data-web-results]`, { timeout: 10000 }).catch(() => null);
const call = webCalls.at(-1);
assert(webCalls.length === callsBefore + 1 && call.method === "POST" && /application\/json/.test(call.type) && JSON.stringify(call.body) === '{"query":"Termo Stanley Classic"}', `Se manda un POST con la consulta y nada más (${JSON.stringify(call.body)})`);
assert(queries.length === 0, "Buscar en la web no dispara una búsqueda en Mercado Libre");
const cards = () => page.$$eval(`${WEB} [data-web-seller]`, (els) => els.map((el) => ({ site: el.getAttribute("data-web-seller"), shown: el.checkVisibility(), uruguay: el.querySelector("[data-web-uruguay]")?.innerText.trim(), text: el.innerText.replace(/\s+/g, " ").trim(), link: el.querySelector("a")?.href ?? null, inDetails: !!el.closest("details") })));
let c = await cards();
const mainCards = c.filter((x) => !x.inDetails);
assert(mainCards.map((x) => x.site).join() === "ferreteria.com.uy,tiendaejemplo.com,sinenlace.com.uy,enlacemalo.com.uy" && mainCards.every((x) => x.shown), `Lista principal: los sitios de Uruguay confirmados y probables (${mainCards.map((x) => x.site).join()})`);
assert(mainCards[0].uruguay === "Uruguay: confirmado" && mainCards[1].uruguay === "Uruguay: probable", "Cada tarjeta dice Confirmado o Probable");
assert(/ferreteria\.com\.uy/.test(mainCards[0].text) && /Termo Stanley Classic en ferreteria\.com\.uy/.test(mainCards[0].text) && /Vende el termo Stanley Classic de 1 litro\./.test(mainCards[0].text) && /Ver en el sitio/i.test(mainCards[0].text), "La tarjeta muestra sitio, título, la frase y «Ver en el sitio»");
const siteLinks = await links(`${WEB} [data-web-seller] a`);
assert(siteLinks.length === 4 && siteLinks.every((a) => a.target === "_blank" && a.rel === "noopener noreferrer" && a.href.startsWith("https://")), `Todos los enlaces a sitios son https, abren en pestaña nueva y llevan rel="noopener noreferrer" (${siteLinks.length})`);
assert(mainCards[2].link === null && /Sin enlace directo/.test(mainCards[2].text) && mainCards[2].uruguay === "Uruguay: probable", "Un sitio sin enlace resuelto se muestra sin enlace");
assert(mainCards[3].link === null && !(await page.evaluate((s) => document.querySelector(s).innerHTML.includes("javascript:"), WEB)), "Un enlace javascript: que llegara del servidor no se convierte en enlace");
assert(!/\$\s?\d|US\$|\d\s?pesos/i.test(await textOf(`${WEB} [data-web-results]`)), "No hay precios en los resultados");

const others = c.filter((x) => x.inDetails);
assert(others.map((x) => x.site).join() === "es.aliexpress.com,dudosa.com" && others.every((x) => !x.shown) && (await page.$eval(`${WEB} details[data-web-others]`, (d) => !d.open)), "Internacionales y sin confirmar van en un bloque aparte, cerrado por defecto");
assert(/Internacionales y sin confirmar: confirmá que envían a Uruguay \(2\)/.test(await textOf(`${WEB} details[data-web-others] summary`)), "El bloque dice que hay que confirmar que envían a Uruguay");
await page.click(`${WEB} details[data-web-others] summary`);
await sleep(200);
c = await cards();
assert(c.filter((x) => x.inDetails).every((x) => x.shown && x.uruguay === "Uruguay: no confirmado"), "Al abrirlo se ven, marcados «no confirmado»");
const searched = await links(`${WEB} [data-web-results] p a`);
assert(searched.length === 1 && searched[0].text === "termo stanley classic comprar Uruguay" && searched[0].href.startsWith("https://www.google.com/search?q=") && searched[0].rel === "noopener noreferrer" && searched[0].target === "_blank", "Muestra lo que buscó Google, como enlace a esa búsqueda");
assert((await overflow()).length === 0, "Resultados web a 1280 px: sin desborde horizontal");
await shot("r12-web-resultados-1280", 1280);
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const o390 = await overflow();
assert(o390.length === 0, `Resultados web a 390 px: sin desborde horizontal${o390.length ? ` (${o390.join(", ")})` : ""}`);
assert(await page.evaluate(() => [...document.querySelectorAll("#mercado [role='tab']")].every((b) => b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().left >= 0)), "Las dos vistas entran a 390 px");
await shot("r12-web-resultados-390", 390);
await page.setViewport({ width: 1280, height: 900 });
await sleep(300);

// --- La vista conserva su estado ---
const webCount = webCalls.length;
await click("^Mercado Libre$");
await sleep(200);
assert((await panelHidden("photo-panel-web")) && (await page.$$eval(`${WEB} [data-web-seller]`, (e) => e.length)) === 6, "Al pasar a «Mercado Libre» los resultados web quedan montados y ocultos");
await click("^Lote CSV$");
await sleep(500);
await click("^Por foto$");
await sleep(300);
assert((await tabState()).startsWith("Mercado Libre:true:0") && (await page.$eval(NAME, (el) => el.value)) === "Termo Stanley Classic", "Ir a Lote CSV y volver conserva la vista elegida y el nombre");
await click("^En la web \\(Uruguay\\)$");
await sleep(200);
c = await cards();
assert(c.length === 6 && c.filter((x) => !x.inDetails).every((x) => x.shown) && (await page.$eval(`${WEB} details[data-web-others]`, (d) => d.open)), "Al volver a la vista web están los mismos resultados, con el bloque abierto como quedó");
assert(webCalls.length === webCount, "Cambiar de vista o de pestaña no repite la búsqueda web");

// --- Sin resultados, facturación y errores ---
const webCase = async (mode, name) => {
  webMode = mode;
  await retype(name);
  await page.click("#mercado [data-web-search]");
  await sleep(700);
};
await webCase("empty", "producto rarísimo");
assert(/No encontré sitios que vendan ese producto\. Probá con un nombre más corto o usá los botones de Google\./.test(await textOf(`${WEB} [data-web-results] [role='status']`)) && (await page.$$eval(`${WEB} [data-web-seller]`, (e) => e.length)) === 0, "Sin resultados: lo dice y sugiere acortar el nombre o usar Google");
assert((await links(`${WEB} a[data-google]`)).length === 2, "Sin resultados, los botones de Google siguen ahí");
await webCase("onlyOthers", "termo importado");
assert(/No encontré sitios de Uruguay para «termo importado»\. Hay 1 para revisar acá abajo\./.test(await textOf(`${WEB} [data-web-results] [role='status']`)) && /^Internacionales: confirmá que envían a Uruguay \(1\)$/.test(await textOf(`${WEB} details[data-web-others] summary`)), "Solo internacionales: lo avisa y el bloque se llama «Internacionales: confirmá que envían a Uruguay»");
await webCase("billing", "termo stanley");
assert((await page.$eval(`${WEB} [data-web-error]`, (el) => `${el.getAttribute("data-web-error")}|${el.getAttribute("role")}`).catch(() => "")) === "billing|alert" && /La búsqueda web necesita activar la facturación de la clave de Gemini\./.test(await webError()), `Sin facturación: mensaje claro con role=alert (${(await webError()).slice(0, 70)}…)`);
assert(!/api key|quota|403|billing|stack/i.test(await webError()) && (await links(`${WEB} a[data-google]`)).length === 2 && (await page.$(`${WEB} [data-web-results]`)) === null, "Ese mensaje no expone detalles internos y los botones de Google siguen funcionando");
await webCase("provider", "termo stanley");
assert((await page.$eval(`${WEB} [data-web-error]`, (el) => el.getAttribute("data-web-error")).catch(() => "")) === "error" && /No se pudo hacer la búsqueda web en este momento/.test(await webError()), "Error del proveedor: aviso claro");
await webCase("rate", "termo stanley");
assert(/Llegaste al límite de 5 usos por minuto/.test(await webError()), "Límite de uso: muestra el mensaje del servidor");
await webCase("garbage", "termo stanley");
assert(/No se pudo hacer la búsqueda web/.test(await webError()) && (await page.$(`${WEB} [data-web-results]`)) === null, "Respuesta con forma inesperada: no se muestra, se avisa");
await webCase("ok", "Termo Stanley Classic");
assert((await page.$$eval(`${WEB} [data-web-seller]`, (e) => e.length)) === 6 && (await page.$(`${WEB} [data-web-error]`)) === null, "Después de un error se puede buscar de nuevo y el aviso se va");

// --- Sugerencia cuando Mercado Libre no lo encuentra ---
await click("^Mercado Libre$");
await sleep(200);
assert((await page.$("#mercado [data-web-suggestion]")) === null, "Sin haber buscado en Mercado Libre no hay sugerencia");
await retype("Termo Stanley Classic");
await click("Buscar en Mercado Libre");
await page.waitForSelector("#mercado [data-reliability]", { timeout: 15000 }).catch(() => null);
assert((await page.$("#mercado [data-web-suggestion]")) === null, "Si Mercado Libre tiene precios, no se sugiere la web");
await retype("Termo Stanley Classic 1 litro");
await click("Buscar en Mercado Libre");
await page.waitForSelector("#mercado [data-web-suggestion]", { timeout: 15000 }).catch(() => null);
const suggestion = await textOf("#mercado [data-web-suggestion]");
assert(/Mercado Libre no tiene precios para «Termo Stanley Classic 1 litro»/.test(suggestion) && /Probá en la web de Uruguay/i.test(suggestion), `Si Mercado Libre no lo encuentra, aparece la sugerencia «Probá en la web de Uruguay» (${suggestion.slice(0, 60)}…)`);
assert((await visible("#mercado [data-broaden]")), "El botón de búsqueda ampliada del Radar sigue estando");
const beforeSuggestion = webCalls.length;
await click("Probá en la web de Uruguay");
await sleep(400);
assert((await tabState()).endsWith("En la web (Uruguay):true:0") && webCalls.length === beforeSuggestion, "La sugerencia lleva a la vista web y no ejecuta la búsqueda sola");
assert(new URL((await links(`${WEB} a[data-google]`))[0].href).searchParams.get("q") === "Termo Stanley Classic 1 litro Uruguay", "Los botones de Google ya tienen ese nombre");

// --- Quitar la foto limpia todo ---
await page.click('#mercado button[aria-label="Quitar la foto"]');
await sleep(200);
await upload(PHOTO);
await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
await click("Identificar producto");
await page.waitForSelector(NAME, { timeout: 10000 });
assert((await tabState()).startsWith("Mercado Libre:true:0") && (await page.$$eval(`${WEB} [data-web-seller]`, (e) => e.length)) === 0, "Con una foto nueva se arranca de cero: vista «Mercado Libre» y sin resultados web viejos");

await page.setViewport({ width: 390, height: 844 });
await click("^En la web \\(Uruguay\\)$");
await sleep(400);
const e390 = await overflow();
assert(e390.length === 0, `Vista web vacía a 390 px: sin desborde horizontal${e390.length ? ` (${e390.join(", ")})` : ""}`);
await shot("r12-web-vacia-390", 390);
assert(problems.length === 0, `Sin errores en la consola${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
if (passed !== total) process.exit(1);
