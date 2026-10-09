// Pestañas de "Precio de mercado" y exportación del Lote, sin red ni navegador.
// El comportamiento real en el navegador (el Lote sobrevive a cambiar de pestaña y a "Simular")
// lo cubre scripts/e2e_tabs.mjs, que necesita la app corriendo y Chrome.
import { readFileSync } from "node:fs";
import { SEARCH_TABS, searchPanelState, type SearchTab } from "../src/lib/searchTabs";
import {
  batchCsvRow,
  batchResultsToCsv,
  BATCH_CSV_HEADERS,
  BATCH_MAX_WAIT_SECONDS,
  mergeBatchResults,
  rateLimitDecision,
  retryTargets,
  signedUyu,
  type BatchItemResult,
} from "../src/lib/export/batchCsv";
import { createDefaultInputs } from "../src/lib/finance/constants";

let passedTests = 0;
let totalTests = 0;
function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

console.log("--- Pestañas: los paneles no se desmontan ---");

/** Lo mismo que hace App.tsx: pestaña activa + "alguna vez abierta" (useEverTrue) por panel. */
function createTabs() {
  let active: SearchTab = "keyword";
  const ever: Record<SearchTab, boolean> = { keyword: true, url: false, batch: false };
  return {
    open(tab: SearchTab) {
      active = tab;
      ever[tab] = true;
    },
    panel: (tab: SearchTab) => searchPanelState(tab, active, ever[tab]),
    visible: () => SEARCH_TABS.filter((t) => { const p = searchPanelState(t, active, ever[t]); return p.mounted && !p.hidden; }),
  };
}

const tabs = createTabs();
assert(tabs.panel("keyword").mounted && !tabs.panel("keyword").hidden, "Al entrar, el Radar está montado y visible");
assert(!tabs.panel("batch").mounted && !tabs.panel("url").mounted, "Lote y Por enlace no se cargan hasta abrirlos (siguen siendo lazy)");

tabs.open("batch");
assert(tabs.panel("batch").mounted && !tabs.panel("batch").hidden, "Al abrir Lote, se monta y se ve");
assert(tabs.panel("keyword").mounted && tabs.panel("keyword").hidden, "El Radar queda montado pero oculto");

tabs.open("keyword");
assert(tabs.panel("batch").mounted && tabs.panel("batch").hidden, "Al volver al Radar, el Lote sigue montado (conserva su estado) y oculto");
tabs.open("url");
assert(tabs.panel("batch").mounted && tabs.panel("batch").hidden, "Al pasar a Por enlace, el Lote sigue montado y oculto");
tabs.open("batch");
assert(tabs.panel("url").mounted && tabs.panel("url").hidden, "Al volver al Lote, Por enlace sigue montado (conserva URL y resultado) y oculto");
for (const tab of SEARCH_TABS) {
  tabs.open(tab);
  assert(tabs.visible().length === 1 && tabs.visible()[0] === tab, `Con «${tab}» activa hay un solo panel visible`);
}

console.log("--- App.tsx: «Simular» no cambia de pestaña ---");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const handler = (name: string) => {
  const start = app.indexOf(`${name}={(`);
  return start < 0 ? "" : app.slice(start, app.indexOf("}}", start));
};
const simulateBatch = handler("onSimulateProduct");
const simulateUrl = handler("onSimulatePrice");
assert(simulateBatch.length > 0 && !simulateBatch.includes("setSearchTab"), "«Simular» en Lote no cambia de pestaña");
assert(simulateUrl.length > 0 && !simulateUrl.includes("setSearchTab"), "«Simular» en Por enlace no cambia de pestaña");
for (const [name, body] of [["Lote", simulateBatch], ["Por enlace", simulateUrl]] as const) {
  assert(
    body.includes("updateInputs(") && body.includes('scrollToSection("resultado")') && body.includes("clearRadar()"),
    `«Simular» en ${name} carga el producto, vacía el Radar y baja al resultado`
  );
}
assert(!/searchTab === "(keyword|url|batch)" \? \(/.test(app), "Los paneles no se renderizan con un condicional que los desmonte");
assert((app.match(/aria-hidden=\{(keyword|url|batch)Panel\.hidden \|\| undefined\}/g) ?? []).length === 3, "Los tres paneles llevan aria-hidden cuando están ocultos");
const clearRadar = app.slice(app.indexOf("const clearRadar = () => {"), app.indexOf("};", app.indexOf("const clearRadar = () => {")));
for (const setter of ["setMarketState", "setStats(null)", "setMarketSource(null)", "setUnsupportedListings([])", "setExactBlock(undefined)", "setExactSelection(null)", 'setManualPrices("")']) {
  assert(clearRadar.includes(setter), `Vaciar el Radar incluye ${setter}`);
}
const tabButtons = app.match(/onClick=\{\(\) => setSearchTab\("(keyword|url|batch)"\)\}/g) ?? [];
assert(tabButtons.length === 3 && !/setSearchTab\([^)]*\);?\s*clearRadar/.test(app), "Cambiar de pestaña solo cambia la pestaña: no vacía nada");

