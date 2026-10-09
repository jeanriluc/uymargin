// Confiabilidad del dato de mercado (Radar y Lote). Sin red: solo lógica sobre listas de precios.
import { broadenQuery } from "../src/lib/mlu/broaden";
import { asBroadened, assessMarketData, broadenedReason, RELIABILITY_LABELS, RELIABILITY_RULES } from "../src/lib/mlu/reliability";
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

console.log("--- Calibración (ronda 10): rango total y pocas muestras ---");
// La olla: p75/p25 = 1,44 y nada supera 3 veces la mediana, pero el más caro vale 6,7 veces el más barato.
const olla = assessMarketData([900, 1500, 2400, 2450, 2500, 6000])!;
assert(Math.abs(olla.spread - 1.44) < 0.01 && Math.abs(olla.range - 6.67) < 0.01, "Olla: p75/p25 = 1,44 pero el rango total es de 6,7 veces");
assert(
  olla.level === "weak" && olla.reasons.includes("los precios van de $U 900 a $U 6.000"),
  `Olla: ahora es Dato flojo, con el motivo del rango (${olla.reasons.join("; ")})`
);
assert(olla.median === 2425 && olla.sampleSize === 6, "Olla: la mediana (2.425) y la cantidad de precios no cambian");
const realSolid = assessMarketData([2400, 2450, 2500, 2550, 2600, 2500])!;
assert(realSolid.level === "solid" && realSolid.reasons.length === 0 && realSolid.min === 2400 && realSolid.max === 2600, "Seis precios entre 2.400 y 2.600: Dato sólido");
// Rango justo en el umbral: 4,0 pasa, 4,1 no. (Ocho precios, para aislar la regla del rango de la de pocas muestras.)
const atLimit = assessMarketData([1000, 2000, 2000, 2000, 2000, 2000, 2000, 4000])!;
const overLimit = assessMarketData([1000, 2000, 2000, 2000, 2000, 2000, 2000, 4100])!;
assert(atLimit.range === 4 && atLimit.level === "solid", `Rango de exactamente ${RELIABILITY_RULES.maxRange} veces: sigue siendo sólido`);
assert(
  overLimit.range === 4.1 && overLimit.level === "weak" && overLimit.reasons.join() === "los precios van de $U 1.000 a $U 4.100",
  "Rango de 4,1 veces: Dato flojo, y el único motivo es el rango"
);
// Pocas muestras (5 o 6): alcanza con que un precio duplique a la mediana.
const doubled = assessMarketData([2400, 2450, 2500, 2550, 5200])!;
assert(
  doubled.level === "weak" && doubled.farCount === 1 && doubled.reasons.join() === "hay 1 precio muy fuera de rango" && doubled.range < RELIABILITY_RULES.maxRange,
  "Cinco precios y uno duplica al resto: Dato flojo (con el corte de 3 veces salía sólido)"
);
const doubledBig = assessMarketData([2400, 2450, 2500, 2500, 2500, 2550, 5200])!;
assert(doubledBig.farCount === 0 && doubledBig.level === "solid", `Con más de ${RELIABILITY_RULES.smallSampleMax} precios el corte vuelve a ser de ${RELIABILITY_RULES.farFactor} veces`);
const threeWide = assessMarketData([1000, 2000, 5000])!;
assert(threeWide.level === "weak" && threeWide.reasons.includes("hay solo 3 precios") && threeWide.reasons.includes("los precios van de $U 1.000 a $U 5.000"), "Tres precios con rango de 5 veces: Dato flojo, con los dos motivos");
const fourClose = assessMarketData([2400, 2450, 2500, 2550])!;
assert(fourClose.level === "weak" && fourClose.reasons.join() === "hay solo 4 precios", "Cuatro precios parecidos: Dato flojo solo por la cantidad");
const single = assessMarketData([2500])!;
assert(single.level === "few" && single.range === 1 && single.reasons.join() === "hay un solo precio", "Un solo precio: Pocas muestras, sin motivo de rango");
const twoWide = assessMarketData([500, 5000])!;
assert(twoWide.level === "few" && twoWide.reasons.includes("los precios van de $U 500 a $U 5.000"), "Dos precios muy distintos: sigue siendo Pocas muestras y además avisa el rango");
// Precios en dólares convertidos a pesos (cotización 40): U$S 60, 61, 62,5, 63, 65 y uno de U$S 300.
const usdPrices = [60, 61, 62.5, 63, 65].map((usd) => usd * 40);
assert(assessMarketData(usdPrices)!.level === "solid" && assessMarketData(usdPrices)!.median === 2500, "Precios en dólares pasados a pesos: se evalúan igual (sólido, mediana 2.500)");
const usdWide = assessMarketData([...usdPrices, 300 * 40])!;
assert(usdWide.level === "weak" && usdWide.reasons.includes("los precios van de $U 2.400 a $U 12.000"), "Dólares convertidos con uno muy caro: Dato flojo con el rango en pesos");

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

