// Tests de relevancia del radar y de "mismo tipo" para Similares. Sin red: los productos son fichas
// recortadas de respuestas reales de la API de Mercado Libre (nombre, family_name y atributos).
import {
  brandKey,
  nameHasTypeWords,
  productBrand,
  productTexts,
  productTypeWords,
  queryTerms,
  relevanceOf,
} from "../src/lib/mlu/relevance";
import { isFarFromMedian } from "../src/lib/mlu/statistics";

let passed = 0;
let total = 0;
function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rel = (query: string, ...texts: string[]) => relevanceOf(query, texts);

const stanley950 = {
  name: "Botella termo Stanley Classic, 950 ml, color verde martillado",
  family_name: "Termo Stanley Classic 940mL",
  attributes: [
    { id: "BRAND", value_name: "Stanley" },
    { id: "LINE", value_name: "Classic" },
    { id: "THERMO_CAPACITY", value_name: "940 mL" },
  ],
};
const ollaXion = {
  name: "Olla A Presion Electrica 5 Lts Xion Xi-op105 900w / inox-negro",
  family_name: "Olla a presión Xion XI-OP105",
  attributes: [
    { id: "BRAND", value_name: "Xion" },
    { id: "MODEL", value_name: "XI-OP105" },
    { id: "VOLUME_CAPACITY", value_name: "5 L" },
  ],
};
const omeletera = {
  name: "Omeletera Eléctrica Nappo 1000w Antiadherente 2 Divisiones",
  family_name: "Olla eléctrica Nappo NEQ-161 -",
  attributes: [
    { id: "BRAND", value_name: "Nappo" },
    { id: "PRODUCT_TYPE", value_name: "Olla" },
  ],
};
const jbl520 = {
  name: "Auriculares Bluetooth Jbl Tune 520BT Azul",
  family_name: "Auriculares JBL Tune 520BT",
  attributes: [{ id: "BRAND", value_name: "JBL" }],
};
const shaker = {
  name: "Shaker Proteina Mezcladora Vaso Shaker Gym Deportivos 500ml De Vaso Shaker Negro Color",
  family_name: "Botella shaker Maange shaker proteina",
  attributes: [{ id: "BRAND", value_name: "Maange" }],
};

console.log("--- Términos de la búsqueda y stopwords ---");
assert(same(queryTerms("termo stanley 950"), ["termo", "stanley", "950"]), "\"termo stanley 950\" se compara por termo, stanley y 950");
assert(same(queryTerms("olla de presión para la cocina"), ["olla", "presion", "cocina"]), "Las stopwords (de, para, la) no se comparan y se ignoran las tildes");
assert(same(queryTerms("Termo TERMO termo"), ["termo"]), "Los términos repetidos se comparan una sola vez");
assert(rel("termo de stanley con 950", "Termo Stanley Classic 950 Ml").matches, "Una stopword en la búsqueda no hace fallar la coincidencia");

console.log("\n--- Unión de unidades ---");
assert(same(queryTerms("termo 950 ml"), ["termo", "950ml"]), "\"950 ml\" se une en un solo término \"950ml\"");
assert(same(queryTerms("termo 950ml"), queryTerms("termo 950 ml")), "\"950ml\" y \"950 ml\" dan los mismos términos");
assert(rel("termo 950 ml", "Termo Stanley Clasica 950ml Rojo").matches, "\"950 ml\" coincide con \"950ml\" en el nombre");
assert(rel("termo 950ml", "Termo Stanley Classic| 950 Ml").matches, "\"950ml\" coincide con \"950 Ml\" en el nombre");
assert(rel("termo 1l", "Termo Botella Buffer 1 Litro - Ivory").matches, "\"1l\" coincide con \"1 Litro\"");
assert(rel("olla 5 litros", "Olla A Presion Electrica 5 Lts Xion").matches, "\"5 litros\" coincide con \"5 Lts\"");
assert(rel("botella 1.5 l", "Botella 1,5 Lts").matches, "\"1.5 l\" coincide con \"1,5 Lts\" (punto o coma decimal)");
assert(!rel("termo 1l", "Termo 1 kg de acero").matches, "\"1l\" no coincide con \"1 kg\": la unidad tiene que ser la misma");
assert(!rel("termo 1l", "Termo 1 lava").matches, "\"1l\" no coincide con \"1 lava\": la unidad tiene que terminar ahí");
assert(same(queryTerms("auriculares 2 colores"), ["auriculares", "2", "colores"]), "Un número seguido de una palabra que no es unidad no se une");

console.log("\n--- Números estrictos ---");
assert(!rel("termo stanley 950", "Termo Stanley 12 oz").matches, "\"termo stanley 950\" no coincide con un termo de 12 oz");
assert(same(rel("termo stanley 950", "Termo Stanley 12 oz").missing, ["950"]), "Lo que falta en el termo de 12 oz es \"950\"");
assert(!rel("termo 12 oz", "Termo Stanley Classic 950 Ml").matches, "\"termo 12 oz\" no coincide con un termo de 950 ml");
assert(!rel("termo stanley 950", "Termo Stanley Clásico 940mL rosa").matches, "950 no coincide con 940 (no hay tolerancia)");
assert(!rel("termo 950", "Termo Buffer 1950 ml").matches, "950 no coincide dentro de 1950");
assert(!rel("termo 950", "Termo Buffer 9500 ml").matches, "950 no coincide dentro de 9500");
assert(!rel("termo 5", "Termo 0,5 L").matches, "5 no coincide con el decimal 0,5");
assert(!rel("termo 1l", "Botella Termo Buffer Paine 1.2 Lts").matches, "\"1l\" no coincide con 1.2 Lts");
assert(rel("termo stanley 950", ...productTexts(stanley950)).matches, "El número puede estar en el nombre del producto");
assert(rel("termo stanley 940", ...productTexts(stanley950)).matches, "El número puede estar en la ficha técnica (940 mL)");

