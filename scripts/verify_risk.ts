// Sensibilidad al dólar, escenarios y regresión del motor. Sin red ni navegador.
import { readFileSync } from "node:fs";
import { BASELINE_FILE, baselineInputs, currentBaseline } from "./engine_baseline";
import { createDirectModel, createMlModel, type ChannelModel } from "../src/lib/finance/channels";
import { createDefaultInputs, VIABILITY_THRESHOLDS } from "../src/lib/finance/constants";
import { analyzeAll, analyzeChannel, classifyViability } from "../src/lib/finance/engine";
import {
  CYBER_SCENARIO,
  DEFAULT_SCENARIOS,
  clampScenarioPct,
  runScenario,
} from "../src/lib/finance/scenarios";
import {
  BREAK_EVEN_RATE_LIMIT,
  breakEvenExchangeRate,
  dependsOnDollar,
  dollarSensitivity,
  exchangeRateForMargin,
  tightExchangeRate,
} from "../src/lib/finance/sensitivity";
import type { AnalysisInputs } from "../src/lib/finance/types";

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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const models = (i: AnalysisInputs): ChannelModel[] => [createMlModel(i.ml), createDirectModel(i.direct)];

const d = createDefaultInputs();
const general = { ...d.tax, regime: "general" as const, vatRate: 0.22 };
// Termo de U$S 26 que se vende a $U 2.290, dólar a 40,5. Congelado: si algo lo mutara, el test explota.
const usd: AnalysisInputs = deepFreeze({ ...d, cost: { amount: 26, currency: "USD" as const }, exchangeRate: 40.5, salePrice: 2290 });
const uyu: AnalysisInputs = deepFreeze({ ...usd, cost: { amount: 1053, currency: "UYU" as const } });

// -----------------------------------------------------------------
console.log("--- 1. Regresión: los resultados existentes no cambian ---");
const saved = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Array<{ name: string; hash: string }>;
const now = currentBaseline();
assert(saved.length === now.length && saved.length >= 100, `La foto del motor tiene ${saved.length} casos (regímenes, monedas, mermas, envíos)`);
const changed = now.filter((c, i) => c.name !== saved[i]?.name || c.hash !== saved[i]?.hash);
assert(
  changed.length === 0,
  changed.length === 0
    ? "Análisis de los dos canales y calculadora inversa: idénticos a la rama base en todos los casos"
    : `Cambió el resultado del motor en ${changed.length} casos, por ejemplo: ${changed[0].name}`
);
// Usar las herramientas no altera lo que devuelve el motor para las mismas entradas.
const beforeTools = JSON.stringify(analyzeAll(usd));
for (const model of models(usd)) {
  dollarSensitivity(model, usd);
  breakEvenExchangeRate(model, usd);
  tightExchangeRate(model, usd);
  runScenario(model, usd, DEFAULT_SCENARIOS.pessimistic);
}
assert(JSON.stringify(analyzeAll(usd)) === beforeTools, "Después de usar las herramientas, el análisis da exactamente lo mismo (no mutan las entradas)");

// -----------------------------------------------------------------
console.log("--- 2. Sensibilidad al dólar ---");
for (const model of models(usd)) {
  const rows = dollarSensitivity(model, usd);
  const base = analyzeChannel(model, usd);
  assert(rows.map((r) => r.deltaPct).join() === "-10,-5,0,5,10", `${model.id}: cinco filas (−10%, −5%, actual, +5%, +10%)`);
  const today = rows[2];
  assert(
    today.exchangeRate === 40.5 && today.netProfit === base.netProfit && today.netMargin === base.netMargin && today.roi === base.roi && today.viability === base.viability,
    `${model.id}: la fila «actual» es exactamente el resultado de hoy`
  );
  assert(Math.abs(rows[0].exchangeRate - 36.45) < 1e-9 && Math.abs(rows[4].exchangeRate - 44.55) < 1e-9, `${model.id}: −10% es 36,45 y +10% es 44,55`);
  assert(rows.every((r, i) => i === 0 || r.netProfit < rows[i - 1].netProfit), `${model.id}: más dólar, menos ganancia`);
  assert(rows.every((r) => r.viability === classifyViability(r.netProfit, r.netMargin, r.roi)), `${model.id}: el semáforo de cada fila es el de la app`);
}
const uyuRows = dollarSensitivity(createMlModel(uyu.ml), uyu);
assert(uyuRows.every((r) => r.netProfit === uyuRows[0].netProfit) && !dependsOnDollar(uyu), "Con costo en pesos, el dólar no mueve el resultado");
assert(
  dollarSensitivity(createMlModel(usd.ml), { ...usd, exchangeRate: 0 }).length === 0 &&
    dollarSensitivity(createMlModel(usd.ml), { ...usd, exchangeRate: Number.NaN }).length === 0,
  "Sin cotización no hay tabla (ni NaN)"
);

