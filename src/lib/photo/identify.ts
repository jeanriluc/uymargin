/**
 * Identificación de un producto por foto: límites, validación de la imagen y de la respuesta de la IA.
 * Sin red, sin DOM y sin Node: lo usan el servidor, la pantalla y los tests.
 */

/** Tipos de imagen que se aceptan. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Límites de la foto. Único lugar donde se cambian. */
export const PHOTO_LIMITS = {
  /** Lo que acepta el servidor. Vercel corta el cuerpo de un pedido en 4,5 MB: se queda bien por debajo. */
  maxBytes: 3 * 1024 * 1024,
  /** Lo que el navegador intenta abrir antes de achicar (las fotos de celular pesan varios MB). */
  maxOriginalBytes: 20 * 1024 * 1024,
  /** Lado mayor, en píxeles, de la imagen que se manda. */
  maxSide: 1024,
  /** Calidad del JPEG que se manda. */
  jpegQuality: 0.8,
} as const;

/** Largo máximo del nombre de búsqueda: el mismo que admite el cuadro del Radar. */
export const PHOTO_NAME_MAX = 120;
const MAX_ALTERNATIVES = 2;
const MAX_ATTRIBUTES = 6;

export const PHOTO_MESSAGES = {
  type: "Ese archivo no sirve: subí una foto en JPG, PNG o WebP.",
  size: "La foto es demasiado pesada. Probá con una más liviana o sacale una captura.",
  unreadable: "No se pudo abrir esa imagen. Probá con otra foto.",
  notConfigured: "La identificación por foto no está disponible: falta configurar la IA en el servidor.",
  provider: "La IA no pudo analizar la foto en este momento. Probá de nuevo en unos minutos o escribí el nombre en el Radar.",
  invalidAnswer: "La IA devolvió una respuesta que no se pudo leer. Probá de nuevo o escribí el nombre en el Radar.",
  network: "Error de red al enviar la foto. Revisá la conexión y probá de nuevo.",
  noProduct: "No encontré un producto claro en la foto.",
} as const;

export function isPhotoType(value: unknown): value is PhotoType {
  return typeof value === "string" && (PHOTO_TYPES as readonly string[]).includes(value);
}

export type PhotoProblem = "type" | "size";

/** Control del archivo antes de abrirlo o de mandarlo. null = está bien. */
export function checkPhotoFile(type: string, size: number, maxBytes: number): PhotoProblem | null {
  if (!isPhotoType(type)) return "type";
  if (!(size > 0) || size > maxBytes) return "size";
  return null;
}

/** Tipo real de la imagen según sus primeros bytes (no según lo que declara quien la manda). */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  const starts = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Tamaño con el lado mayor acotado a maxSide, sin agrandar ni deformar. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxSide / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type PhotoConfidence = "alta" | "media" | "baja";

/** Cómo se le dice al usuario cada nivel de confianza. */
export const CONFIDENCE_PHRASES: Record<PhotoConfidence, string> = {
  alta: "Estoy seguro",
  media: "Puede ser",
  baja: "No estoy seguro: revisá el nombre",
};

export interface IdentifiedProduct {
  ok: true;
  isProduct: boolean;
  /** Nombre corto para buscar. Vacío si no hay producto. */
  name: string;
  /** Hasta dos nombres más genéricos. */
  alternatives: string[];
  brand: string | null;
  category: string | null;
  attributes: string[];
  confidence: PhotoConfidence;
  notes: string;
}

export type IdentificationParse = { ok: true; value: IdentifiedProduct } | { ok: false; reason: string };

/** Texto en una línea, sin caracteres de control y acotado. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function cleanList(value: unknown, maxItems: number, maxChars: number, exclude: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: string[] = [];
  for (const entry of value) {
    const text = clean(entry, maxChars);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
}

/** Saca el objeto JSON de la respuesta aunque venga con texto o un bloque ``` alrededor. */
function extractJson(text: string): unknown {
  const attempts = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // se prueba la siguiente forma
    }
  }
  return undefined;
}

/**
 * Valida la respuesta de la IA. Lo esencial es estricto (isProduct, confidence y, si hay producto, name):
 * si falta o tiene otro tipo, la respuesta no sirve. Lo accesorio (alternativas, marca, categoría,
 * atributos, notas) se descarta en silencio si viene mal. Nada de lo que devuelve sale sin acotar.
 */
export function parseIdentification(text: unknown): IdentificationParse {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "respuesta vacía" };
  const raw = extractJson(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "no es un objeto JSON" };
  const data = raw as Record<string, unknown>;

  if (typeof data.isProduct !== "boolean") return { ok: false, reason: "falta isProduct" };
  if (data.confidence !== "alta" && data.confidence !== "media" && data.confidence !== "baja") {
    return { ok: false, reason: "confidence inválida" };
  }
  const notes = clean(data.notes, 300);

  if (!data.isProduct) {
    return {
      ok: true,
      value: { ok: true, isProduct: false, name: "", alternatives: [], brand: null, category: null, attributes: [], confidence: "baja", notes },
    };
  }

  const name = clean(data.name, PHOTO_NAME_MAX);
  if (name.length < 2) return { ok: false, reason: "falta name" };

  return {
    ok: true,
    value: {
      ok: true,
      isProduct: true,
      name,
      alternatives: cleanList(data.alternatives, MAX_ALTERNATIVES, PHOTO_NAME_MAX, [name]),
      brand: clean(data.brand, 60) || null,
      category: clean(data.category, 60) || null,
      attributes: cleanList(data.attributes, MAX_ATTRIBUTES, 40),
      confidence: data.confidence,
      notes,
    },
  };
}
