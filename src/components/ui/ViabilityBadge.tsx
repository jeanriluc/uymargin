import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import type { Viability } from "@/lib/finance/types";

const CONFIG: Record<
  Viability,
  { label: string; short: string; badgeClass: string; Icon: typeof CheckCircle2 }
> = {
  excellent: {
    label: "Altamente Rentable",
    short: "Rentable",
    badgeClass: "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white font-bold tracking-tight shadow-sm",
    Icon: CheckCircle2,
  },
  tight: {
    label: "Margen Ajustado",
    short: "Ajustado",
    badgeClass: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border-zinc-900 dark:border-zinc-300 font-bold",
    Icon: AlertTriangle,
  },
  risky: {
    label: "Riesgoso / A Pérdida",
    short: "Riesgoso",
    badgeClass: "bg-transparent text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-300 border-dashed font-bold",
    Icon: CircleAlert,
  },
};

interface ViabilityBadgeProps {
  viability: Viability;
  compact?: boolean;
}

export function ViabilityBadge({ viability, compact = false }: ViabilityBadgeProps) {
  const { label, short, badgeClass, Icon } = CONFIG[viability];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs border rounded-md transition-colors ${badgeClass}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="uppercase text-[11px] tracking-wider">{compact ? short : label}</span>
    </span>
  );
}

export const viabilityTone: Record<Viability, string> = {
  excellent: "text-zinc-900 dark:text-zinc-100 font-black",
  tight: "text-zinc-700 dark:text-zinc-300 font-bold",
  risky: "text-zinc-600 dark:text-zinc-400 line-through font-bold",
};