// -----------------------------------------------------------------
console.log("--- 3. Dólar de quiebre ---");
const roundTripCases: Array<[string, AnalysisInputs]> = [
  ["Literal E", usd],
  ["Régimen general con IVA crédito", { ...usd, tax: general }],
  ["Régimen general sin IVA crédito", { ...usd, tax: { ...general, costIncludesVat: false } }],
  ["Régimen general con IRAE", { ...usd, tax: { ...general, provisionIrae: true } }],
  ["Con mermas, devoluciones y flete en USD", { ...usd, freight: { amount: 1.5, currency: "USD" }, returnRatePct: 4, shrinkageRatePct: 2 }],
  ["Costo en pesos y flete en dólares", { ...uyu, freight: { amount: 15, currency: "USD" } }],
];
for (const [name, inputs] of roundTripCases) {
  for (const model of models(inputs)) {
    const be = breakEvenExchangeRate(model, inputs);
    const tag = `${name} · ${model.id}`;
    if (be.rate === null || be.deltaPct === null) {
      assert(false, `${tag}: se esperaba un dólar de quiebre (motivo: ${be.reason})`);
      continue;
    }
    const at = analyzeChannel(model, { ...inputs, exchangeRate: be.rate });
    assert(
      !be.alreadyBelow && be.rate > inputs.exchangeRate && be.deltaPct > 0 && Math.abs(be.deltaPct - (be.rate / inputs.exchangeRate - 1) * 100) < 1e-9,
      `${tag}: quiebra a ${be.rate.toFixed(2)} (+${be.deltaPct.toFixed(1)}% sobre el dólar actual)`
    );
    assert(at.netProfit >= 0 && at.netProfit < 0.01, `${tag}: con el dólar de quiebre la ganancia es ≈ 0 ($U ${at.netProfit.toFixed(6)})`);
    assert(analyzeChannel(model, { ...inputs, exchangeRate: be.rate + 0.01 }).netProfit < 0, `${tag}: un centésimo más de dólar y ya pierde`);
  }
}
const mlModel = createMlModel(usd.ml);
const uyuBreak = breakEvenExchangeRate(mlModel, uyu);
assert(uyuBreak.rate === null && uyuBreak.deltaPct === null && uyuBreak.reason === "cost_in_uyu", "Costo en pesos: no hay dólar de quiebre, motivo «el costo está en pesos»");

const losing: AnalysisInputs = { ...usd, cost: { amount: 60, currency: "USD" } };
const losingBreak = breakEvenExchangeRate(mlModel, losing);
assert(analyzeChannel(mlModel, losing).netProfit < 0, "Caso «ya pierde»: al dólar actual hay pérdida");
assert(
  losingBreak.alreadyBelow && losingBreak.rate !== null && losingBreak.rate < losing.exchangeRate && losingBreak.deltaPct! < 0 && losingBreak.reason === null,
  `Ya pierde plata al dólar actual: quiebra a ${losingBreak.rate?.toFixed(2)} (${losingBreak.deltaPct?.toFixed(1)}%)`
);
assert(Math.abs(analyzeChannel(mlModel, { ...losing, exchangeRate: losingBreak.rate! }).netProfit) < 0.01, "Ya pierde: con ese dólar más bajo la ganancia es ≈ 0");

const cheap: AnalysisInputs = { ...usd, cost: { amount: 2, currency: "USD" } };
const cheapBreak = breakEvenExchangeRate(mlModel, cheap);
assert(
  cheapBreak.rate === null && !cheapBreak.alreadyBelow && cheapBreak.reason === "never_within_limit" &&
    analyzeChannel(mlModel, { ...cheap, exchangeRate: cheap.exchangeRate * BREAK_EVEN_RATE_LIMIT }).netProfit > 0,
  `No quiebra aunque el dólar se multiplique por ${BREAK_EVEN_RATE_LIMIT}: sin dólar de quiebre, con motivo`
);
const pesoHeavy: AnalysisInputs = { ...usd, cost: { amount: 1, currency: "USD" }, freight: { amount: 2600, currency: "UYU" } };
const pesoHeavyBreak = breakEvenExchangeRate(mlModel, pesoHeavy);
assert(pesoHeavyBreak.rate === null && pesoHeavyBreak.alreadyBelow && pesoHeavyBreak.reason === "below_at_any_rate", "Pierde aunque el dólar valga cero (los costos en pesos solos ya superan el precio): sin dólar de quiebre, con motivo");

