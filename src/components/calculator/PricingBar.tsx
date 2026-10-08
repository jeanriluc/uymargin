import { BarChart3, Target, Zap } from "lucide-react";
import { formatUsd, formatUyu } from "@/lib/format";
import type { MarketStats } from "@/lib/mlu/types";
import { NumberField } from "@/components/ui/NumberField";
import { StepHeader } from "@/components/ui/StepHeader";

interface PricingBarProps {
  salePrice: number;
  exchangeRate: number;
  stats: MarketStats | null;
  suggestedPrice: number | null;
  breakEvenPrice: number | null;
  onChange: (price: number) => void;
  /** Jumps to the optional market research block. */
  onFindMarketPrice?: () => void;
}

export function PricingBar({
  salePrice,
  exchangeRate,
  stats,
  suggestedPrice,
  breakEvenPrice,
  onChange,
  onFindMarketPrice,
}: PricingBarProps) {
  const position =
    stats && salePrice > 0 && stats.max > stats.min
      ? Math.min(100, Math.max(0, ((salePrice - stats.min) / (stats.max - stats.min)) * 100))
      : null;

  const quickActions = [
    {
      id: "preset-median",
      label: "Mediana Mercado",
      value: stats?.median ?? null,
      icon: BarChart3,
      badge: "COMPETITIVO",
    },
    {
      id: "preset-target30",
      label: "Margen 30% Neto",
      value: suggestedPrice,
      icon: Target,
      badge: "OBJETIVO",
    },
    {
      id: "preset-breakeven",
      label: "Punto Equilibrio",
      value: breakEvenPrice,
      icon: Zap,
      badge: "$0 PÉRDIDA",
    },
  ];

  return (
    <section aria-label="Precio de venta" className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-5 sm:p-6 shadow-sm">
      <StepHeader step="02" title="Precio de venta al público" aside="Lo que cobrás" />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] items-end">
        <div>
          <NumberField
            id="sale-price"
            label="Precio de Venta al Público ($U)"
            value={salePrice}
            onChange={onChange}
            prefix="$U"
            inputClassName="h-14 text-3xl font-black tracking-tight text-zinc-900 dark:text-zinc-100"
            hint={
              exchangeRate > 0 && salePrice > 0
                ? `Equivale a ${formatUsd(salePrice / exchangeRate)} al cambio actual de ${exchangeRate}`
                : "Escribí un precio o tocá uno de los atajos"
            }
          />
        </div>

        {/* Strategy Presets */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
            Atajos de Fijación de Precios:
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {quickActions.map(({ id, label, value, badge }) => (
              <button
                key={id}
                type="button"
                disabled={value === null || value <= 0}
                onClick={() => value !== null && onChange(Math.round(value))}
                className="group flex flex-col justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/60 p-3 text-left transition-all hover:border-black dark:hover:border-white cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-zinc-400 group-hover:text-black dark:group-hover:text-white">
                    {badge}
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                  {label}
                </span>
                <span className="num text-sm font-black text-black dark:text-white mt-1">
                  {value !== null && value > 0 ? formatUyu(value) : "—"}
                </span>
              </button>
            ))}
          </div>

          {!stats && onFindMarketPrice && (
            <button
              type="button"
              onClick={onFindMarketPrice}
              className="self-start text-xs font-bold text-zinc-700 dark:text-zinc-300 underline underline-offset-2 hover:text-black dark:hover:text-white cursor-pointer"
            >
              ¿No sabés a cuánto vender? Buscá el precio de mercado
            </button>
          )}
        </div>
      </div>

      {/* Visual positioning range indicator in monochrome */}
      {stats && (
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1.5">
            <span>Rango de Mercado MLU</span>
            <span>
              {position !== null
                ? position < 35
                  ? "Rango Bajo / Agresivo"
                  : position < 65
                    ? "Rango Medio / Equilibrado"
                    : "Rango Alto / Premium"
                : ""}
            </span>
          </div>

          <div className="relative h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-zinc-400 via-zinc-600 to-black dark:from-zinc-600 dark:via-zinc-400 dark:to-white" />
            {position !== null && (
              <div
                className="absolute top-0 bottom-0 w-2 bg-black dark:bg-white shadow ring-2 ring-white dark:ring-black -translate-x-1/2 transition-all duration-300"
                style={{ left: `${position}%` }}
              />
            )}
          </div>

          <div className="num mt-1.5 flex justify-between text-[10px] font-bold text-zinc-400">
            <span>MIN: {formatUyu(stats.min)}</span>
            <span className="text-black dark:text-white font-black">MEDIANA: {formatUyu(stats.median)}</span>
            <span>MAX: {formatUyu(stats.max)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
