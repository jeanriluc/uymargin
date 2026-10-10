/**
 * Foto del producto en el resumen. Solo se muestran imágenes servidas por Mercado Libre o por Google,
 * o la miniatura que arma el navegador con la foto que subió el usuario. Cualquier otra cosa se descarta.
 */

/** Lado mayor de la miniatura de la foto del usuario, en píxeles. */
export const LOCAL_THUMBNAIL_SIDE = 160;
/** Tope de la miniatura local ya codificada. Una de 160 px pesa mucho menos. */
const LOCAL_THUMBNAIL_MAX_CHARS = 80_000;
const IMAGE_URL_MAX_CHARS = 1000;

const GOOGLE_IMAGE_HOST = /(?:^|\.)(?:gstatic\.com|googleusercontent\.com|ggpht\.com)$/;
const MERCADO_LIBRE_IMAGE_HOST = /(?:^|\.)mlstatic\.com$/;
const LOCAL_THUMBNAIL = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Miniaturas que sirve Google (gstatic.com con sus encrypted-tbn*, googleusercontent.com, ggpht.com). */
export const isGoogleImageHost = (host: string) => GOOGLE_IMAGE_HOST.test(host.toLowerCase());
/** Fotos que sirve Mercado Libre (mlstatic.com y sus subdominios, como http2.mlstatic.com). */
export const isMercadoLibreImageHost = (host: string) => MERCADO_LIBRE_IMAGE_HOST.test(host.toLowerCase());

/** Dirección https de un host conocido, o null. Es lo único que se guarda (borrador, historial). */
export function safeProductImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > IMAGE_URL_MAX_CHARS) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return isMercadoLibreImageHost(url.hostname) || isGoogleImageHost(url.hostname) ? url.href : null;
}

/** ¿Es la miniatura que arma el navegador con la foto del usuario? Solo JPEG o PNG en base64. */
export function isLocalThumbnail(value: unknown): value is string {
  return typeof value === "string" && value.length <= LOCAL_THUMBNAIL_MAX_CHARS && LOCAL_THUMBNAIL.test(value);
}

/** Lo que se puede mostrar: una dirección conocida o la miniatura local. Si no, null y queda el icono. */
export function displayableProductImage(value: unknown): string | null {
  return isLocalThumbnail(value) ? value : safeProductImageUrl(value);
}

/**
 * Lo que se puede guardar: solo la dirección de un host conocido. La foto del usuario nunca se guarda,
 * y una entrada vieja sin el campo queda en null.
 */
export function storableProductImage(value: unknown): string | null {
  return safeProductImageUrl(value);
}
