// Medición de alineación y distribución en anchos de tablet y escritorio. Solo lee.
// Uso: node scripts/layout-check.mjs <etiqueta> [url]   →  docs/audit/layout-<etiqueta>.json
// Requiere la app corriendo (por defecto http://localhost:3001) y Google Chrome instalado.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const tag = process.argv[2] || "medicion";
const url = process.argv[3] || "http://localhost:3001";
const WIDTHS = [600, 640, 700, 768, 820, 900, 960, 1024, 1100, 1180, 1280];
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "docs/audit";
mkdirSync(OUT, { recursive: true });

/** Corre en la página. Devuelve los grupos de tarjetas hermanas y los problemas de ese ancho. */
function measure() {
  const main = document.querySelector("main");
  const drawsBox = (el) => {
    const cs = getComputedStyle(el);
    const border = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0);
    const bg = cs.backgroundColor;
    return border || (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg));
  };
  const text = (el) => (el.getAttribute("aria-label") || el.querySelector("h1,h2,h3,h4")?.textContent || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34);
  const zone = (el) => {
    const s = el.closest("section, article, nav");
    return (s?.getAttribute("aria-label") || s?.querySelector("h2,h3")?.textContent || "página").trim().replace(/\s+/g, " ").slice(0, 34);
  };
  const isCard = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 110 && r.height >= 56 && drawsBox(el) && getComputedStyle(el).position !== "absolute";
  };

  const problemas = [];
  const grupos = [];
  let n = 0;
  for (const parent of main.querySelectorAll("*")) {
    const cs = getComputedStyle(parent);
    const isGrid = cs.display === "grid" || cs.display === "inline-grid";
    const isFlexRow = (cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection.startsWith("row");
    if (!isGrid && !isFlexRow) continue;
    const cards = [...parent.children].filter(isCard);
    if (cards.length < 2) continue;
    const key = `${zone(parent)} › ${text(cards[0])}`.slice(0, 70) + ` #${n++}`;

    // Filas: tarjetas cuyos rangos verticales se solapan en más de la mitad.
    const rects = cards.map((el) => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    const rows = [];
    for (const item of rects) {
      const row = rows.find((row) => {
        const a = row[0].r;
        const overlap = Math.min(a.bottom, item.r.bottom) - Math.max(a.top, item.r.top);
        return overlap > 0.5 * Math.min(a.height, item.r.height);
      });
      if (row) row.push(item);
      else rows.push([item]);
    }
    const perRow = rows.map((row) => row.length);
    const cols = Math.max(...perRow);
    const colWidth = Math.round(rows[0][0].r.width);
    grupos.push({ key, tarjetas: cards.length, columnas: cols, anchoColumna: colWidth, filas: perRow });

    for (const row of rows) {
      if (row.length < 2) continue;
      const tops = row.map((i) => i.r.top);
      const heights = row.map((i) => i.r.height);
      const dTop = Math.round(Math.max(...tops) - Math.min(...tops));
      const dH = Math.round(Math.max(...heights) - Math.min(...heights));
      const who = row.map((i) => text(i.el).slice(0, 22)).join(" | ");
      if (dTop > 4) problemas.push({ tipo: "tops desalineados en la misma fila", px: dTop, grupo: key, detalle: who });
      if (dH > 8) problemas.push({ tipo: "alturas dispares entre tarjetas hermanas", px: dH, grupo: key, detalle: who });
    }
    // Última fila incompleta que deja un hueco (distribución dispareja).
    if (rows.length > 1 && perRow[perRow.length - 1] < cols) {
      const last = rows[rows.length - 1];
      const stretched = last.length === 1 && last[0].r.width > colWidth * 1.5;
      if (!stretched) problemas.push({ tipo: "última fila incompleta", px: cols - perRow[perRow.length - 1], grupo: key, detalle: `filas de ${perRow.join(" + ")}` });
    }
  }

  // Bloques internos de tarjetas vecinas que deberían arrancar a la misma altura (tarjetas de canal).
  // Se compara bloque por bloque, en orden: encabezado, ajustes, ganancia, indicadores, chips, cascada, auditoría.
  const articles = [...main.querySelectorAll("article")];
  if (articles.length === 2 && Math.abs(articles[0].getBoundingClientRect().top - articles[1].getBoundingClientRect().top) < 4) {
    const blocks = (a) => {
      const visible = (el) => [...el.children].filter((c) => c.getBoundingClientRect().height > 2);
      const own = visible(a);
      return own.length >= 5 ? own : visible(own[own.length - 1]);
    };
    const [b0, b1] = articles.map(blocks);
    const names = ["encabezado", "ajustes del canal", "ganancia neta", "indicadores", "chips", "cascada", "auditoría"];
    b0.forEach((el, i) => {
      if (!b1[i]) return;
      const d = Math.round(Math.abs(el.getBoundingClientRect().top - b1[i].getBoundingClientRect().top));
      if (d > 4) problemas.push({ tipo: "bloques internos corridos entre tarjetas vecinas", px: d, grupo: "Comparación por canal › ML vs Tienda", detalle: names[i] ?? `bloque ${i}` });
    });
  }

  // Contenido que no entra en su caja.
  const seen = new Set();
  for (const el of main.querySelectorAll("button, span, p, h2, h3, h4, label, a, div")) {
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "auto" || cs.overflowX === "scroll" || el.classList.contains("tap-inline") || el.closest(".visually-hidden")) continue;
    if (cs.overflowX === "visible" && cs.display === "inline") continue;
    const intended = cs.textOverflow === "ellipsis" || /line-clamp/.test(el.className);
    const k = `${zone(el)}|${text(el)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    problemas.push({ tipo: intended ? "texto truncado con puntos suspensivos" : "contenido más ancho que su caja", px: el.scrollWidth - el.clientWidth, grupo: zone(el), detalle: text(el) });
  }

  const de = document.documentElement;
  return { paginaDesborda: de.scrollWidth > de.clientWidth, grupos, problemas };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 90000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(url, { waitUntil: "networkidle2" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle2" });

// Estado: calculadora completa en Régimen General (panel de costo más alto), ticket bajo (packs abiertos),
// nombre largo y radar con publicaciones reales.
await page.type("#wholesale-cost", "12");
await page.type("#sale-price", "990");
await page.type("#product-name", "Olla a presión eléctrica 5 L · Proveedor Montevideo Centro");
await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => /Régimen General/.test(l.textContent))?.click());
await page.type("#mlu-search-input", "olla presion electrica");
await page.keyboard.press("Enter");
await page.waitForFunction(() => /Publicaciones Reales/i.test(document.querySelector("#mercado")?.textContent || ""), { timeout: 40000 }).catch(() => {});
await wait(900);
const radarItems = await page.evaluate(() => [...document.querySelectorAll("#mercado button")].filter((b) => b.textContent.trim() === "Simular").length);

const porAncho = {};
for (const w of WIDTHS) {
  await page.setViewport({ width: w, height: 900 });
  await wait(400);
  porAncho[w] = await page.evaluate(measure);
}
await Promise.race([browser.close(), wait(5000)]);

// Columnas que se angostan al agrandar la ventana sin sumar columnas: el breakpoint mira la
// ventana y no el ancho real del panel (por ejemplo, cuando el panel pasa a ocupar media página).
const byKey = {};
for (const w of WIDTHS) for (const g of porAncho[w].grupos) (byKey[g.key.replace(/ #\d+$/, "")] ||= []).push({ w, ...g });
for (const [key, serie] of Object.entries(byKey)) {
  for (let i = 1; i < serie.length; i++) {
    const a = serie[i - 1];
    const b = serie[i];
    // Mismas columnas (o menos) pero cada una mucho más angosta: la grilla no acompañó a su panel.
    if (b.anchoColumna < a.anchoColumna * 0.8 && b.columnas <= a.columnas) {
      porAncho[b.w].problemas.push({
        tipo: "columna más angosta al agrandar la ventana",
        px: a.anchoColumna - b.anchoColumna,
        grupo: key,
        detalle: `${a.w}px: ${a.columnas} col de ${a.anchoColumna}px → ${b.w}px: ${b.columnas} col de ${b.anchoColumna}px`,
      });
    }
  }
}

const GRAVES = ["tops desalineados en la misma fila", "alturas dispares entre tarjetas hermanas", "bloques internos corridos entre tarjetas vecinas", "contenido más ancho que su caja", "columna más angosta al agrandar la ventana"];
const resumen = WIDTHS.map((w) => {
  const p = porAncho[w].problemas;
  return {
    ancho: w,
    alineación: p.filter((x) => GRAVES.includes(x.tipo)).length,
    "filas incompletas": p.filter((x) => x.tipo === "última fila incompleta").length,
    truncados: p.filter((x) => x.tipo === "texto truncado con puntos suspensivos").length,
    "desborde de página": porAncho[w].paginaDesborda ? "sí" : "no",
  };
});
writeFileSync(`${OUT}/layout-${tag}.json`, JSON.stringify({ fecha: new Date().toISOString(), url, radarItems, resumen, porAncho }, null, 2));
console.log(`publicaciones del radar: ${radarItems}`);
console.table(resumen);
process.exit(0);
