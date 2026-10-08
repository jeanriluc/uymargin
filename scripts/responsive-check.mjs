// Medición reproducible de desbordes. Solo lee: no escribe en Supabase ni guarda nada en la app.
// Uso: node scripts/responsive-check.mjs <etiqueta> [url]   →  docs/audit/responsive-<etiqueta>.json
// Requiere la app corriendo (por defecto http://localhost:3001) y Google Chrome instalado.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const tag = process.argv[2] || "medicion";
const url = process.argv[3] || "http://localhost:3001";
const WIDTHS = [320, 360, 390, 430, 600, 768, 900, 1024, 1180, 1280, 1440];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "docs/audit";
mkdirSync(`${OUT}/capturas`, { recursive: true });

/** Runs in the page: every visible element whose box leaves its nearest visible container. */
function measure() {
  const visibleBox = (el) => {
    const cs = getComputedStyle(el);
    const hasBorder = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0);
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg);
    return hasBorder || hasBg;
  };
  const describe = (el) => {
    const text = (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${text}"`;
  };
  const section = (el) => {
    const s = el.closest("section, article, header, nav, [role=dialog]");
    const h = s?.querySelector("h1, h2, h3");
    return (s?.getAttribute("aria-label") || h?.textContent || s?.tagName || "página").trim().replace(/\s+/g, " ").slice(0, 45);
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("button, a, input, select, textarea, span, p, h1, h2, h3, h4, strong, label, img, li, td")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "absolute" || cs.visibility === "hidden") continue;
    if (el.closest(".visually-hidden, [role=tooltip]")) continue;
    // Nearest ancestor that draws a box; stop if something in between scrolls horizontally on purpose.
    let c = el.parentElement;
    let scrolls = false;
    let fixedAncestor = false;
    while (c && c !== document.body && !visibleBox(c)) {
      const o = getComputedStyle(c);
      if (o.overflowX === "auto" || o.overflowX === "scroll") scrolls = true;
      c = c.parentElement;
    }
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowX === "auto" || o.overflowX === "scroll") scrolls = true;
      if (o.position === "fixed") fixedAncestor = true;
    }
    if (!c || c === document.body || scrolls) continue;
    const cr = c.getBoundingClientRect();
    const right = Math.round(r.right - cr.right);
    const left = Math.round(cr.left - r.left);
    const by = Math.max(right, left);
    if (by > 1) {
      const key = describe(el) + "|" + section(el);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tipo: "sale del contenedor", px: by, elemento: describe(el), contenedor: describe(c).slice(0, 60), zona: section(el) });
    }
    // A button whose own label does not fit.
    if (el.tagName === "BUTTON" && !el.classList.contains("tap-inline") && el.scrollWidth > el.clientWidth + 1 && !fixedAncestor) {
      const key = "t|" + describe(el);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ tipo: "texto de botón cortado", px: el.scrollWidth - el.clientWidth, elemento: describe(el), zona: section(el) });
      }
    }
  }
  // Touch ergonomics (meaningful in the touch-emulated pass).
  const controls = [...document.querySelectorAll("button, summary, select, input:not([type=checkbox]):not([type=radio]), textarea")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !e.closest(".visually-hidden");
  });
  const controlesBajo44 = controls
    .filter((e) => e.getBoundingClientRect().height < 43.5 && !e.classList.contains("tap-inline") && !e.classList.contains("tap-compact"))
    .map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} ${describe(e)}`);
  const camposBajo16px = controls
    .filter((e) => /INPUT|TEXTAREA|SELECT/.test(e.tagName) && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map(describe);
  const de = document.documentElement;
  return {
    controlesBajo44,
    camposBajo16px, paginaDesborda: de.scrollWidth > de.clientWidth, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, hallazgos: out };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 60000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOT_WIDTHS = [320, 390, 768, 1024, 1180, 1440];
const estados = { "calculadora + radar": {}, "por enlace": {} };
let radarItems = 0;
let enlaceOk = false;

// Two passes: touch emulation for phone widths, mouse for the rest. Switching emulation reloads
// the page (and would drop the search results), so each pass keeps one mode and only resizes.
async function runPass(widths, mobile) {
  const page = await browser.newPage();
  const viewport = (w) => ({ width: w, height: 900, isMobile: mobile, hasTouch: mobile });
  await page.setViewport(viewport(mobile ? 430 : 1280));
  await page.goto(url, { waitUntil: "networkidle2" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle2" });

  const clickText = (text) =>
    page.evaluate((text) => {
      const b = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
      b?.click();
      return Boolean(b);
    }, text);

  // Estado 1: calculadora completa, nombre largo y radar con publicaciones reales.
  await page.type("#wholesale-cost", "26");
  await page.type("#sale-price", "2290");
  await page.type("#product-name", "Botella termo Stanley Classic 950 ml verde martillado · Proveedor Montevideo Centro");
  await page.type("#mlu-search-input", "termo stanley");
  await page.keyboard.press("Enter");
  await page
    .waitForFunction(() => /Publicaciones Reales/i.test(document.querySelector("#mercado")?.textContent || ""), { timeout: 40000 })
    .catch(() => {});
  await wait(800);
  radarItems = await page.evaluate(
    () => [...document.querySelectorAll("#mercado button")].filter((b) => b.textContent.trim() === "Simular").length
  );
  for (const w of widths) {
    await page.setViewport(viewport(w));
    await wait(350);
    estados["calculadora + radar"][w] = await page.evaluate(measure);
    if (SHOT_WIDTHS.includes(w)) await page.screenshot({ path: `${OUT}/capturas/responsive-${tag}-radar-${w}.png`, fullPage: true });
  }

  // Estado 2: "Por enlace" con una publicación real analizada.
  await clickText("Por enlace");
  await wait(1500);
  if (await clickText("Termo Stanley Classic 950ml")) {
    enlaceOk = await page
      .waitForFunction(() => /PRECIO DE REFERENCIA/i.test(document.querySelector("#mercado")?.textContent || ""), { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    await wait(800);
  }
  if (enlaceOk) {
    for (const w of widths) {
      await page.setViewport(viewport(w));
      await wait(350);
      estados["por enlace"][w] = await page.evaluate(measure);
      if (SHOT_WIDTHS.includes(w)) await page.screenshot({ path: `${OUT}/capturas/responsive-${tag}-enlace-${w}.png`, fullPage: true });
    }
  }
  await page.close();
}

await runPass(WIDTHS.filter((w) => w < 500), true);
await runPass(WIDTHS.filter((w) => w >= 500), false);
await Promise.race([browser.close(), wait(5000)]);

const resumen = WIDTHS.map((w) => {
  const fila = { ancho: w };
  for (const [nombre, porAncho] of Object.entries(estados)) {
    const m = porAncho[w];
    fila[nombre] = m ? `${m.paginaDesborda ? "página desborda · " : ""}${m.hallazgos.length} elementos` : "sin datos";
  }
  return fila;
});
writeFileSync(`${OUT}/responsive-${tag}.json`, JSON.stringify({ fecha: new Date().toISOString(), url, radarItems, enlaceOk, resumen, estados }, null, 2));
console.log(`publicaciones del radar: ${radarItems} · análisis por enlace: ${enlaceOk ? "ok" : "no cargó"}`);
console.table(resumen);
process.exit(0);
