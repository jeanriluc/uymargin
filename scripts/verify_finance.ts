// Casos dorados del motor financiero, sin red ni Supabase.
// La sección 1 viene de verify_all.ts sin modificar; la 2 cubre la calculadora inversa.
import {
  computeUnitCosts,
  analyzeAll,
  analyzeChannel,
  solveMaxMerchandiseCost,
  solveMaxMerchandiseCostAll,
} from "../src/lib/finance/engine";
import type { AnalysisInputs, Money } from "../src/lib/finance/types";
import { createMlModel, createDirectModel } from "../src/lib/finance/channels";
import { computeTaxes, vatIncluded } from "../src/lib/finance/dgi-taxes";
import { createDefaultInputs } from "../src/lib/finance/constants";

console.log("=================================================");
console.log("🚀 EJECUTANDO SUITE DE AUDITORÍA Y VERIFICACIÓN");
console.log("=================================================\n");

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

// -----------------------------------------------------------------
// 1. TESTS DEL MOTOR FINANCIERO (CASOS DORADOS DGI Y MERCADO LIBRE)
// -----------------------------------------------------------------
console.log("--- 1. Evaluando Casos Dorados del Motor Financiero ---");

// Caso A: Literal E vs Régimen General
const defaultInputs = createDefaultInputs();
const inputsLitE = {
  ...defaultInputs,
  productName: "Termo Stanley 950 ml",
  cost: { amount: 26, currency: "USD" as const },
  exchangeRate: 40.5,
  salePrice: 2290,
  tax: { ...defaultInputs.tax, regime: "literal_e" as const },
};
const analysisLitE = analyzeAll(inputsLitE);
assert(analysisLitE.costs.landed === 26 * 40.5, "Costo puesto en UYU calculado correctamente para USD");
assert(analysisLitE.ml.netProfit > 0, "Margen neto en MLU es positivo para Termo Stanley en Literal E");
assert(analysisLitE.ml.taxes.vatDebit === 0, "Literal E no discrimina débito fiscal de IVA");

// Caso B: Régimen General con e-factura (crédito fiscal de compra)
const inputsGeneralConRut = {
  ...inputsLitE,
  tax: {
    ...defaultInputs.tax,
    regime: "general" as const,
    costIncludesVat: true,
    feesInvoicedWithRut: true,
    vatRate: 0.22,
  },
};
const analysisGeneralConRut = analyzeAll(inputsGeneralConRut);
assert(analysisGeneralConRut.ml.taxes.vatCreditCost > 0, "Régimen General con e-factura descuenta IVA crédito de compra");

// Caso C: Régimen General SIN e-factura (sin crédito fiscal)
const inputsGeneralSinRut = {
  ...inputsGeneralConRut,
  tax: {
    ...inputsGeneralConRut.tax,
    costIncludesVat: false,
  },
};
const analysisGeneralSinRut = analyzeAll(inputsGeneralSinRut);
assert(analysisGeneralSinRut.ml.taxes.vatCreditCost === 0, "Sin e-factura el crédito fiscal de compra es estrictamente 0");
assert(
  analysisGeneralSinRut.ml.netProfit < analysisGeneralConRut.ml.netProfit,
  "Comprar sin e-factura en Régimen General reduce la ganancia neta drásticamente"
);

// Caso D: Ticket bajo (< $U 1.200) y Cargo Fijo MLU
const inputsLowTicket = {
  ...defaultInputs,
  cost: { amount: 5, currency: "USD" as const },
  exchangeRate: 40,
  salePrice: 450, // < 1200
};
const analysisLowTicket = analyzeAll(inputsLowTicket);
assert(analysisLowTicket.ml.fixedFee > 0, "Ventas de ticket menor a $U 1.200 aplican cargo fijo unitario de MLU");

// Caso E: Parámetros de Realismo Financiero (Mermas, Devoluciones, Rotación)
const inputsRealism = {
  ...defaultInputs,
  cost: { amount: 20, currency: "USD" as const },
  exchangeRate: 40,
  salePrice: 1500,
  returnRatePct: 4,
  shrinkageRatePct: 2,
  stockTurnoverDays: 45,
};
const analysisRealism = analyzeAll(inputsRealism);
assert(analysisRealism.ml.reservesCost !== undefined && analysisRealism.ml.reservesCost > 0, "Mermas y devoluciones generan reserva de contingencia descontada");
assert(analysisRealism.ml.annualizedRoi !== undefined && analysisRealism.ml.annualizedRoi > analysisRealism.ml.roi, "ROI anualizado calculado con rotación de 45 días es mayor al ROI por ciclo");