console.log("--- Búsqueda ampliada (ronda 10): nombre más corto ---");
const broadenCases: Array<[string, string | null]> = [
  ["Termo Stanley Classic 1 litro", "Termo Stanley Classic"],
  ["Olla a presion electrica 5 lts Xion", "Olla a presion electrica Xion"],
  ["Auriculares F9-5 TWS Bluetooth", "Auriculares F9-5 TWS"],
  ["Botella termo Stanley Classic 950 ml", "Botella termo Stanley Classic"],
  ["Botella termo Stanley Classic 950ml", "Botella termo Stanley Classic"],
  ["Set cubiertos Tramontina 24 piezas inox", "Set cubiertos Tramontina inox"],
  ["Lampara inteligente Xiaomi Smart LED", "Lampara inteligente Xiaomi Smart"],
  ["Celular Samsung A54 5G 128gb", "Celular Samsung A54 5G"],
  ['Parlante JBL Flip 6.5"', "Parlante JBL Flip"],
  ["Pilas Duracell AA x12", "Pilas Duracell AA"],
  ["Pilas Duracell AA x 12", "Pilas Duracell AA"],
  ["Yerba Canarias 1 kg", "Yerba Canarias"],
  ["Mouse Logitech M170 inalámbrico negro", "Mouse Logitech M170"],
  ["Cable HDMI 2 m", "Cable HDMI"],
  ["Aceite de oliva 500 ml", "Aceite de oliva"],
  // Sin forma razonable de acortar
  ["Termo", null],
  ["Termo Stanley", null],
  ["Termo 1 litro", null],
  ["Auriculares Bluetooth", null],
  ["Olla Xion OP105", null],
  ["Samsung Galaxy S24", null],
  ["", null],
  ["   ", null],
];
for (const [name, expected] of broadenCases) {
  const got = broadenQuery(name);
  assert(got === expected, `«${name}» → ${expected === null ? "sin versión corta" : `«${expected}»`}${got === expected ? "" : ` (dio ${JSON.stringify(got)})`}`);
}
const broadened = broadenCases.map(([name]) => [name, broadenQuery(name)] as const).filter(([, b]) => b !== null);
assert(
  broadened.every(([name, b]) => b !== name.trim() && b!.split(/\s+/).length >= 2 && b!.length < name.length),
  "La versión corta nunca es igual al original ni tiene menos de dos palabras"
);
assert(
  ["F9-5", "A54", "5G", "M170"].every((code) => broadened.filter(([name]) => name.includes(code)).every(([, b]) => b!.includes(code))),
  "No rompe códigos de modelo (F9-5, A54, 5G, M170)"
);
assert(broadenQuery("Termo Stanley Classic 1 litro negro") === "Termo Stanley Classic negro" && broadenQuery("Termo Stanley Classic negro") === "Termo Stanley Classic" && broadenQuery("Termo Stanley Classic") === null, "Se acorta de a un paso: primero la medida, después la palabra genérica, y ahí termina");

const solidBroadened = asBroadened(realSolid, "Termo Stanley Classic");
assert(
  realSolid.level === "solid" && solidBroadened.level === "weak" && solidBroadened.label === "Dato flojo" &&
    solidBroadened.reasons.join() === "se buscó «Termo Stanley Classic» porque el nombre completo no tenía resultados",
  "Búsqueda ampliada: un dato que sería sólido baja a Dato flojo, con el motivo y el nombre usado"
);
const weakBroadened = asBroadened(olla, "Olla Xion");
assert(weakBroadened.level === "weak" && weakBroadened.reasons.length === olla.reasons.length + 1 && weakBroadened.reasons.at(-1) === broadenedReason("Olla Xion"), "Búsqueda ampliada: conserva los motivos que ya tenía y suma el suyo");
assert(asBroadened(single, "Termo Stanley").level === "few" && asBroadened(null, "Termo Stanley").level === "weak", "Búsqueda ampliada: Pocas muestras sigue siendo Pocas muestras; sin precios para evaluar queda flojo, nunca sólido");
assert(realSolid.level === "solid" && realSolid.reasons.length === 0, "Marcar como ampliada no modifica la evaluación original");

console.log("\n=================================================");
console.log(`RESULTADO: ${passedTests}/${totalTests} casos de confiabilidad del dato de mercado`);
console.log("=================================================");
if (passedTests !== totalTests) process.exit(1);
