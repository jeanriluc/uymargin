import { AlertTriangle } from "lucide-react";
import { convertToUyu, describeRate, type ExchangeRate } from "@/lib/currency";
import { formatMoney, formatRate, formatUyu } from "@/lib/format";

interface PriceWithEquivalentProps {
  amount: number;
  /** Moneda tal como vino de la fuente (currency_id de Mercado Libre, columna del CSV). */
  currency: string;
  rate: ExchangeRate | null;
  className?: string;
  equivalentClassName?: string;
}

/**
 * Precio en su moneda original y, si es en dólares, el equivalente en pesos con la
 * cotización usada y su fecha. Si no se puede convertir, lo dice en vez de calcular.
 */
export function PriceWithEquivalent({
  amount,
  currency,
  rate,
  className = "num text-xs font-black text-black dark:text-white",
  equivalentClassName = "text-[11px] font-semibold text-zinc-600 dark:text-zinc-400",
}: PriceWithEquivalentProps) {
  const conversion = convertToUyu(amount, currency, rate);

  if (conversion.status === "unknown_currency" || conversion.status === "invalid_amount") {
    return (
      <span className="block">
        <span className={`${className} block`}>
          {currency || "?"} {amount}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          Moneda no reconocida: sin convertir
        </span>
      </span>
    );
  }

  if (conversion.status === "no_rate") {
    return (
      <span className="block">
        <span className={`${className} block`}>{formatMoney(amount, "USD")}</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3 shrink-0" aria-hidden />
          Falta la cotización para pasarlo a pesos
        </span>
      </span>
    );
  }

  return (
    <span className="block">
      <span className={`${className} block`}>{formatMoney(amount, conversion.currency)}</span>
      {conversion.currency === "USD" && conversion.rate && (
        <span className={`${equivalentClassName} block`}>
          ≈ <span className="num">{formatUyu(conversion.amountUyu)}</span> · {describeRate(conversion.rate)} (
          <span className="num">{formatRate(conversion.rate.rate)}</span>)
        </span>
      )}
    </span>
  );
}
