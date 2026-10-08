/**
 * Relevancia de un producto de catálogo frente a lo que se buscó, y "mismo tipo de producto" para Similares.
 * Reglas simples y explicables: comparan texto que informa Mercado Libre, sin puntajes ni pesos.
 */

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "para", "con", "sin", "en", "por", "un", "una", "y"]);

/** Unidades que se pegan al número anterior: "950 ml" se compara como "950ml". */
const UNITS = new Set([
  "ml", "cc", "l", "lt", "lts", "litro", "litros", "g", "gr", "grs", "kg", "mg", "oz",
  "mm", "cm", "m", "mts", "pulgadas", "w", "v", "hz", "mah", "gb", "tb", "mb", "mp",
]);

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Singular aproximado, solo para comparar palabras ("auriculares" con "auricular"). */
function stem(word: string): string {
  if (/\d/.test(word)) return word;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function tokens(text: string): string[] {
  return fold(text).match(/\d+[.,]\d+[a-z]*|[a-z0-9]+/g) ?? [];
}

function significantWords(text: string): string[] {
  return tokens(text).filter((w) => w.length > 1 && !/\d/.test(w) && !STOPWORDS.has(w));
}

const NUMBER_TERM = /^(\d+(?:[.,]\d+)?)([a-z]*)$/;

/** Palabras y números de la búsqueda que se comparan, sin repetir. "950 ml" queda como "950ml". */
export function queryTerms(query: string): string[] {
  const raw = tokens(query);
  const terms: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let term = raw[i];
    if (/^\d+(?:[.,]\d+)?$/.test(term) && UNITS.has(raw[i + 1] ?? "")) {
      term += raw[i + 1];
      i++;
    }
    const isNumber = NUMBER_TERM.test(term);
    if (!isNumber && (term.length < 2 || STOPWORDS.has(term))) continue;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface QueryRelevance {
  /** Verdadero cuando el producto menciona todas las palabras y números de la búsqueda. */
  matches: boolean;
  /** Palabras o números de la búsqueda que el producto no menciona. */
  missing: string[];
}

/**
 * Un producto coincide cuando su nombre o su ficha técnica mencionan todas las palabras y números de la
 * búsqueda. Los números se comparan enteros ("950" no coincide con "1950" ni con "9,50") y con su unidad
 * si se escribió ("1l" coincide con "1 L" y "1 litro", no con "1,2 L").
 */
export function relevanceOf(query: string, texts: string[]): QueryRelevance {
  const terms = queryTerms(query);
  if (terms.length === 0) return { matches: false, missing: [] };

  const folded = fold(texts.filter(Boolean).join(" | "));
  const words = new Set((folded.match(/[a-z0-9]+/g) ?? []).map(stem));
  const compact = folded.replace(/[^a-z0-9]+/g, "");

  const missing = terms.filter((term) => {
    const numeric = term.match(NUMBER_TERM);
    if (numeric) {
      const value = escapeRegExp(numeric[1]).replace(/\\\.|,/g, "[.,]");
      const unit = numeric[2];
      const pattern = unit
        ? `(?<![0-9.,])${value}\\s*${escapeRegExp(unit)}`
        : `(?<![0-9.,])${value}(?![0-9])(?![.,][0-9])`;
      return !new RegExp(pattern).test(folded);
    }
    // Códigos de modelo ("op105", "s24"): pueden venir con guiones o espacios en el nombre.
    if (/\d/.test(term)) return !compact.includes(term);
    return !words.has(stem(term));
  });

  return { matches: missing.length === 0, missing };
}

/** Nombre y valores de la ficha técnica de un producto de catálogo, para comparar con la búsqueda. */
export function productTexts(product: any): string[] {
  const attributes: string[] = Array.isArray(product?.attributes)
    ? product.attributes.map((a: any) => (typeof a?.value_name === "string" ? a.value_name : ""))
    : [];
  return [typeof product?.name === "string" ? product.name : "", ...attributes];
}

function attributeValue(product: any, id: string): string {
  const found = Array.isArray(product?.attributes) ? product.attributes.find((a: any) => a?.id === id) : null;
  return typeof found?.value_name === "string" ? found.value_name : "";
}

/**
 * Palabras que nombran el tipo de producto ("olla", "presión"): lo que Mercado Libre pone antes de la marca
 * en el nombre de familia ("Olla a presión Xion XI-OP105"), siempre que también figure en el nombre del
 * producto. Si no se puede deducir, la primera palabra del nombre que no sea la marca.
 */
export function productTypeWords(product: any): string[] {
  const brand = new Set(significantWords(attributeValue(product, "BRAND")));
  const name = significantWords(typeof product?.name === "string" ? product.name : "");
  const nameStems = new Set(name.map(stem));
  // Se devuelven como las escribe Mercado Libre (con tildes) para mostrarlas; se comparan sin tildes.
  const family = (typeof product?.family_name === "string" ? product.family_name : "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w: string) => significantWords(w).length === 1);
  const brandAt = family.findIndex((w: string) => brand.has(fold(w)));
  const fromFamily = (brandAt > 0 ? family.slice(0, brandAt) : []).filter((w: string) => nameStems.has(stem(fold(w))));
  if (fromFamily.length > 0) return Array.from(new Set<string>(fromFamily)).slice(0, 2);
  const first = name.find((w) => !brand.has(w));
  return first ? [first] : [];
}

/** El nombre del producto menciona todas las palabras de tipo. Sin palabras de tipo no se puede afirmar. */
export function nameHasTypeWords(name: string, typeWords: string[]): boolean {
  if (typeWords.length === 0) return false;
  const stems = new Set(significantWords(name).map(stem));
  return typeWords.every((w) => stems.has(stem(fold(w))));
}