for (const [label, rate] of [["0", 0], ["faltante (NaN)", Number.NaN], ["negativa", -5]] as const) {
  const r = breakEvenExchangeRate(mlModel, { ...usd, exchangeRate: rate });
  assert(r.rate === null && r.deltaPct === null && r.reason === "no_rate", `Cotización ${label}: sin dólar de quiebre, motivo «falta la cotización»`);
}
assert(breakEvenExchangeRate(mlModel, { ...usd, salePrice: 0 }).reason === "no_price", "Sin precio de venta: motivo «falta el precio»");
assert(breakEvenExchangeRate(mlModel, { ...usd, cost: { amount: 0, currency: "USD" } }).reason === "no_cost", "Con costo 0: motivo «falta el costo»");

const tight = tightExchangeRate(mlModel, usd);
const atTight = tight.rate === null ? null : analyzeChannel(mlModel, { ...usd, exchangeRate: tight.rate });
const breakEven = breakEvenExchangeRate(mlModel, usd);
assert(
  tight.rate !== null && atTight !== null && Math.abs(atTight.netMargin - VIABILITY_THRESHOLDS.goodMargin) < 1e-6 && atTight.netMargin >= VIABILITY_THRESHOLDS.goodMargin,
  `Dólar al que baja de Bueno a Ajustado: ${tight.rate?.toFixed(2)} (margen ${atTight?.netMargin.toFixed(4)}%)`
);
assert(tight.rate !== null && breakEven.rate !== null && tight.rate > usd.exchangeRate && tight.rate < breakEven.rate, "Ese dólar queda entre el actual y el de quiebre");
assert(
  tight.rate !== null && analyzeChannel(mlModel, { ...usd, exchangeRate: tight.rate + 0.01 }).viability === "tight",
  "Un centésimo por encima, el semáforo ya dice Ajustado"
);
const alreadyTight: AnalysisInputs = { ...usd, cost: { amount: 45, currency: "USD" } };
assert(tightExchangeRate(mlModel, alreadyTight).alreadyBelow && analyzeChannel(mlModel, alreadyTight).netMargin < 15, "Si ya está por debajo de 15%, se informa como ya superado");
assert(exchangeRateForMargin(mlModel, usd, 0).rate === breakEven.rate, "El dólar de quiebre es el caso de margen 0");

// -----------------------------------------------------------------
console.log("--- 4. Fuzz: 250 casos aleatorios (semilla fija) ---");
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261009);
const between = (min: number, max: number) => min + rnd() * (max - min);
const pick = <T,>(options: readonly T[]): T => options[Math.floor(rnd() * options.length)];
let monotonic = 0;
let roundTrips = 0;
let roundTripOk = 0;
let consistent = 0;
const FUZZ = 250;
for (let i = 0; i < FUZZ; i++) {
  const inputs: AnalysisInputs = {
    ...d,
    cost: { amount: between(1, 80), currency: "USD" },
    freight: { amount: between(0, 4), currency: pick(["USD", "UYU"] as const) },
    exchangeRate: between(30, 60),
    salePrice: Math.round(between(300, 9000)),
    returnRatePct: pick([0, 2, 5]),
    shrinkageRatePct: pick([0, 1, 3]),
    tax: {
      regime: pick(["literal_e", "general"] as const),
      costIncludesVat: rnd() < 0.5,
      feesInvoicedWithRut: rnd() < 0.5,
      provisionIrae: rnd() < 0.5,
      iraeRate: 0.25,
      vatRate: pick([0.22, 0.1, 0]),
    },
    ml: { ...d.ml, listingType: pick(["classic", "premium"] as const), shippingMode: pick(["buyer", "seller"] as const) },
    direct: { ...d.direct, gateway: pick(["mercadopago", "handy", "transfer"] as const), shippingMode: pick(["buyer", "seller"] as const) },
  };
  const model = pick(models(inputs));
  const rates = [0.5, 0.9, 1, 1.1, 1.6, 2.4].map((k) => inputs.exchangeRate * k);
  const profits = rates.map((exchangeRate) => analyzeChannel(model, { ...inputs, exchangeRate }).netProfit);
  if (profits.every((p, k) => k === 0 || p < profits[k - 1])) monotonic++;

  const be = breakEvenExchangeRate(model, inputs);
  const nowProfit = analyzeChannel(model, inputs).netProfit;
  if (be.alreadyBelow === !(nowProfit > 0) && (be.rate === null) === (be.reason !== null)) consistent++;
  if (be.rate !== null) {
    roundTrips++;
    const at = analyzeChannel(model, { ...inputs, exchangeRate: be.rate }).netProfit;
    const above = analyzeChannel(model, { ...inputs, exchangeRate: be.rate * 1.0001 }).netProfit;
    if (at >= 0 && at < 0.01 && above < 0 && (be.rate > inputs.exchangeRate) === nowProfit > 0) roundTripOk++;
  }
}
assert(monotonic === FUZZ, `Monotonía: en ${monotonic}/${FUZZ} casos, más dólar siempre da menos ganancia`);
assert(consistent === FUZZ, `En ${consistent}/${FUZZ} casos el resultado es coherente (hay dólar de quiebre o hay motivo; «ya pierde» coincide con la ganancia actual)`);
assert(roundTrips > 100 && roundTripOk === roundTrips, `Ida y vuelta: en ${roundTripOk}/${roundTrips} casos con dólar de quiebre la ganancia ahí es ≈ 0 y apenas por encima es negativa`);