// Caso F: IVA Tasa Mínima (10%) y Exento (0%)
const inputsMinVat = {
  ...inputsGeneralConRut,
  tax: { ...inputsGeneralConRut.tax, vatRate: 0.10 },
};
const analysisMinVat = analyzeAll(inputsMinVat);
const expectedVatMin = vatIncluded(2290, 0.10);
assert(Math.abs(analysisMinVat.ml.taxes.vatDebit - expectedVatMin) < 0.1, "Tasa mínima 10% calcula débito fiscal DGI exacto");

const inputsExemptVat = {
  ...inputsGeneralConRut,
  tax: { ...inputsGeneralConRut.tax, vatRate: 0 },
};
const analysisExemptVat = analyzeAll(inputsExemptVat);
assert(analysisExemptVat.ml.taxes.vatDebit === 0, "Tasa exenta 0% calcula débito fiscal 0");

// Caso G: Bundle Optimizer y Estrategia Anti-Cargo Fijo MLU (< $U 1.200)
import { calculateBundleOptions } from "../src/lib/finance/bundles";
const bundleInputs = {
  ...defaultInputs,
  cost: { amount: 3, currency: "USD" as const },
  exchangeRate: 40,
  salePrice: 450, // Sub-1200
  productName: "Cable Carga Rápida 2m",
};
const bundleResult = calculateBundleOptions(bundleInputs);
assert(bundleResult.isEligibleForBundleBoost === true, "Producto con PVP $U 450 califica como elegible para estrategia de pack");
const pack3 = bundleResult.options.find((o) => o.quantity === 3);
assert(pack3 !== undefined && pack3.crossesThreshold === 1, "Pack x3 cruza el umbral de $U 1.200 de Mercado Libre");
assert(pack3 !== undefined && pack3.fixedFeeSavings > 0, "Pack x3 elimina el cargo fijo unitario de MLU generando ahorro directo");
assert(pack3 !== undefined && pack3.bundleAnalysis.netProfit > bundleResult.baseNetProfit * 3, "Vender Pack x3 genera mayor ganancia neta total que vender 3 unidades sueltas");

// -----------------------------------------------------------------
// Caso H: Calculadora inversa (costo máximo de mercadería para un margen neto objetivo)
// -----------------------------------------------------------------
console.log("--- 2. Calculadora inversa: costo máximo de mercadería ---");

const mlOf = (i: AnalysisInputs) => createMlModel(i.ml);
const directOf = (i: AnalysisInputs) => createDirectModel(i.direct);
const withCost = (i: AnalysisInputs, cost: Money): AnalysisInputs => ({ ...i, cost });

/** Ida y vuelta: el costo máximo, puesto en analyzeChannel, da el margen objetivo (y el redondeado nunca queda por debajo). */
function roundTrip(name: string, inputs: AnalysisInputs, target: number) {
  for (const model of [mlOf(inputs), directOf(inputs)]) {
    const tag = `${name} · ${model.id === "ml" ? "ML" : "directa"} · ${target}%`;
    const solved = solveMaxMerchandiseCost(model, inputs, target);
    if (!solved || !solved.applyCost) {
      assert(false, `${tag}: se esperaba un costo máximo`);
      continue;
    }
    const exact = analyzeChannel(model, withCost(inputs, { amount: solved.maxMerchandiseCost, currency: "UYU" }));
    assert(
      exact.netMargin >= target - 1e-6 && exact.netMargin < target + 1e-4,
      `${tag}: con el costo máximo exacto el margen neto es el objetivo (${exact.netMargin.toFixed(4)}%)`
    );
    const applied = analyzeChannel(model, withCost(inputs, solved.applyCost));
    // Un paso de redondeo (1 centavo de dólar o 1 peso) mueve el margen menos de 0,5 puntos en estos precios.
    assert(
      applied.netMargin >= target && applied.netMargin < target + 0.5,
      `${tag}: al aplicar ${solved.applyCost.currency} ${solved.applyCost.amount} el margen queda en ${applied.netMargin.toFixed(3)}% (>= objetivo y cerca)`
    );
    const step = solved.applyCost.currency === "USD" ? 0.01 : 1;
    const oneMore = analyzeChannel(model, withCost(inputs, { ...solved.applyCost, amount: solved.applyCost.amount + step }));
    assert(oneMore.netMargin < target, `${tag}: un ${solved.applyCost.currency === "USD" ? "centavo" : "peso"} más ya queda por debajo del objetivo`);
    assert(
      Math.abs(solved.maxLandedCost - (solved.maxMerchandiseCost + computeUnitCosts(inputs).freight)) < 1e-9,
      `${tag}: costo puesto máximo = mercadería + flete`
    );
  }
}

