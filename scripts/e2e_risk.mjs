// Prueba en navegador de "Sensibilidad al dólar" y "Escenarios".
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_risk.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// /api/exchange-rate y /api/search-mlu se simulan acá: dólar fijo en 40,50 y sin consultas a Mercado Libre.
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
page.on("pageerror", (e) => problems.push(`pageerror: ${e}`));
page.on("console", (m) => {
  // El proyecto no tiene favicon.ico: ese 404 es anterior a esta ronda y no es de la app.
  if (m.type() === "error" && !/favicon\.ico/.test(m.location()?.url ?? "")) problems.push(`console: ${m.text()} ${m.location()?.url ?? ""}`);
});

await page.setRequestInterception(true);
page.on("request", (req) => {
  const url = new URL(req.url());
  const json = (body) => req.respond({ contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname === "/api/exchange-rate") {
    return json({ ok: true, rate: 40.5, referenceDate: "2026-10-08", fetchedAt: new Date().toISOString(), stale: false });
  }
  if (url.pathname === "/api/search-mlu") {
    return json({ ok: true, query: url.searchParams.get("q") || "", total: 0, items: [], stats: null, exact: null, exactSelection: null, unsupported: [], fetchedAt: new Date().toISOString() });
  }
  return req.continue();
});

await page.goto(APP_URL, { waitUntil: "networkidle2" });
await sleep(1200);

const setField = async (id, value) => {
  await page.$eval(`#${id}`, (el) => { el.focus(); el.select(); });
  await page.keyboard.press("Backspace");
  if (value) await page.keyboard.type(value);
  await page.keyboard.press("Tab");
  await sleep(400);
};
const RISK = 'section[aria-label="Análisis de riesgo"]';
const text = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, " ").trim());
const hero = () => text("#resultado");
const risk = () => text(RISK);
const clickIn = (scope, re) =>
  page.evaluate((sel, src) => {
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src, "i").test(x.textContent) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, scope, re);
const card = (id) => text(`${RISK} [data-scenario="${id}"]`);
const scenarioInput = (id, n) => `${RISK} [data-scenario="${id}"] input:nth-of-type(1)`.replace("input:nth-of-type(1)", `label:nth-of-type(${n}) input`);
const profitOf = (s) => Number((s.match(/(−?)\$U ([\d.]+)/) ?? [])[2]?.replace(/\./g, "")) * (/−\$U/.test(s.match(/(−?)\$U ([\d.]+)/)?.[0] ?? "") ? -1 : 1);

// Producto: U$S 26, se vende a $U 2.290, dólar 40,50.
await setField("wholesale-cost", "26");
await setField("sale-price", "2290");
const heroBefore = await hero();
assert(/\$U 939/.test(heroBefore) && /41,0%/.test(heroBefore), "Resultado de partida: $U 939 (41,0%) en Mercado Libre");
assert(
  await page.$$eval(`${RISK} > div > button`, (bs) => bs.length === 2 && bs.every((b) => b.getAttribute("aria-expanded") === "false")),
  "Los dos bloques arrancan cerrados"
);

// Sensibilidad al dólar
assert(await clickIn(RISK, "Sensibilidad al dólar"), "Se abre «Sensibilidad al dólar»");
await sleep(400);
let r = await risk();
assert(/sube a \$ 76,63 \(\+89,2%\)/.test(r) && /deja de dar ganancia/i.test(r), "Dólar de quiebre: $ 76,63 (+89,2%)");
assert(/\$ 63,42/.test(r) && /Ajustado/.test(r), "Muestra el dólar al que baja de Bueno a Ajustado ($ 63,42)");
const rows = await page.$$eval(`${RISK} table tbody tr`, (trs) => trs.map((t) => t.innerText.replace(/\s+/g, " ").trim()));
assert(rows.length === 5 && /\$ 36,45/.test(rows[0]) && /\$ 40,50 actual \$U 939 41,0%/.test(rows[2]) && /\$ 44,55/.test(rows[4]), "Tabla de 5 filas; la fila «actual» coincide con el resultado ($U 939, 41,0%)");
const tableProfits = rows.map(profitOf);
assert(tableProfits.every((p, i) => i === 0 || p < tableProfits[i - 1]), `Más dólar, menos ganancia: ${tableProfits.join(" > ")}`);
assert((await hero()) === heroBefore, "Abrir la sensibilidad no cambia el resultado principal");

// Escenarios
assert(await clickIn(RISK, "^Escenarios$"), "Se abre «Escenarios»");
await sleep(400);
const base = await card("base");
const pess = await card("pessimistic");
const opt = await card("optimistic");
assert(/\$U 939/.test(base) && /41,0%/.test(base), "Escenario Base = resultado de hoy ($U 939, 41,0%)");
assert(profitOf(pess) < profitOf(base) && profitOf(base) < profitOf(opt), `Pesimista < Base < Optimista (${profitOf(pess)} < ${profitOf(base)} < ${profitOf(opt)})`);
assert(/simulaciones.*no predicciones/i.test(await risk()), "Aclara que son simulaciones, no predicciones");
assert((await hero()) === heroBefore, "Abrir los escenarios no cambia el resultado principal");

