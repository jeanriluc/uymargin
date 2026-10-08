// Casos dorados del motor financiero, sin red ni Supabase.
// Es la sección 1 de verify_all.ts sin modificar; se puede correr todas las veces que haga falta.
import { computeUnitCosts, analyzeAll, analyzeChannel } from "../src/lib/finance/engine";
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

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos dorados del motor financiero`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
