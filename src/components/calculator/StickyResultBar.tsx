import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { formatPct, formatUyu } from "@/lib/format";
import type { ChannelResult } from "@/lib/finance/types";
import { verdictTone, type VerdictTone } from "./ProfitHeroCard";

interface StickyResultBarProps {
  /** Id of the full result card; the bar hides while that card is on screen. */
  targetId: string;
  result: ChannelResult;
  channelLabel: string;
}

const TONE_STYLES: Record<VerdictTone, { dot: string; amount: string; phrase: string }> = {
  loss: { dot: "bg-red-500", amount: "text-red-600 dark:text-red-400", phrase: "Perdés" },
  tight: { dot: "bg-amber-500", amount: "text-amber-700 dark:text-amber-400", phrase: "Te quedan" },
  good: { dot: "bg-emerald-500", amount: "text-emerald-700 dark:text-emerald-400", phrase: "Te quedan" },
};

/** Mobile-only verdict that stays in view while the user edits cost and price. */
export function StickyResultBar({ targetId, result, channelLabel }: StickyResultBarProps) {
  const [targetVisible, setTargetVisible] = useState(true);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setTargetVisible(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  if (targetVisible) return null;

  const tone = TONE_STYLES[verdictTone(result)];

  return (
    <button
      type="button"
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      aria-label={`Ver resultado completo. ${tone.phrase} ${formatUyu(Math.abs(result.netProfit))} por unidad en ${channelLabel}`}
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-left shadow-[0_-4px_16px_rgba(0,0,0,0.12)] cursor-pointer print:hidden"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`size-3 shrink-0 rounded-full ${tone.dot}`} />
        <span className="min-w-0">
          <span className="block text-base font-black leading-tight text-zinc-900 dark:text-zinc-100">
            {tone.phrase}{" "}
            <span className={`num ${tone.amount}`}>{formatUyu(Math.abs(result.netProfit))}</span>
          </span>
          <span className="block truncate text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            {formatPct(result.netMargin)} del precio · {channelLabel}
          </span>
        </span>
      </span>
      <ChevronUp aria-hidden className="size-5 shrink-0 text-zinc-600 dark:text-zinc-400" />
    </button>
  );
}