const typeScenario = async (id, n, value) => {
  const sel = scenarioInput(id, n);
  await page.$eval(sel, (el) => { el.focus(); el.select(); });
  await page.keyboard.type(value);
  await page.keyboard.press("Tab");
  await sleep(300);
  return page.$eval(sel, (el) => el.value);
};
const pessProfit = profitOf(pess);
await typeScenario("pessimistic", 1, "-30");
assert(profitOf(await card("pessimistic")) < pessProfit, "Bajar más el precio en el Pesimista baja su ganancia");
assert((await typeScenario("pessimistic", 1, "500")) === "100" && (await typeScenario("pessimistic", 2, "-90")) === "-50", "Los porcentajes fuera de rango se ajustan a −50 … +100");
assert(await clickIn(RISK, "Ciberlunes"), "Se aplica el preset Ciberlunes");
await sleep(300);
const cyber = await card("pessimistic");
assert(/Ciberlunes/i.test(cyber) && /Precio \$U 1\.832/.test(cyber), "Ciberlunes: la tarjeta cambia de nombre y usa precio −20% ($U 1.832)");
assert(await clickIn(RISK, "Restaurar valores por defecto"), "Se restauran los valores por defecto");
await sleep(300);
assert(profitOf(await card("pessimistic")) === pessProfit && /Pesimista/i.test(await card("pessimistic")), "Restaurar vuelve al Pesimista original");
assert((await hero()) === heroBefore, "Editar escenarios no cambia el resultado principal");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/r8-riesgo-1280.png`, clip: await page.$eval(RISK, (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, width: b.width, height: b.height }; }) });

// Cambiar el costo: todo se recalcula de forma coherente.
await setField("wholesale-cost", "40");
r = await risk();
const heroCost40 = await hero();
assert(/sube a \$ 49,81 \(\+23,0%\)/.test(r), "Con costo U$S 40 el dólar de quiebre baja a $ 49,81 (+23,0%)");
assert(profitOf(await card("base")) === profitOf(heroCost40), "Con el costo nuevo, el Base sigue coincidiendo con el resultado principal");

// Cambiar el dólar (+10% desde la tarjeta de resultado).
assert(await clickIn("#resultado", "^\\+10%$"), "Se sube el dólar 10% desde la tarjeta de resultado");
await sleep(500);
r = await risk();
assert(/\$ 44,55 actual/.test(r) && /sube a \$ 49,81 \(\+11,8%\)/.test(r), "Con el dólar a 44,55 el quiebre sigue en $ 49,81 y el colchón baja a +11,8%");
assert(profitOf(await card("base")) === profitOf(await hero()), "Con el dólar nuevo, el Base coincide con el resultado principal");
await clickIn("#resultado", "Volver a");
await sleep(400);

// Móvil 390 px: sin desborde horizontal dentro del bloque.
await page.setViewport({ width: 390, height: 844 });
await sleep(600);
const overflow = await page.$eval(RISK, (el) => {
  const limit = el.getBoundingClientRect().right + 1;
  // Los textos solo para lectores de pantalla están recortados a 1 px a propósito: no cuentan.
  return [el, ...el.querySelectorAll("*:not(.visually-hidden)")].filter((n) => n.getBoundingClientRect().right > limit || n.scrollWidth > n.clientWidth + 1).map((n) => `${n.tagName}.${String(n.className).slice(0, 40)}`).slice(0, 3);
});
assert(overflow.length === 0 && (await page.$eval(RISK, (el) => el.getBoundingClientRect().right <= 390)), `A 390 px el bloque entra sin scroll horizontal${overflow.length ? `: ${overflow.join(", ")}` : ""}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/r8-riesgo-390.png`, clip: await page.$eval(RISK, (el) => { const b = el.getBoundingClientRect(); return { x: 0, y: b.top + scrollY, width: 390, height: b.height }; }) });
await page.setViewport({ width: 1280, height: 900 });
await sleep(400);

// Estados vacíos: sin costo y costo en pesos.
await setField("wholesale-cost", "");
r = await risk();
assert(/Cargá el costo/i.test(r) && !/NaN|Infinity|undefined/.test(r), "Sin costo: estado vacío explicativo, sin NaN");
await setField("wholesale-cost", "1053");
await page.evaluate(() => {
  const group = document.querySelector('[aria-label="Moneda del costo"]') ?? document.querySelector('input[name="cost-currency"]')?.closest("div");
  const target = [...(group?.querySelectorAll("button, label, input") ?? [])].find((el) => /UYU|\$U/.test(el.textContent || el.value || ""));
  target?.click();
});
await sleep(500);
r = await risk();
assert(/Tu costo está en pesos/i.test(r), "Costo en pesos: avisa que el dólar no cambia el resultado");
assert(!/NaN|Infinity|undefined/.test(r), "Sin NaN ni valores raros en los bloques");
assert(problems.length === 0, `Sin errores en la consola${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
if (passed !== total) process.exit(1);
