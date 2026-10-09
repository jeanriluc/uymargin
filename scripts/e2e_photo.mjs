// Prueba en navegador de la pestaña «Por foto».
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_photo.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// /api/identify-product y /api/search-mlu se simulan acá: no se llama a Gemini ni a Mercado Libre.
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
const PHOTO_2 = file("paisaje.png", png(600, 900, [90, 150, 220]));
const HUGE = file("enorme.jpg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(21 * 1024 * 1024)]));
const NOT_IMAGE = file("falsa.png", Buffer.from("esto no es una imagen"));
const TEXT = file("notas.txt", Buffer.from("hola"));

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

// --- La pestaña existe y carga su panel recién al abrirla ---
assert((await page.$('#mercado input[data-photo-input="file"]')) === null, "Antes de abrirla, el panel «Por foto» no está cargado (lazy)");
assert(await click("^Por foto$"), "Hay una pestaña «Por foto» junto a Radar MLU, Por enlace y Lote CSV");
await page.waitForSelector('#mercado input[data-photo-input="file"]', { timeout: 15000 });
assert(/La IA puede equivocarse con productos genéricos\. Revisá el nombre antes de buscar\./.test(await textOf("#mercado")), "Muestra el aviso de que la IA puede equivocarse");
assert(!/probabilidad de rentabilidad/i.test(await textOf("#mercado")), "No promete ninguna «probabilidad de rentabilidad»");
assert(await visible('#mercado input[aria-label^="Producto o modelo"]') === false, "En «Por foto» no se ve el cuadro de texto del Radar");

// --- Subir una foto: se achica en el navegador y no se analiza sola ---
await upload(PHOTO);
await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
const preview = await page.$eval("#mercado img[data-photo-preview]", (img) => img.decode().then(() => ({ w: img.naturalWidth, h: img.naturalHeight, alt: img.alt })));
assert(preview.w === 1024 && preview.h === 768, `La foto de 1600×1200 se achica a 1024×768 antes de enviarse (${preview.w}×${preview.h})`);
assert(preview.alt.length > 0 && (await visible('#mercado button[aria-label="Quitar la foto"]')), "Vista previa con texto alternativo y botón para quitarla");
assert(identify.length === 0 && queries.length === 0, "Elegir la foto no gasta una llamada a la IA ni busca");

// --- Analizando… y cancelar ---
delayMs = 1500;
await click("Identificar producto");
await page.waitForFunction(() => /Analizando…/.test(document.querySelector("#mercado").innerText), { timeout: 5000 }).catch(() => null);
assert(/Analizando…/.test(await textOf("#mercado [role='status']")) && (await click("^Cancelar$")), "Mientras analiza muestra «Analizando…» (role=status) y deja cancelar");
await sleep(1800);
assert((await page.$(NAME)) === null && /Cancelaste el análisis/.test(await textOf("#mercado [role='status']")), "Cancelado: no aparece ningún resultado aunque la respuesta llegue después");
assert(await visible("#mercado img[data-photo-preview]"), "Cancelar no quita la foto");
delayMs = 0;

// --- Resultado: nombre editable, alternativas y confianza ---
await click("Identificar producto");
await page.waitForSelector(NAME, { timeout: 10000 });
const sent = identify.at(-1);
assert(sent.method === "POST" && sent.type === "image/jpeg" && sent.hasBody, `La foto viaja como JPEG en el cuerpo del pedido (${sent.type})`);
assert((await page.$eval(NAME, (el) => el.value)) === IDENTIFIED.name, "El nombre identificado aparece en un campo editable");
assert((await page.$eval(NAME, (el) => !el.readOnly && !el.disabled && document.querySelector(`label[for="${el.id}"]`) !== null)), "El campo es editable y tiene su etiqueta");
assert((await page.evaluate((s) => document.activeElement === document.querySelector(s), NAME)), "El foco queda en el nombre para revisarlo");
assert((await textOf("#mercado [data-photo-confidence]")) === "Puede ser", "Confianza media se dice «Puede ser»");
assert((await textOf("#mercado [data-photo-alternative]")) === "Termo Stanley | Termo acero inoxidable", "Los nombres alternativos aparecen como botones");
const resultText = await textOf("#mercado [data-photo-result]");
assert(/Marca: Stanley/.test(resultText) && /Categoría: Termos/.test(resultText) && /acero inoxidable/.test(resultText) && /La marca se lee en el frente/.test(resultText), "Muestra marca, categoría, atributos y la nota");
assert(queries.length === 0, "No busca sola: todavía no hubo ninguna consulta a Mercado Libre");
assert((await overflow()).length === 0, "Resultado a 1280 px: sin desborde horizontal");
await shot("r11-foto-resultado-1280", 1280);

await click("^Termo Stanley$");
assert((await page.$eval(NAME, (el) => el.value)) === "Termo Stanley", "Un alternativo reemplaza el nombre");
assert(/Termo Stanley Classic 1 litro/.test(await textOf("#mercado [data-photo-alternative]")), "El nombre original queda como opción para volver");
assert(queries.length === 0, "Elegir un alternativo tampoco busca");

// --- Editar el nombre y buscar: mismo Radar, misma búsqueda ampliada ---
const aiCalls = identify.length;
await retype("Termo Stanley Classic 1 litro");
await click("Buscar en Mercado Libre");
await page.waitForSelector("#mercado [data-broaden]", { timeout: 15000 }).catch(() => null);
assert(queries.join("|") === "Termo Stanley Classic 1 litro", "«Buscar en Mercado Libre» consulta con el nombre que quedó en el campo");
const offer = await page.$eval("#mercado [data-broaden]", (b) => (b.offsetParent !== null ? b.innerText : null)).catch(() => null);
assert(offer === "Probar con «Termo Stanley Classic»", `Sin precios: se ve el botón de búsqueda ampliada del Radar (${offer})`);
await retype("Termo Stanley Classic");
await page.keyboard.press("Enter");
await page.waitForSelector("#mercado [data-reliability]", { timeout: 15000 }).catch(() => null);
assert(queries.join("|") === "Termo Stanley Classic 1 litro|Termo Stanley Classic", "Corregir el nombre y buscar de nuevo (con Enter) hace otra búsqueda");
assert(identify.length === aiCalls, "Editar el nombre y volver a buscar no gasta otra llamada a la IA");
assert((await textOf("#mercado [data-reliability]")).toLowerCase() === "dato sólido", "Se ve el mismo resumen de mercado, con su indicador de confiabilidad");
assert(/2\.500/.test(await textOf("#mercado")), "Se ve la mediana del mercado");
assert((await overflow()).length === 0, "Con resultados a 1280 px: sin desborde horizontal");
await shot("r11-foto-busqueda-1280", 1280);

await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const o390 = await overflow();
assert(o390.length === 0, `Con resultados a 390 px: sin desborde horizontal${o390.length ? ` (${o390.join(", ")})` : ""}`);
const tabsFit = await page.evaluate(() => {
  const bar = [...document.querySelectorAll("#mercado button[aria-pressed]")];
  return bar.length === 4 && bar.every((b) => b.getBoundingClientRect().right <= innerWidth && b.scrollWidth <= b.clientWidth + 1);
});
assert(tabsFit, "Las cuatro pestañas entran a 390 px sin cortarse");
await shot("r11-foto-busqueda-390", 390);
await page.setViewport({ width: 1280, height: 900 });
await sleep(300);

// --- La pestaña conserva su estado ---
await click("^Lote CSV$");
await sleep(600);
assert(
  await page.evaluate((s) => { const el = document.querySelector(s); return !!el && el.offsetParent === null && el.closest('[aria-hidden="true"]') !== null; }, NAME),
  "Al pasar a Lote, «Por foto» queda montada, oculta y con aria-hidden"
);
await click("^Radar MLU$");
await sleep(300);
assert((await page.$eval('#mercado input[aria-label^="Producto o modelo"]', (el) => (el.offsetParent !== null ? el.value : null))) === "Termo Stanley Classic", "En Radar MLU el cuadro muestra lo que se buscó desde la foto");
assert((await textOf("#mercado [data-reliability]")).toLowerCase() === "dato sólido" && !(await visible(NAME)), "Radar MLU muestra los mismos resultados, sin el panel de la foto");
await click("^Por foto$");
await sleep(300);
assert((await page.$eval(NAME, (el) => (el.offsetParent !== null ? el.value : null))) === "Termo Stanley Classic", "Al volver, el nombre editado sigue ahí");
assert((await visible("#mercado img[data-photo-preview]")) && (await textOf("#mercado [data-photo-confidence]")) === "Puede ser", "La foto y el resultado de la IA siguen ahí");
assert(identify.length === aiCalls && queries.length === 2, "Cambiar de pestaña no repite ni la IA ni la búsqueda");

// --- Quitar la foto ---
await page.click('#mercado button[aria-label="Quitar la foto"]');
await sleep(200);
assert((await page.$(NAME)) === null && (await page.$("#mercado img[data-photo-preview]")) === null && (await click("^$", "#no-existe")) === false, "Quitar la foto borra la vista previa y el resultado");
assert(/Arrastrá una foto acá/.test(await textOf("#mercado")), "Vuelve la zona para subir una foto");

// --- No hay producto ---
mode = "noProduct";
await upload(PHOTO_2);
await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
const p2 = await page.$eval("#mercado img[data-photo-preview]", (img) => img.decode().then(() => `${img.naturalWidth}x${img.naturalHeight}`));
assert(p2 === "600x900", `Una foto chica (600×900) no se agranda (${p2})`);
await click("Identificar producto");
await page.waitForSelector("#mercado [data-photo-no-product]", { timeout: 10000 }).catch(() => null);
const noProduct = await textOf("#mercado [data-photo-no-product]");
assert(/No encontré un producto claro en la foto/.test(noProduct) && /Solo se ve un paisaje/.test(noProduct) && /Subir otra foto/i.test(noProduct), "isProduct false: mensaje claro, el motivo y botón para subir otra");
assert((await page.$(NAME)) === null && !(await visible("#mercado button[type='submit']")), "Sin producto no hay nombre ni botón de buscar");
const queriesBefore = queries.length;

// --- Errores del servidor ---
const errorCase = async (m, re, label) => {
  mode = m;
  await upload(PHOTO);
  await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
  await click("Identificar producto");
  await page.waitForSelector("#mercado [data-photo-error]", { timeout: 10000 }).catch(() => null);
  const alert = await textOf("#mercado [data-photo-error]");
  assert(re.test(alert) && (await page.$(NAME)) === null, `${label} (${alert.slice(0, 70)}…)`);
  assert(await visible("#mercado img[data-photo-preview]"), `${label.split(":")[0]}: la foto queda cargada para reintentar`);
};
await errorCase("provider", /La IA no pudo analizar la foto en este momento/, "Error del proveedor: aviso claro con role=alert");
assert(!/gemini|api key|quota|stack/i.test(await textOf("#mercado [data-photo-error]")), "El aviso no expone detalles internos");
await errorCase("notConfigured", /falta configurar la IA en el servidor/, "Sin clave configurada: aviso claro");
await errorCase("rate", /Llegaste al límite de 5 usos por minuto/, "Límite de uso: muestra el mensaje del servidor");
await errorCase("tooLarge", /La foto es demasiado pesada/, "El servidor rechaza por tamaño (413): aviso claro");
await errorCase("garbage", /respuesta que no se pudo leer/, "Respuesta con forma inesperada: no se muestra, se avisa");
mode = "ok";
await click("Identificar producto");
await page.waitForSelector(NAME, { timeout: 10000 }).catch(() => null);
assert((await page.$eval(NAME, (el) => el.value).catch(() => null)) === IDENTIFIED.name && !(await visible("#mercado [data-photo-error]")), "Después de un error se puede reintentar con la misma foto y el aviso se va");

// --- Archivos que no sirven: se frenan en el navegador, sin gastar IA ---
const before = identify.length;
await upload(HUGE);
await sleep(500);
assert(/La foto es demasiado pesada/.test(await textOf("#mercado [data-photo-error]")) && (await page.$("#mercado img[data-photo-preview]")) === null, "Imagen demasiado grande (21 MB): aviso claro y no se carga");
await upload(NOT_IMAGE);
await page.waitForFunction(() => /No se pudo abrir esa imagen/.test(document.querySelector("#mercado").innerText), { timeout: 8000 }).catch(() => null);
assert(/No se pudo abrir esa imagen/.test(await textOf("#mercado [data-photo-error]")), "Un archivo .png que no es una imagen real: aviso claro");
await upload(TEXT);
await sleep(400);
assert(/subí una foto en JPG, PNG o WebP/.test(await textOf("#mercado [data-photo-error]")), "Un archivo de otro tipo: aviso claro");
assert(identify.length === before && queries.length === queriesBefore, "Ninguno de esos archivos llegó a la IA ni disparó una búsqueda");

await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const e390 = await overflow();
assert(e390.length === 0, `Zona de subida con aviso a 390 px: sin desborde horizontal${e390.length ? ` (${e390.join(", ")})` : ""}`);
await shot("r11-foto-vacia-390", 390);
assert(problems.length === 0, `Sin errores en la consola${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
if (passed !== total) process.exit(1);
