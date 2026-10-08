const uyuFormatter = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });
const usdFormatter = new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pctFormatter = new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const decimalFormatter = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 2 });

function sign(value: number): string {
  return value < 0 ? "−" : "";
}

/** "$U 1.290" — Uruguayan pesos. */
export function formatUyu(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${sign(value)}$U ${uyuFormatter.format(Math.abs(Math.round(value)))}`;
}

/** "U$S 32,25" — US dollars. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${sign(value)}U$S ${usdFormatter.format(Math.abs(value))}`;
}

export function formatMoney(value: number, currency: "UYU" | "USD"): string {
  return currency === "USD" ? formatUsd(value) : formatUyu(value);
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${sign(value)}${pctFormatter.format(Math.abs(value))}%`;
}

export function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

/** Parses user-typed numbers accepting both "1.290,50" (es-UY) and "1290.50". */
export function parseLocaleNumber(raw: string): number {
  const text = raw.trim().replace(/[^\d.,-]/g, "");
  if (!text) return NaN;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1 && /^\-?\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text.replace(/,/g, "");
  }
  return Number(normalized);
}