// -----------------------------------------------------------------
console.log("--- 5. Escenarios ---");
let baseIdentical = 0;
const baseCases = baselineInputs();
for (const c of baseCases) {
  if (models(c.inputs).every((model) => same(runScenario(model, c.inputs, DEFAULT_SCENARIOS.base).result, analyzeChannel(model, c.inputs)))) baseIdentical++;
}
assert(baseIdentical === baseCases.length, `Escenario Base: idéntico al resultado actual en ${baseIdentical}/${baseCases.length} casos (los dos canales)`);

const sellerShip: AnalysisInputs = deepFreeze({ ...usd, ml: { ...usd.ml, shippingMode: "seller" as const }, tax: general });
const mlSeller = createMlModel(sellerShip.ml);
const pess = runScenario(mlSeller, sellerShip, DEFAULT_SCENARIOS.pessimistic);
assert(
  Math.abs(pess.salePrice - 2061) < 1e-9 && Math.abs(pess.exchangeRate - 44.55) < 1e-9 && Math.abs(pess.shipping - 252) < 1e-9,
  "Pesimista: precio −10% (2.061), dólar +10% (44,55), envío +20% (252)"
);
const byHand = analyzeChannel(createMlModel({ ...sellerShip.ml, sellerShippingCost: 252 }), { ...sellerShip, salePrice: 2061, exchangeRate: 44.55 });
assert(Math.abs(pess.result.netProfit - byHand.netProfit) < 1e-6 && pess.result.viability === byHand.viability, "Pesimista: da lo mismo que cargar esos valores a mano en la calculadora");
const opt = runScenario(mlSeller, sellerShip, DEFAULT_SCENARIOS.optimistic);
const baseRun = runScenario(mlSeller, sellerShip, DEFAULT_SCENARIOS.base);
assert(pess.result.netProfit < baseRun.result.netProfit && baseRun.result.netProfit < opt.result.netProfit, "Pesimista < Base < Optimista en ganancia");
assert(Math.abs(opt.salePrice - 2290 * 1.05) < 1e-9 && Math.abs(opt.exchangeRate - 40.5 * 0.95) < 1e-9 && opt.shipping === 210, "Optimista: precio +5%, dólar −5%, envío igual");
const cyber = runScenario(mlSeller, sellerShip, CYBER_SCENARIO);
assert(Math.abs(cyber.salePrice - 1832) < 1e-9 && cyber.exchangeRate === 40.5 && cyber.shipping === 210, "Ciberlunes: precio −20% (1.832), el resto igual");
assert(
  cyber.result.viability === classifyViability(cyber.result.netProfit, cyber.result.netMargin, cyber.result.roi),
  `Ciberlunes: el semáforo es el de la app (${cyber.result.viability}, margen ${cyber.result.netMargin.toFixed(1)}%)`
);
const buyerPays = createMlModel(usd.ml);
assert(
  buyerPays.shipping === 0 && runScenario(buyerPays, usd, { priceDeltaPct: 0, exchangeDeltaPct: 0, shippingDeltaPct: 100 }).result.netProfit === analyzeChannel(buyerPays, usd).netProfit,
  "Si el envío lo paga el comprador, subir el envío no cambia nada"
);
assert(mlSeller.shipping === 210 && sellerShip.salePrice === 2290 && sellerShip.exchangeRate === 40.5, "Los escenarios no modifican las entradas ni el modelo del canal");
for (const literal of [usd, { ...usd, tax: general }]) {
  const m = createDirectModel(literal.direct);
  const r = runScenario(m, literal, DEFAULT_SCENARIOS.pessimistic);
  assert(r.result.netProfit < analyzeChannel(m, literal).netProfit, `Venta directa, ${literal.tax.regime === "literal_e" ? "Literal E" : "régimen general"}: el pesimista rinde menos que el actual`);
}
assert(
  clampScenarioPct(-80) === -50 && clampScenarioPct(250) === 100 && clampScenarioPct(12.5) === 12.5 && clampScenarioPct(Number.NaN) === 0 && clampScenarioPct(Infinity) === 0,
  "Los porcentajes se limitan a −50 … +100; lo que no es número cuenta como 0"
);

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos de sensibilidad, escenarios y regresión`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