const invBase: AnalysisInputs = {
  ...defaultInputs,
  cost: { amount: 26, currency: "USD" },
  exchangeRate: 40.5,
  salePrice: 2290,
};
const generalTax = { ...defaultInputs.tax, regime: "general" as const, vatRate: 0.22 };

roundTrip("Literal E, costo en USD", invBase, 20);
roundTrip("Literal E, costo en UYU", withCost(invBase, { amount: 1000, currency: "UYU" }), 15);
roundTrip("Régimen general con IVA crédito", { ...invBase, tax: { ...generalTax, costIncludesVat: true } }, 20);
roundTrip("Régimen general sin IVA crédito", { ...invBase, tax: { ...generalTax, costIncludesVat: false } }, 15);
roundTrip(
  "Régimen general sin RUT en comisiones, IVA 10%",
  { ...invBase, tax: { ...generalTax, vatRate: 0.1, feesInvoicedWithRut: false } },
  15
);
roundTrip("Régimen general con IRAE", { ...invBase, tax: { ...generalTax, provisionIrae: true } }, 15);
roundTrip(
  "Mermas, devoluciones y flete en UYU",
  { ...invBase, freight: { amount: 120, currency: "UYU" }, returnRatePct: 4, shrinkageRatePct: 2 },
  20
);
roundTrip(
  "Régimen general con IRAE, mermas, devoluciones y flete en USD, costo en UYU",
  {
    ...invBase,
    cost: { amount: 900, currency: "UYU" },
    freight: { amount: 1.5, currency: "USD" },
    returnRatePct: 3,
    shrinkageRatePct: 1.5,
    tax: { ...generalTax, provisionIrae: true },
  },
  15
);
roundTrip("ML Premium con envío a cargo del vendedor", {
  ...invBase,
  ml: { ...invBase.ml, listingType: "premium", shippingMode: "seller" },
}, 15);

// Umbral del cargo fijo de ML: debajo del umbral se descuenta, en el umbral no.
const belowThreshold: AnalysisInputs = { ...invBase, salePrice: 1199, cost: { amount: 500, currency: "UYU" } };
const atThreshold: AnalysisInputs = { ...belowThreshold, salePrice: 1200 };
roundTrip("Ticket bajo el umbral del cargo fijo de ML", belowThreshold, 20);
roundTrip("Ticket en el umbral del cargo fijo de ML", atThreshold, 20);
const maxBelow = solveMaxMerchandiseCost(mlOf(belowThreshold), belowThreshold, 20);
const maxAt = solveMaxMerchandiseCost(mlOf(atThreshold), atThreshold, 20);
// En Literal E: costo máx = precio × (1 − comisión − margen) − cargo fijo.
assert(
  maxBelow !== null && Math.abs(maxBelow.maxMerchandiseCost - (1199 * (1 - 0.13 - 0.2) - 40)) < 0.01,
  "Bajo el umbral, el cargo fijo de ML ($U 40) baja el costo máximo"
);
assert(
  maxAt !== null && Math.abs(maxAt.maxMerchandiseCost - 1200 * (1 - 0.13 - 0.2)) < 0.01,
  "En el umbral ya no hay cargo fijo de ML"
);