const loadEntry = app.slice(app.indexOf("const handleLoadEntry = "), app.indexOf("window.scrollTo", app.indexOf("const handleLoadEntry = ")));
assert(
  loadEntry.includes("clearRadar()") && loadEntry.indexOf("clearRadar()") < loadEntry.indexOf("setStats(restStats)"),
  "Cargar una simulación guardada vacía el Radar y después carga las estadísticas de la entrada"
);

console.log("--- Lote: filas sin dato de mercado y signo de la ganancia ---");
const inputs = createDefaultInputs();
const priced: BatchItemResult = {
  sku: "A-1", name: 'Termo "Clásico" 1 l', cost: 10, currency: "USD", costUyu: 400, marketPriceUyu: 1000, sampleSize: 7,
  bestChannel: "ml", mlProfit: 300.4, mlMargin: 30.04, directProfit: 250, directMargin: 25, roi: 75.1, status: "excellent", analysisInputs: inputs,
};
const unpriced: BatchItemResult = {
  ...priced, sku: "B-2", name: "Sin precio", marketPriceUyu: 600, sampleSize: 0, mlProfit: -292, mlMargin: -48.7, directProfit: -310, directMargin: -51.7, roi: -73, status: "unpriced",
};
const col = (name: (typeof BATCH_CSV_HEADERS)[number]) => BATCH_CSV_HEADERS.indexOf(name);
const same14 = (x: Array<string | number>, y: Array<string | number>) => x.slice(0, 14).join("|") === y.slice(0, 14).join("|");
const pricedRow = batchCsvRow(priced);
const unpricedRow = batchCsvRow(unpriced);
assert(pricedRow.length === BATCH_CSV_HEADERS.length && unpricedRow.length === BATCH_CSV_HEADERS.length, "Cada fila del CSV tiene una celda por columna");
assert(
  pricedRow[col("Precio Mediana MLU ($U)")] === 1000 && pricedRow[col("Margen ML (%)")] === "30,0" && pricedRow[col("Ganancia ML ($U)")] === 300 &&
    pricedRow[col("Canal Ganador")] === "Mercado Libre" && pricedRow[col("Viabilidad")] === "Excelente",
  "Fila con precio: exporta precio, canal, margen, ganancia y la etiqueta del semáforo"
);
const emptyColumns = ["Precio Mediana MLU ($U)", "Canal Ganador", "Margen ML (%)", "Ganancia ML ($U)", "Margen Tienda (%)", "Ganancia Tienda ($U)", "ROI (%)"] as const;
assert(emptyColumns.every((c) => unpricedRow[col(c)] === ""), "Fila sin dato de mercado: precio, canal, márgenes, ganancias y ROI van vacíos");
assert(unpricedRow[col("Viabilidad")] === "Sin dato de mercado" && unpricedRow[col("Costo UYU")] === 400, "Fila sin dato de mercado: conserva el costo y dice «Sin dato de mercado»");
// Columnas nuevas al final: no cambian el orden ni el contenido de las anteriores.
assert(
  BATCH_CSV_HEADERS.slice(0, 14).join("|") === "SKU|Producto|Costo Original|Moneda|Costo UYU|Precio Mediana MLU ($U)|Muestras MLU|Canal Ganador|Margen ML (%)|Ganancia ML ($U)|Margen Tienda (%)|Ganancia Tienda ($U)|ROI (%)|Viabilidad" &&
    BATCH_CSV_HEADERS.slice(14).join("|") === "Dólar de quiebre ($U)|Colchón (%)|Confiabilidad del dato",
  "CSV del Lote: las 14 columnas de antes quedan igual y se agregan al final «Dólar de quiebre» y «Colchón»"
);
const withBreakEven = batchCsvRow({ ...priced, breakEvenRate: 76.634, rateCushionPct: 89.22 });
assert(
  withBreakEven[col("Dólar de quiebre ($U)")] === "76,63" && withBreakEven[col("Colchón (%)")] === "89,2" && same14(withBreakEven, pricedRow),
  "Fila con costo en dólares: exporta el dólar de quiebre y el colchón, sin tocar el resto"
);
assert(pricedRow[col("Dólar de quiebre ($U)")] === "" && pricedRow[col("Colchón (%)")] === "", "Fila sin dólar de quiebre (costo en pesos): esas dos celdas van vacías");
assert(
  batchCsvRow({ ...unpriced, breakEvenRate: 50, rateCushionPct: 20 })[col("Dólar de quiebre ($U)")] === "" && unpricedRow[col("Colchón (%)")] === "",
  "Fila sin dato de mercado: dólar de quiebre y colchón vacíos"
);
assert(
  batchCsvRow({ ...priced, reliabilityLabel: "Dato flojo" })[col("Confiabilidad del dato")] === "Dato flojo" &&
    pricedRow[col("Confiabilidad del dato")] === "" && batchCsvRow({ ...unpriced, reliabilityLabel: "Dato flojo" })[col("Confiabilidad del dato")] === "",
  "CSV del Lote: la confiabilidad del dato va en la última columna; vacía si no hay dato de mercado"
);
// Reintento y cancelación del Lote
const pricedLow: BatchItemResult = { ...priced, sku: "D-4", mlMargin: 12, status: "tight" };
const failedB: BatchItemResult = { ...unpriced, sku: "B-2", marketError: "Mercado Libre no respondió (HTTP 429)." };
const failedC: BatchItemResult = { ...unpriced, sku: "C-3", name: "Otro sin precio" };
const firstRun = mergeBatchResults([], [failedB, pricedLow, priced, failedC]);
assert(firstRun.map((r) => r.sku).join() === "A-1,D-4,B-2,C-3", "Lote: se ordena por margen y las filas sin dato van al final");
const targets = retryTargets(firstRun);
assert(
  targets.length === 2 && targets.map((t) => t.sku).join() === "B-2,C-3" && targets[0].cost === failedB.cost && targets[0].currency === failedB.currency,
  "Reintentar: solo se vuelven a consultar las filas sin dato de mercado, con su costo y moneda"
);
const recoveredB: BatchItemResult = { ...priced, sku: "B-2", mlMargin: 20, status: "good" };
const afterRetry = mergeBatchResults(firstRun, [recoveredB, failedC]);
assert(
  afterRetry.length === 4 && afterRetry.map((r) => r.sku).join() === "A-1,B-2,D-4,C-3" && afterRetry[0] === priced && afterRetry[2] === pricedLow,
  "Reintentar: la fila recuperada entra al ranking y las que ya tenían precio no se tocan"
);
const cancelledRetry = mergeBatchResults(firstRun, [recoveredB]);
assert(
  cancelledRetry.length === 4 && cancelledRetry.find((r) => r.sku === "C-3") === failedC,
  "Cancelar a mitad de un reintento: la fila que no se llegó a consultar conserva su resultado anterior"
);
assert(mergeBatchResults([], [priced]).length === 1 && retryTargets([priced, pricedLow]).length === 0, "Corrida cancelada: queda lo consultado; sin filas fallidas no hay nada para reintentar");
assert(rateLimitDecision(200, null).action === "continue" && rateLimitDecision(502, "30").action === "continue", "Límite de uso: si no es un 429, el Lote sigue normalmente");
const waitMinute = rateLimitDecision(429, "27");
assert(waitMinute.action === "wait" && waitMinute.seconds === 27, "429 con Retry-After de 27 s (tope por minuto): espera 27 s y repite la fila");
assert(rateLimitDecision(429, "65").action === "wait" && rateLimitDecision(429, "66").action === "stop" && rateLimitDecision(429, "40000").action === "stop", `429 con espera mayor a ${BATCH_MAX_WAIT_SECONDS} s (tope diario): frena el lote`);
const noHeader = rateLimitDecision(429, null);
assert(noHeader.action === "wait" && noHeader.seconds === 5 && rateLimitDecision(429, "abc").action === "wait", "429 sin Retry-After válido: espera corta de 5 s");
const batchSource = readFileSync(new URL("../src/components/search/BatchAuditor.tsx", import.meta.url), "utf8");
assert(
  batchSource.includes("if (cancelRef.current)") && batchSource.includes("handleRetryUnpriced") && batchSource.includes("mergeBatchResults(previous, batchResults)"),
  "El Lote tiene botón Cancelar y reintento de filas sin dato"
);
assert(
  batchSource.includes("if (halted && previousSkus.has(item.sku)) continue;") && batchSource.includes("marketError = NOT_CONSULTED") && !/\n\s+break;\n/.test(batchSource.slice(batchSource.indexOf("const runBatch"), batchSource.indexOf("const handleExportCsv"))),
  "Al cancelar o frenar por el límite, las filas que faltan quedan sin dato (o con su resultado anterior) y se pueden retomar"
);
const csv = batchResultsToCsv([priced, unpriced]);
assert(csv.startsWith("﻿") && csv.split("\n").length === 3 && !csv.includes("-292") && !csv.includes("−292"), "El CSV no incluye la ganancia calculada sobre el precio provisorio");
assert(signedUyu(-292) === "−$U 292", "Pérdida: «−$U 292», sin el «+» adelante");
assert(signedUyu(292) === "+$U 292" && signedUyu(0) === "$U 0", "Ganancia: «+$U 292»; cero: «$U 0»");
const batch = readFileSync(new URL("../src/components/search/BatchAuditor.tsx", import.meta.url), "utf8");
assert(!batch.includes("+{formatUyu(") && batch.includes("signedUyu(winningProfit)"), "La tabla del Lote usa el signo correcto en la ganancia del canal ganador");
assert(!batch.includes("window.scrollTo"), "«Simular» en el Lote no mueve la página por su cuenta");

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos de pestañas y Lote`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
