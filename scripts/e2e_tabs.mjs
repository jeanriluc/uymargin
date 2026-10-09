// Prueba en navegador: el Lote y el análisis por enlace conservan su estado al cambiar de pestaña y al "Simular".
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_tabs.mjs            (APP_URL y CHROME_PATH son opcionales)
// Las respuestas de /api/search-mlu se simulan acá: no consulta a Mercado Libre.
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3917/";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// El cuadro de texto del Lote (en el Radar hay otro, el de precios manuales).
const BATCH_AREA = '#mercado textarea[placeholder*="STAN-950"]';

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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// Mercado Libre simulado: "caro" da pérdida, "sin precio" no devuelve estadísticas.
await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = new URL(req.url());
  if (url.pathname !== "/api/search-mlu") return req.continue();
  const q = url.searchParams.get("q") || "";
  const median = /sin precio/i.test(q) ? 0 : /caro/i.test(q) ? 1000 : 3000;
  const stats = median ? { min: median, median, max: median, average: median, sampleSize: 5, outliersRemoved: 0 } : null;
  req.respond({
    contentType: "application/json",
    body: JSON.stringify({ ok: true, query: q, total: stats ? 5 : 0, items: [], stats, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() }),
  });
});

await page.goto(APP_URL, { waitUntil: "networkidle2" });
await sleep(1000);

const clickButton = (re, scope = "body") =>
  page.evaluate((src, sel) => {
    const visible = (el) => el.offsetParent !== null;
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src, "i").test(x.textContent) && visible(x));
    if (!b) return false;
    b.click();
    return true;
  }, re, scope);
const openTab = async (name) => { await clickButton(`^${name}$`, "#mercado"); await sleep(600); };
const activeTab = () => page.evaluate(() => document.querySelector('#mercado button[aria-pressed="true"]')?.textContent.trim());
const batchState = () =>
  page.evaluate((sel) => {
    const area = document.querySelector(sel);
    const rows = [...document.querySelectorAll("#mercado table tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim());
    return { text: area?.value ?? null, visible: !!area && area.offsetParent !== null, rows };
  }, BATCH_AREA);
const radarText = () =>
  page.evaluate(() => document.querySelector('#mercado input[aria-label^="Producto o modelo"]')?.closest("div.grid, div.hidden")?.textContent.replace(/\s+/g, " ") ?? "");

// 1. Una búsqueda en el Radar, para comprobar después que se vacía al simular otro producto.
await page.type('#mercado input[aria-label^="Producto o modelo"]', "producto del radar");
await page.keyboard.press("Enter");
await sleep(1200);
const radarBefore = await radarText();

// 2. Lote: cargar un catálogo y ejecutarlo.
await openTab("Lote CSV");
await page.waitForSelector(BATCH_AREA);
const CSV = "A-1, Producto bueno, 1000, UYU\nB-2, Producto caro, 1200, UYU\nC-3, Producto sin precio, 500, UYU";
await page.type(BATCH_AREA, CSV);
assert(await clickButton("Ejecutar|Auditar|Analizar|Calcular", "#mercado"), "Se ejecuta el lote");
await page.waitForFunction(() => document.querySelectorAll("#mercado table tbody tr").length === 3, { timeout: 30000 });
const first = await batchState();
assert(first.rows.length === 3 && first.text === CSV, "El lote muestra 3 filas y conserva el texto cargado");

const unpricedRow = first.rows.find((r) => /sin precio/i.test(r)) ?? "";
assert(/Sin dato de mercado/i.test(unpricedRow) && !/%/.test(unpricedRow), "Fila sin dato de mercado: sin margen ni ganancia calculados");
const lossRow = first.rows.find((r) => /caro/i.test(r)) ?? "";
assert(/−\$U/.test(lossRow) && !/\+\s*−/.test(lossRow), "Fila con pérdida: «−$U …», sin «+−»");

// 3. Cambiar de pestaña y volver: no se pierde nada.
await openTab("Radar MLU");
const hiddenState = await batchState();
assert(hiddenState.text === CSV && !hiddenState.visible, "Con el Radar activo, el Lote sigue montado y oculto");
assert(
  await page.evaluate((sel) => document.querySelector(sel)?.closest('[aria-hidden="true"]') !== null, BATCH_AREA),
  "El panel oculto lleva aria-hidden"
);
await openTab("Por enlace");
await page.waitForSelector('#mercado input[placeholder^="https://www.mercadolibre"]');
await page.type('#mercado input[placeholder^="https://www.mercadolibre"]', "https://articulo.mercadolibre.com.uy/MLU-123");
await openTab("Lote CSV");
const back = await batchState();
assert(back.visible && back.text === CSV && back.rows.join("|") === first.rows.join("|"), "Al volver al Lote, el texto y los resultados siguen igual");

// 4. "Simular" en una fila: no cambia de pestaña ni borra el lote, y el Radar queda vacío.
assert(await clickButton("^Simular$", "#mercado table"), "Se hace clic en «Simular» de la primera fila");
await sleep(1000);
const afterSim = await batchState();
assert((await activeTab()) === "Lote CSV", "Después de «Simular» sigue activa la pestaña Lote CSV");
assert(afterSim.visible && afterSim.text === CSV && afterSim.rows.join("|") === first.rows.join("|"), "Después de «Simular» el lote sigue completo");
assert(
  await page.evaluate(() => /Producto bueno/.test(document.body.innerText) && Number(document.querySelector("#sale-price")?.value.replace(/\D/g, "")) === 3000),
  "El producto simulado quedó cargado en el simulador (nombre y precio)"
);
const radarAfter = await radarText();
assert(/producto del radar/i.test(radarBefore) || radarBefore.length > 0, "El Radar tenía una búsqueda hecha");
assert(!/«producto del radar»|"producto del radar"/i.test(radarAfter) && radarAfter.length < radarBefore.length, "El Radar quedó vacío: no muestra resultados de otro producto");

// 5. Por enlace conserva lo escrito.
await openTab("Por enlace");
assert(
  (await page.$eval('#mercado input[placeholder^="https://www.mercadolibre"]', (e) => e.value)) === "https://articulo.mercadolibre.com.uy/MLU-123",
  "Por enlace conserva la URL escrita al volver"
);
assert(pageErrors.length === 0, `Sin errores de JavaScript en la página${pageErrors.length ? `: ${pageErrors[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
if (passed !== total) process.exit(1);
