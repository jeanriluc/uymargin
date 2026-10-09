/**
 * Versión más corta de un nombre de producto, para volver a buscar cuando el nombre completo no trajo precios.
 * Solo acorta el texto: quién la usa decide si busca de nuevo y siempre lo muestra ("búsqueda ampliada").
 */

/** Unidades de medida y de cantidad que suelen sobrar en un nombre de catálogo. */
const UNITS = [
  "ml", "cc", "l", "lt", "lts", "litro", "litros",
  "kg", "kgs", "kilo", "kilos", "g", "gr", "grs", "gramos", "mg", "oz",
  "cm", "mm", "m", "mt", "mts", "metro", "metros", "pulgadas", "pulgada", "pulg", "in",
  "gb", "tb", "mb", "w", "watts", "v", "mah", "hz",
  "u", "un", "uds", "unid", "unidad", "unidades", "piezas", "pieza", "pzas", "pcs",
];
const UNIT_PATTERN = UNITS.join("|");
/** "1", "6.5", "1,5", "1/2" */
const NUMBER = String.raw`\d+(?:[.,/]\d+)?`;
/** Medida en una sola palabra: "500ml", "128gb", `6.5"`, "x12", "12u". */
const MEASURE_TOKEN = new RegExp(String.raw`^(?:${NUMBER}(?:${UNIT_PATTERN})\.?|${NUMBER}(?:"|''|”|″)|x${NUMBER}(?:${UNIT_PATTERN})?)$`, "i");
const NUMBER_TOKEN = new RegExp(String.raw`^${NUMBER}$`);
const UNIT_TOKEN = new RegExp(String.raw`^(?:${UNIT_PATTERN})\.?$`, "i");
/** Generaciones de red, no gramos: "5G" es parte del modelo. */
const NOT_A_MEASURE = /^[2345]g$/i;

/** Palabras que describen pero no identifican: se sacan solo si están al final. */
const GENERIC_WORDS = new Set([
  "bluetooth", "inalambrico", "inalambrica", "inalambricos", "inalambricas", "wireless", "usb", "led",
  "original", "originales", "nuevo", "nueva", "nuevos", "nuevas", "importado", "importada",
  "inox", "inoxidable", "recargable", "portatil", "digital",
  "negro", "negra", "blanco", "blanca", "rojo", "roja", "azul", "verde", "gris", "rosa", "amarillo", "amarilla",
  "dorado", "dorada", "plateado", "plateada", "celeste", "violeta", "naranja", "beige", "marron",
]);
/** No cuentan como palabra del nombre a la hora de exigir que queden al menos dos. */
const CONNECTORS = new Set(["a", "de", "del", "con", "para", "y", "en", "la", "el", "los", "las", "por", "sin", "x"]);

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function significantCount(words: string[]): number {
  return words.filter((w) => /[a-z0-9]/i.test(w) && !CONNECTORS.has(fold(w))).length;
}

/** Saca medidas y cantidades: "1 litro", "5 lts", "500ml", "x12", `6.5"`. No toca códigos de modelo ("F9-5", "S24", "5G"). */
function withoutMeasures(words: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (NOT_A_MEASURE.test(word)) {
      kept.push(word);
      continue;
    }
    if (MEASURE_TOKEN.test(word)) continue;
    const next = words[i + 1];
    if (NUMBER_TOKEN.test(word) && next && UNIT_TOKEN.test(next)) {
      i++; // el número y su unidad
      continue;
    }
    // "x 12": la equis y el número que sigue.
    if (/^x$/i.test(word) && next && NUMBER_TOKEN.test(next)) {
      i++;
      continue;
    }
    kept.push(word);
  }
  return kept;
}

/** Saca del final las palabras genéricas ("Bluetooth", un color), sin bajar de dos palabras. */
function withoutTrailingGenerics(words: string[]): string[] {
  const kept = [...words];
  while (kept.length > 0 && GENERIC_WORDS.has(fold(kept[kept.length - 1])) && significantCount(kept.slice(0, -1)) >= 2) {
    kept.pop();
  }
  return kept;
}

/**
 * Devuelve el nombre más corto, o null si no hay una forma razonable de acortarlo.
 * Primero saca medidas y cantidades; si no había, saca palabras genéricas del final.
 * Nunca devuelve menos de dos palabras ni el mismo texto que recibió.
 */
export function broadenQuery(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (significantCount(words) < 3) return null;

  for (const attempt of [withoutMeasures(words), withoutTrailingGenerics(words)]) {
    if (attempt.length < words.length && significantCount(attempt) >= 2) return attempt.join(" ");
  }
  return null;
}
