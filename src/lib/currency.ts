/**
 * Moneda de precios de terceros (publicaciones, catálogos) y cotización del dólar.
 *
 * Reglas:
 * - El precio y la moneda originales nunca se descartan; la conversión es un dato aparte.
 * - Solo se convierte con una cotización real (BCU, última guardada o ingresada a mano).
 * - Una moneda que no reconocemos no se convierte: el resultado queda pendiente.
 */

export type KnownCurrency = "UYU" | "USD";

export type RateSource = "bcu" | "manual";

export interface ExchangeRate {
  /** Pesos uruguayos por dólar. */
  rate: number;
  /** Fecha a la que corresponde la cotización (AAAA-MM-DD). Null si se ingresó a mano sin fecha. */
  referenceDate: string | null;
  source: RateSource;
  /** Cuándo se obtuvo o se ingresó (ISO). */
  fetchedAt: string;
  /** True cuando no se pudo actualizar y se está usando el último valor guardado. */
  stale: boolean;
}

const ALIASES: Record<string, KnownCurrency> = {
  UYU: "UYU",
  "$U": "UYU",
  PESO: "UYU",
  PESOS: "UYU",
  USD: "USD",
  "U$S": "USD",
  "US$": "USD",
  DOLAR: "USD",
  "DÓLAR": "USD",
  DOLARES: "USD",
  "DÓLARES": "USD",
};

/** Devuelve la moneda reconocida o null. No adivina: vacío o desconocido es null. */
export function normalizeCurrency(raw: unknown): KnownCurrency | null {
  if (typeof raw !== "string") return null;
  return ALIASES[raw.trim().toUpperCase()] ?? null;
}

export function isUsableRate(rate: ExchangeRate | null | undefined): rate is ExchangeRate {
  return !!rate && Number.isFinite(rate.rate) && rate.rate > 0;
}

export type Conversion =
  | { status: "ok"; amountUyu: number; currency: KnownCurrency; rate: ExchangeRate | null }
  | { status: "unknown_currency"; currency: string }
  | { status: "no_rate"; currency: "USD" }
  | { status: "invalid_amount" };

/**
 * Convierte un monto a pesos para comparar y calcular.
 * `rate` solo se usa (y solo se devuelve) cuando la moneda es USD.
 */
export function convertToUyu(amount: number, currency: unknown, rate: ExchangeRate | null | undefined): Conversion {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return { status: "invalid_amount" };
  const known = normalizeCurrency(currency);
  if (!known) return { status: "unknown_currency", currency: typeof currency === "string" ? currency.trim() : "" };
  if (known === "UYU") return { status: "ok", amountUyu: amount, currency: "UYU", rate: null };
  if (!isUsableRate(rate)) return { status: "no_rate", currency: "USD" };
  return { status: "ok", amountUyu: amount * rate.rate, currency: "USD", rate };
}

export type RateResolution =
  | { status: "live"; rate: ExchangeRate }
  | { status: "stale"; rate: ExchangeRate }
  | { status: "missing"; rate: null };

/**
 * Decide qué cotización usar: la recién obtenida; si no hay, la última guardada marcada como
 * no actualizada; si tampoco hay, ninguna (hay que pedirle el valor al usuario).
 */
export function resolveExchangeRate(fetched: ExchangeRate | null, stored: ExchangeRate | null): RateResolution {
  if (isUsableRate(fetched)) return { status: "live", rate: { ...fetched, stale: false } };
  if (isUsableRate(stored)) return { status: "stale", rate: { ...stored, stale: true } };
  return { status: "missing", rate: null };
}

function shortDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${Number(m[3])}/${Number(m[2])}` : null;
}

/** "BCU, cierre del 7/10" · "cotización del 7/10, no actualizada" · "valor manual del 8/10". */
export function describeRate(rate: ExchangeRate): string {
  const date = shortDate(rate.referenceDate ?? rate.fetchedAt);
  if (rate.stale) return date ? `cotización del ${date}, no actualizada` : "cotización no actualizada";
  if (rate.source === "manual") return date ? `valor manual del ${date}` : "valor manual";
  return date ? `BCU, cierre del ${date}` : "BCU";
}

const STORAGE_KEY = "uymargin:rate:v1";

export function loadStoredRate(): ExchangeRate | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ExchangeRate> | null;
    if (!v || typeof v.rate !== "number" || !(v.rate > 0) || (v.source !== "bcu" && v.source !== "manual")) return null;
    return {
      rate: v.rate,
      referenceDate: typeof v.referenceDate === "string" ? v.referenceDate : null,
      source: v.source,
      fetchedAt: typeof v.fetchedAt === "string" ? v.fetchedAt : new Date().toISOString(),
      stale: false,
    };
  } catch {
    return null;
  }
}

export function saveStoredRate(rate: ExchangeRate): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rate, stale: false }));
  } catch {
    // Sin almacenamiento: la cotización simplemente no se recuerda.
  }
}
