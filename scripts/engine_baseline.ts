// Foto de los resultados del motor para un conjunto fijo de entradas.
// La usa scripts/verify_risk.ts para comprobar que agregar herramientas no cambia ningún número existente.
// El archivo scripts/fixtures/engine_baseline.json se generó en main ANTES de la ronda 8.
// Regenerarlo (UPDATE_BASELINE=1 npx tsx scripts/engine_baseline.ts) solo si un cambio del motor es intencional.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { analyzeAll, solveMaxMerchandiseCostAll } from "../src/lib/finance/engine";
import { createDefaultInputs } from "../src/lib/finance/constants";
import type { AnalysisInputs } from "../src/lib/finance/types";

export const BASELINE_FILE = new URL("./fixtures/engine_baseline.json", import.meta.url);

export function baselineInputs(): Array<{ name: string; inputs: AnalysisInputs }> {
  const d = createDefaultInputs();
  const general = { ...d.tax, regime: "general" as const, vatRate: 0.22 };
  const taxes = {
    literalE: d.tax,
    general,
    generalSinCredito: { ...general, costIncludesVat: false },
    generalSinRut: { ...general, feesInvoicedWithRut: false, vatRate: 0.1 },
    generalIrae: { ...general, provisionIrae: true },
    generalExento: { ...general, vatRate: 0 },
  };
  const products = [
    { cost: { amount: 26, currency: "USD" as const }, salePrice: 2290, exchangeRate: 40.5 },
    { cost: { amount: 5, currency: "USD" as const }, salePrice: 450, exchangeRate: 40 },
    { cost: { amount: 1750, currency: "UYU" as const }, salePrice: 3190, exchangeRate: 41.25 },
    { cost: { amount: 60, currency: "USD" as const }, salePrice: 2000, exchangeRate: 39.8 },
    { cost: { amount: 900, currency: "UYU" as const }, salePrice: 1199, exchangeRate: 40 },
    { cost: { amount: 12, currency: "USD" as const }, salePrice: 0, exchangeRate: 40 },
  ];
  const extras: Array<{ tag: string; patch: Partial<AnalysisInputs> }> = [
    { tag: "simple", patch: {} },
    {
      tag: "riesgos",
      patch: { freight: { amount: 120, currency: "UYU" }, returnRatePct: 4, shrinkageRatePct: 2, stockTurnoverDays: 45 },
    },
    {
      tag: "premium-envio-vendedor-flete-usd",
      patch: {
        freight: { amount: 1.5, currency: "USD" },
        ml: { ...d.ml, listingType: "premium", shippingMode: "seller" },
        direct: { ...d.direct, gateway: "handy", shippingMode: "buyer" },
      },
    },
  ];
  const cases: Array<{ name: string; inputs: AnalysisInputs }> = [];
  for (const [taxName, tax] of Object.entries(taxes)) {
    products.forEach((product, i) => {
      for (const extra of extras) {
        cases.push({ name: `${taxName} · producto ${i + 1} · ${extra.tag}`, inputs: { ...d, ...product, tax, ...extra.patch } });
      }
    });
  }
  return cases;
}

/** Todo lo que hoy ve el usuario para una entrada: análisis de los dos canales y calculadora inversa. */
export function engineSnapshot(inputs: AnalysisInputs) {
  return {
    analysis: analyzeAll(inputs),
    maxCost: [15, 20, 25, 30].map((target) => solveMaxMerchandiseCostAll(inputs, target)),
  };
}

/**
 * Una huella (sha256) por caso del JSON completo del resultado: cualquier número que cambie, cambia la huella.
 * Además se guardan a la vista la ganancia y el margen de cada canal, para ver qué se movió.
 */
export function currentBaseline() {
  return baselineInputs().map((c) => {
    const snapshot = engineSnapshot(c.inputs);
    return {
      name: c.name,
      hash: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      mlNetProfit: snapshot.analysis.ml.netProfit,
      mlNetMargin: snapshot.analysis.ml.netMargin,
      mlViability: snapshot.analysis.ml.viability,
      directNetProfit: snapshot.analysis.direct.netProfit,
      directNetMargin: snapshot.analysis.direct.netMargin,
      directViability: snapshot.analysis.direct.viability,
    };
  });
}

if (process.env.UPDATE_BASELINE === "1") {
  writeFileSync(BASELINE_FILE, JSON.stringify(currentBaseline(), null, 1) + "\n");
  console.log(`Foto del motor guardada: ${baselineInputs().length} casos`);
}