// Equivalente en dólares y redondeo hacia abajo
const usdCase = solveMaxMerchandiseCost(mlOf(invBase), invBase, 20);
assert(
  usdCase !== null && usdCase.maxMerchandiseCostUsd !== null &&
    Math.abs(usdCase.maxMerchandiseCostUsd * 40.5 - usdCase.maxMerchandiseCost) < 1e-6,
  "El equivalente en USD usa la cotización cargada"
);
assert(
  usdCase !== null && usdCase.applyCost !== null && usdCase.applyCost.currency === "USD" &&
    usdCase.applyCost.amount <= usdCase.maxMerchandiseCostUsd! &&
    Math.abs(usdCase.applyCost.amount * 100 - Math.round(usdCase.applyCost.amount * 100)) < 1e-9,
  "Con costo en USD, lo que se aplica está en USD, a centavos y redondeado hacia abajo"
);
const uyuCase = solveMaxMerchandiseCost(mlOf(belowThreshold), belowThreshold, 20);
assert(
  uyuCase !== null && uyuCase.applyCost !== null && uyuCase.applyCost.currency === "UYU" &&
    Number.isInteger(uyuCase.applyCost.amount) && uyuCase.applyCost.amount <= uyuCase.maxMerchandiseCost,
  "Con costo en UYU, lo que se aplica está en pesos enteros y redondeado hacia abajo"
);

// La calculadora da un resultado por canal, con la tasa real de la pasarela
const both = solveMaxMerchandiseCostAll(invBase, 20);
assert(both.ml !== null && both.direct !== null && both.ml.channel === "ml" && both.direct.channel === "direct", "Se calcula para los dos canales");
const directFree: AnalysisInputs = { ...invBase, direct: { ...invBase.direct, shippingMode: "buyer" } };
const directSolved = solveMaxMerchandiseCost(directOf(directFree), directFree, 20);
assert(
  directSolved !== null && Math.abs(directSolved.maxMerchandiseCost - 2290 * (1 - 0.0399 * 1.22 - 0.2)) < 0.01,
  "Venta directa usa la tasa real de la pasarela (3,99% + IVA), no un 4% fijo"
);

// Objetivo inalcanzable
const unreachable: AnalysisInputs = { ...invBase, salePrice: 300, ml: { ...invBase.ml, shippingMode: "seller" } };
assert(
  solveMaxMerchandiseCost(mlOf(unreachable), unreachable, 30) === null,
  "Objetivo inalcanzable: devuelve null (ni con costo cero se llega al margen)"
);
assert(
  analyzeChannel(mlOf(unreachable), withCost(unreachable, { amount: 0, currency: "UYU" })).netMargin < 30,
  "Objetivo inalcanzable: con costo cero el margen efectivamente no llega"
);
const freightOnly: AnalysisInputs = { ...invBase, freight: { amount: 2500, currency: "UYU" } };
assert(solveMaxMerchandiseCost(mlOf(freightOnly), freightOnly, 15) === null, "Si el flete solo ya se come el margen, también devuelve null");
assert(solveMaxMerchandiseCost(mlOf({ ...invBase, salePrice: 0 }), { ...invBase, salePrice: 0 }, 20) === null, "Sin precio de venta no hay costo máximo");

// Regresión: la fórmula vieja de la tarjeta (precio − comisión − envío − margen × precio) sobrestimaba el costo
function legacyMaxLandedCost(i: AnalysisInputs, channel: "ml" | "direct", target: number): number {
  const p = i.salePrice;
  const fee = channel === "ml"
    ? p * (i.ml.listingType === "premium" ? i.ml.premiumRate : i.ml.classicRate) + (p < i.ml.fixedFeeThreshold ? i.ml.fixedFee : 0)
    : p * 0.04;
  const shipping = channel === "ml"
    ? (i.ml.shippingMode === "seller" ? i.ml.sellerShippingCost : 0)
    : (i.direct.shippingMode === "seller" ? i.direct.shippingCost : 0);
  return Math.max(0, p - fee - shipping - (target / 100) * p);
}
const regression: AnalysisInputs = { ...invBase, tax: { ...generalTax, costIncludesVat: true } };
const legacyCost = legacyMaxLandedCost(regression, "ml", 20);
const correct = solveMaxMerchandiseCost(mlOf(regression), regression, 20);
assert(
  correct !== null && legacyCost > correct.maxMerchandiseCost,
  `Regresión (régimen general): la fórmula vieja daba $U ${legacyCost.toFixed(0)} y el costo correcto es $U ${correct?.maxMerchandiseCost.toFixed(0)}`
);
const legacyApplied = analyzeChannel(mlOf(regression), withCost(regression, { amount: legacyCost, currency: "UYU" }));
assert(
  legacyApplied.netMargin < 20,
  `Regresión: aplicar el costo de la fórmula vieja dejaba el margen en ${legacyApplied.netMargin.toFixed(1)}%, debajo del 20% pedido`
);

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos dorados del motor financiero`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
