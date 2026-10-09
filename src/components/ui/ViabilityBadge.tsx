import { AlertTriangle, CheckCircle2, CircleAlert, Star } from "lucide-react";
import { VIABILITY_LABELS } from "@/lib/finance/constants";
import type { Viability } from "@/lib/finance/types";

const CONFIG: Record<Viability, { badgeClass: string; Icon: typeof CheckCircle2 }> = {
  excellent: {
    badgeClass: "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white font-bold tracking-tight shadow-sm",
    Icon: Star,
  },
  good: {
    badgeClass: "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-300 font-bold",
    Icon: CheckCircle2,
  },
  tight: {
    badgeClass: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border-zinc-900 dark:border-zinc-300 font-bold",
    Icon: AlertTriangle,
  },
  loss: {
    badgeClass: "bg-transparent text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-300 border-dashed font-bold",
    Icon: CircleAlert,
  },
};

interface ViabilityBadgeProps {
  viability: Viability;
}

export function ViabilityBadge({ viability }: ViabilityBadgeProps) {
  const { badgeClass, Icon } = CONFIG[viability];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs border rounded-md transition-colors ${badgeClass}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="uppercase text-[11px] tracking-wider">{VIABILITY_LABELS[viability]}</span>
    </span>
  );
}