console.log("\n--- Marcas y modelos ---");
assert(rel("termo stanley", ...productTexts(stanley950)).matches, "La marca Stanley coincide con un termo Stanley");
assert(same(rel("termo stanley", "Termo Termolar R-evolution 1L").missing, ["stanley"]), "A un termo Termolar le falta \"stanley\"");
assert(rel("auriculares jbl", ...productTexts(jbl520)).matches, "La marca coincide sin importar mayúsculas (jbl / Jbl / JBL)");
assert(rel("parlante jbl", "Parlante portátil Go 4", "JBL").matches, "La marca puede estar solo en la ficha (atributo BRAND)");
assert(rel("olla xion xi-op105", ...productTexts(ollaXion)).matches, "Un código de modelo con guion (xi-op105) coincide");
assert(rel("olla xion xiop105", ...productTexts(ollaXion)).matches, "El código de modelo coincide aunque se escriba sin guion");
assert(rel("auriculares bluetooth", "Auricular Bluetooth Wave Beam 2").matches, "El plural coincide con el singular (auriculares / auricular)");
assert(productBrand(jbl520) === "JBL" && productBrand({ name: "Mate" }) === "", "productBrand lee BRAND y devuelve vacío si no está");
assert(brandKey("JBL") === brandKey("Jbl") && brandKey("Stanley") !== brandKey("Termolar"), "brandKey agrupa la misma marca escrita distinto");

console.log("\n--- Mismo tipo para Similares ---");
assert(same(productTypeWords(ollaXion), ["olla", "presión"]), "Tipo de la olla Xion: «olla» y «presión»");
assert(!nameHasTypeWords(omeletera.name, productTypeWords(ollaXion)), "La omeletera no es del mismo tipo que la olla a presión");
assert(nameHasTypeWords("Olla de Presión Eléctrica Yinuo KF 6 L", productTypeWords(ollaXion)), "Otra olla a presión sí es del mismo tipo");
assert(!nameHasTypeWords("Olla Arrocera Eléctrica 1.8 L", productTypeWords(ollaXion)), "Una olla arrocera no es del mismo tipo que una olla a presión");
assert(same(productTypeWords(jbl520), ["auriculares"]), "Tipo de los JBL Tune 520BT: «auriculares»");
assert(nameHasTypeWords("Auricular Bluetooth Wave Beam 2 Azul", productTypeWords(jbl520)), "Otro auricular (en singular) es del mismo tipo");
assert(!nameHasTypeWords("Parlante Bluetooth Jbl Go 4", productTypeWords(jbl520)), "Un parlante JBL no es del mismo tipo que unos auriculares");
assert(same(productTypeWords(stanley950), ["termo"]), "Tipo del termo Stanley: «termo»");
assert(same(productTypeWords(shaker), ["shaker"]), "El tipo solo usa palabras que también están en el nombre (shaker, no botella)");

console.log("\n--- Casos vacíos y sin coincidencias ---");
assert(same(queryTerms(""), []) && same(queryTerms("de la"), []), "Una búsqueda vacía o solo con stopwords no tiene términos");
assert(same(rel("", "Termo Stanley"), { matches: false, missing: [] }), "Una búsqueda vacía no coincide con nada");
assert(!rel("de la", "Termo de la casa").matches, "Una búsqueda solo con stopwords no coincide con nada");
assert(same(rel("termo stanley", ""), { matches: false, missing: ["termo", "stanley"] }), "Un producto sin texto no coincide y le faltan todos los términos");
assert(same(rel("zapatilla nike 42", "Termo Stanley Classic 950 Ml").missing, ["zapatilla", "nike", "42"]), "Sin coincidencias: se informan todos los términos que faltan");
assert(same(productTexts({}), [""]) && same(productTexts(null), [""]), "Una ficha vacía o nula no rompe productTexts");
assert(same(productTypeWords({}), []), "Sin nombre no hay palabras de tipo");
assert(!nameHasTypeWords("Olla a presión", []), "Sin palabras de tipo no se afirma \"mismo tipo\"");

console.log("\n--- Precio muy distinto a la mediana (solo marca) ---");
assert(isFarFromMedian(18900, 3493), "$U 18.900 frente a una mediana de $U 3.493 se marca (más de 3 veces)");
assert(isFarFromMedian(139, 1807), "$U 139 frente a una mediana de $U 1.807 se marca (menos de un tercio)");
assert(!isFarFromMedian(5982, 3493) && !isFarFromMedian(2500, 3279), "Precios dentro de 3 veces la mediana no se marcan");
assert(!isFarFromMedian(900, 300) && !isFarFromMedian(100, 300), "Exactamente 3 veces o un tercio no se marca (la regla es \"más de\")");
assert(!isFarFromMedian(1000, null) && !isFarFromMedian(1000, 0), "Sin mediana no se marca nada");

console.log("\n=================================================");
console.log(`RESULTADO: ${passed}/${total} casos de relevancia y tipo de producto`);
console.log("=================================================");
if (passed !== total) process.exit(1);
