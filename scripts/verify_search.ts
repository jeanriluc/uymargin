// Confiabilidad del dato de mercado (Radar y Lote). Sin red: solo lógica sobre listas de precios.
import { assessMarketData, RELIABILITY_LABELS, RELIABILITY_RULES } from "../src/lib/mlu/reliability";
import { computeMarketStats } from "../src/lib/mlu/statistics";

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

console.log("--- Confiabilidad del dato de mercado ---");
assert(
  RELIABILITY_LABELS.solid === "Dato sólido" && RELIABILITY_LABELS.weak === "Dato flojo" && RELIABILITY_LABELS.few === "Pocas muestras",
  "Etiquetas: Dato sólido, Dato flojo, Pocas muestras"
);
assert(assessMarketData([]) === null && assessMarketData([0, -5, Number.NaN]) === null, "Sin precios válidos no hay evaluación (ni NaN)");

const solid = assessMarketData([2000, 2100, 2200, 2290, 2400, 2500])!;
assert(solid.level === "solid" && solid.reasons.length === 0 && solid.farCount === 0, "Seis precios parecidos: Dato sólido, sin motivos");
assert(solid.p25 <= solid.median && solid.median <= solid.p75 && solid.p25 === 2125 && solid.p75 === 2372.5, "p25 y p75 rodean a la mediana (2.125 y 2.372,5)");

const one = assessMarketData([2290])!;
const two = assessMarketData([2290, 2400])!;
assert(one.level === "few" && one.reasons[0] === "hay un solo precio" && one.p25 === 2290 && one.p75 === 2290, "Un solo precio: Pocas muestras");
assert(two.level === "few" && two.reasons[0] === "hay solo 2 precios", "Dos precios: Pocas muestras");

const three = assessMarketData([2200, 2290, 2400])!;
assert(three.level === "weak" && three.reasons.join() === "hay solo 3 precios", `Tres precios parecidos: Dato flojo (hace falta ${RELIABILITY_RULES.solidSamples} para sólido)`);
assert(assessMarketData([2200, 2250, 2290, 2350, 2400])!.level === "solid", "Cinco precios parecidos: ya es Dato sólido");

const spread = assessMarketData([1000, 1200, 2000, 2600, 3000, 3200])!;
assert(spread.level === "weak" && spread.reasons.includes("los precios están muy dispersos") && spread.spread > RELIABILITY_RULES.solidSpread, "Precios muy dispersos: Dato flojo, con el motivo");

const outlier = assessMarketData([2000, 2100, 2200, 2290, 2400, 2500, 9500])!;
assert(outlier.level === "weak" && outlier.farCount === 1 && outlier.reasons.includes("hay 1 precio muy fuera de rango"), "Un precio a más de 3 veces la mediana: se avisa «hay 1 precio muy fuera de rango»");
const twoOutliers = assessMarketData([150, 2000, 2100, 2200, 2290, 2400, 2500, 9500])!;
assert(twoOutliers.farCount === 2 && twoOutliers.reasons.includes("hay 2 precios muy fuera de rango"), "Dos precios fuera de rango: «hay 2 precios muy fuera de rango»");

const mixed = assessMarketData([2000, 2100, 2200, 2290, 2400, 2500], 2)!;
assert(mixed.level === "weak" && mixed.usedCount === 2 && mixed.reasons.join() === "hay 2 usados mezclados con nuevos", "Nuevos y usados mezclados: Dato flojo, con el motivo");
assert(assessMarketData([2000, 2100, 2200, 2290, 2400, 2500], 6)!.level === "solid", "Todos usados (no hay mezcla): no baja la confiabilidad");
assert(solid.usedCount === 0 && assessMarketData([2000, 2100], 9)!.usedCount === 2, "Sin usados no cambia nada; la cantidad de usados nunca supera a la de precios");

// No excluye nada ni cambia la mediana que usa la app.
const prices = [150, 2000, 2100, 2200, 2290, 2400, 2500, 9500];
const appStats = computeMarketStats(prices, { excludeOutliers: false })!;
assert(
  twoOutliers.sampleSize === prices.length && twoOutliers.median === appStats.median && twoOutliers.sampleSize === appStats.sampleSize,
  "La evaluación cuenta todos los precios y su mediana es la misma que la del Radar"
);
const frozen = Object.freeze([3000, 1000, 2000]) as number[];
assessMarketData(frozen);
assert(frozen.join() === "3000,1000,2000", "No modifica ni reordena la lista que recibe");
assert(assessMarketData([2290, 0, Number.NaN, -3, 2400])!.sampleSize === 2, "Ignora precios inválidos (cero, negativos, NaN)");

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos de confiabilidad del dato de mercado`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
