import { formatUyu } from "@/lib/format";
import type { WaterfallStep } from "@/lib/finance/types";

interface WaterfallChartProps {
  steps: WaterfallStep[];
  id: string;
}

const COLORS: Record<WaterfallStep["key"], string> = {
  price: "bg-brand",
  product: "bg-[oklch(62%_0.03_250)]",
  fees: "bg-sun",
  shipping: "bg-[oklch(65%_0.12_300)]",
  reserves: "bg-amber-600 dark:bg-amber-500",
  taxes: "bg-bad/80",
  net: "bg-good",
};

/**
 * Horizontal waterfall: price → deductions (floating segments) → net profit.
 * Handles negative running totals (loss) and negative taxes (IVA saldo a favor).
 */
export function WaterfallChart({ steps, id }: WaterfallChartProps) {
  // Compute running positions.
  let running = 0;
  const bars = steps.map((step) => {
    if (step.key === "price") {
      running = step.amount;
      return { step, start: 0, end: step.amount };
    }
    if (step.key === "net") {
      return { step, start: 0, end: step.amount };
    }
    const start = running;
    running += step.amount;
    return { step, start, end: running };
  });

  const values = bars.flatMap((b) => [b.start, b.end]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const span = hi - lo || 1;
  const toPct = (v: number) => ((v - lo) / span) * 100;
  const zero = toPct(0);

  return (
    <figure aria-labelledby={`${id}-caption`} className="space-y-2">
      <figcaption id={`${id}-caption`} className="visually-hidden">
        Desglose en cascada desde el precio de venta hasta la ganancia neta
      </figcaption>
      <ol className="space-y-2">
        {bars.map(({ step, start, end }) => {
          const left = toPct(Math.min(start, end));
          const width = Math.max(0.6, Math.abs(toPct(end) - toPct(start)));
          const isTotal = step.key === "price" || step.key === "net";
          const negativeNet = step.key === "net" && step.amount < 0;
          const isZero = Math.abs(step.amount) < 0.5 && !isTotal;
          return (
            <li key={step.key} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-xs sm:grid-cols-[8rem_1fr_6rem]">
              <span className={`truncate ${isTotal ? "font-semibold text-fg" : "text-muted"}`}>
                {step.label}
              </span>
              <span className="relative h-6 overflow-hidden rounded-md bg-surface-3/50">
                <span className="absolute inset-y-0 w-px bg-border-strong" style={{ left: `${zero}%` }} aria-hidden />
                {!isZero && (
                  <span
                    className={`absolute inset-y-1 rounded-[4px] transition-[left,width] duration-500 ease-out ${
                      negativeNet ? "bg-bad" : COLORS[step.key]
                    } ${isTotal ? "" : "opacity-85"}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                )}
              </span>
              <span
                className={`num text-right font-semibold ${
                  step.key === "net" ? (step.amount >= 0 ? "text-good" : "text-bad") : isTotal ? "text-fg" : "text-muted"
                }`}
              >
                {formatUyu(step.amount)}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
