// Prueba en navegador de la búsqueda ampliada (Radar y Lote) y del indicador de confiabilidad.
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_search.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// Mercado Libre se simula acá: "Termo Stanley Classic 1 litro" no tiene precios y "Termo Stanley Classic" sí.
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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
// Guarda el CSV que exporta el Lote para poder leerlo.
await page.evaluateOnNewDocument(() => {
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    if (blob instanceof Blob) blob.text().then((t) => { window.__csv = t; });
    return original(blob);
  };
});

const queries = [];
const item = (id, price) => ({ id, title: `Termo Stanley Classic ${id}`, price, currency: "UYU", condition: "new", thumbnail: null, permalink: `https://example.com/${id}`, freeShipping: false, activeSellersCount: 2, match: { matches: true, missing: [] } });
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = new URL(req.url());
  const json = (body, status = 200) => req.respond({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname === "/api/exchange-rate") return json({ ok: true, rate: 40.5, referenceDate: "2026-10-08", fetchedAt: new Date().toISOString(), stale: false });
  if (url.pathname !== "/api/search-mlu") return req.continue();
  const q = url.searchParams.get("q") || "";
  queries.push(q);
  const base = { ok: true, query: q, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() };
  // Con la medida en el nombre no coincide nada; sin ella hay seis precios parejos.
  if (/1 litro|sin nada/i.test(q)) return json({ ...base, total: 0, items: [], stats: null, relevance: null });
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
const SEARCH = '#mercado input[aria-label^="Producto o modelo"]';
const AREA = '#mercado textarea[placeholder*="STAN-950"]';
const rows = () => page.$$eval("#mercado table tbody tr", (trs) => trs.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
const overflow = () =>
  page.evaluate(() => {
    const m = document.querySelector("#mercado");
    const limit = Math.min(m.getBoundingClientRect().right, innerWidth) + 1;
    // La tabla del Lote tiene su propio scroll horizontal: lo que está dentro no cuenta.
    return [...m.querySelectorAll("*:not(.visually-hidden)")].filter((n) => n.offsetParent !== null && !n.closest(".overflow-x-auto") && n.getBoundingClientRect().right > limit).map((n) => `${n.tagName}.${String(n.className).slice(0, 30)}`).slice(0, 3);
  });

// --- Radar: sin precios, ofrece la versión corta y no la busca sola ---
await page.type(SEARCH, "Termo Stanley Classic 1 litro");
await page.keyboard.press("Enter");
await page.waitForSelector("#mercado [data-broaden]", { timeout: 15000 }).catch(() => null);
const offer = await page.$eval("#mercado [data-broaden]", (b) => b.innerText).catch(() => null);
assert(offer === "Probar con «Termo Stanley Classic»", `Radar sin precios: ofrece el botón «Probar con «Termo Stanley Classic»» (${offer})`);
assert(queries.join("|") === "Termo Stanley Classic 1 litro", "Radar: la búsqueda ampliada no se ejecuta sola (una sola consulta hasta acá)");
assert((await overflow()).length === 0, "Radar a 1280 px: sin desborde horizontal");
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const o390 = await overflow();
assert(o390.length === 0, `Radar a 390 px: sin desborde horizontal${o390.length ? ` (${o390.join(", ")})` : ""}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/r10-radar-390.png`, clip: await page.$eval("#mercado", (el) => { const b = el.getBoundingClientRect(); return { x: 0, y: b.top + scrollY, width: 390, height: Math.min(b.height, 1400) }; }) });
await page.setViewport({ width: 1280, height: 900 });
await sleep(300);
await page.click("#mercado [data-broaden]");
await page.waitForSelector("#mercado [data-reliability]", { timeout: 15000 }).catch(() => null);
assert(queries.join("|") === "Termo Stanley Classic 1 litro|Termo Stanley Classic", "Radar: al tocar el botón se busca la versión corta");
assert((await page.$eval(SEARCH, (el) => el.value)) === "Termo Stanley Classic", "Radar: el cuadro de búsqueda muestra el nombre que se buscó");
assert((await page.$eval("#mercado [data-reliability]", (el) => el.innerText).catch(() => "")).toLowerCase() === "dato sólido", "Radar: con seis precios parejos, la etiqueta es Dato sólido");
assert((await page.$("#mercado [data-broaden]")) === null, "Radar: con precios ya no se ofrece ampliar");

// --- Lote con la opción apagada (por defecto) ---
queries.length = 0;
await click("^Lote CSV$");
await page.waitForSelector(AREA);
assert(await page.$eval('#mercado input[type="checkbox"]', (c) => !c.checked), "Lote: la opción «Ampliar la búsqueda» arranca apagada");
await page.type(AREA, "A-1, Termo Stanley Classic 1 litro, 1000, UYU\nB-2, Mate sin nada 1 litro, 500, UYU\nC-3, Termo Stanley Classic, 1000, UYU");
await click("Auditar Cat");
await page.waitForFunction(() => document.querySelectorAll("#mercado table tbody tr").length === 3, { timeout: 30000 });
let r = await rows();
const rowA = () => r.find((x) => x.startsWith("A-1")) ?? "";
assert(/Sin dato de mercado/i.test(rowA()) && !/Búsqueda ampliada/i.test(rowA()), "Apagada: la fila con el nombre completo sigue «Sin dato de mercado»");
assert(queries.length === 3, `Apagada: una consulta por fila (${queries.length})`);

// --- Lote con la opción encendida ---
queries.length = 0;
await page.click('#mercado input[type="checkbox"]');
await click("Auditar Cat");
await sleep(500);
await page.waitForFunction(() => document.querySelectorAll("#mercado table tbody tr").length === 3 && !/Auditando/.test(document.querySelector("#mercado").innerText), { timeout: 30000 });
r = await rows();
assert(/Búsqueda ampliada: «Termo Stanley Classic»/.test(rowA()) && /\$U 2\.500/.test(rowA()), "Encendida: la fila consigue precio y queda marcada «Búsqueda ampliada: «Termo Stanley Classic»»");
assert(/Dato flojo/.test(rowA()) && !/Dato sólido/.test(rowA()), "Encendida: su dato es «Dato flojo», nunca sólido (aunque los seis precios son parejos)");
const rowC = r.find((x) => x.startsWith("C-3")) ?? "";
assert(/Dato sólido/.test(rowC) && !/Búsqueda ampliada/.test(rowC), "La fila que ya tenía precio con su nombre no cambia: sigue sólida y sin marca");
const rowB = r.find((x) => x.startsWith("B-2")) ?? "";
assert(/Sin dato de mercado/i.test(rowB) && !/Búsqueda ampliada/.test(rowB) && /Tampoco hubo precios con «Mate sin nada»/.test(rowB), "Una fila que tampoco tiene precios con el nombre corto sigue sin dato, sin marca, y lo dice");
assert(
  queries.join(" | ") === "Termo Stanley Classic 1 litro | Termo Stanley Classic | Mate sin nada 1 litro | Mate sin nada | Termo Stanley Classic",
  `Encendida: una sola consulta extra por fila sin precios (${queries.join(" | ")})`
);
const reason = await page.evaluate(() => [...document.querySelectorAll("#mercado table tbody tr")].find((t) => t.innerText.startsWith("A-1"))?.querySelector("[title*='se buscó']")?.getAttribute("title"));
assert(/se buscó «Termo Stanley Classic» porque el nombre completo no tenía resultados/.test(reason ?? ""), "El motivo dice con qué nombre se buscó");

await click("Exportar CSV");
await sleep(600);
const csv = await page.evaluate(() => window.__csv ?? "");
const lines = csv.replace(/^﻿/, "").split("\n");
const header = lines[0].split(";");
const lineA = (lines.find((l) => l.startsWith('"A-1"')) ?? "").split(";");
const lineC = (lines.find((l) => l.startsWith('"C-3"')) ?? "").split(";");
assert(header.at(-1) === "Búsqueda ampliada" && header[0] === "SKU" && header[13] === "Viabilidad", "CSV: «Búsqueda ampliada» es la última columna y las anteriores no cambian de lugar");
assert(lineA.at(-1) === '"Termo Stanley Classic"' && lineA.at(-2) === "Dato flojo" && lineC.at(-1) === "" && lineC.at(-2) === "Dato sólido", "CSV: la fila ampliada lleva el nombre usado y «Dato flojo»; la otra queda vacía y sólida");
assert((await overflow()).length === 0, "Lote a 1280 px: sin desborde horizontal fuera de la tabla");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/r10-lote-1280.png`, clip: await page.$eval("#mercado", (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, width: b.width, height: Math.min(b.height, 1500) }; }) });
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const l390 = await overflow();
assert(l390.length === 0, `Lote a 390 px: sin desborde horizontal fuera de la tabla${l390.length ? ` (${l390.join(", ")})` : ""}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/r10-lote-390.png`, clip: await page.$eval("#mercado", (el) => { const b = el.getBoundingClientRect(); return { x: 0, y: b.top + scrollY, width: 390, height: Math.min(b.height, 1600) }; }) });
assert(problems.length === 0, `Sin errores de JavaScript${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
if (passed !== total) process.exit(1);
