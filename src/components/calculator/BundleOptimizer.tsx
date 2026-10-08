"use client";

import { useMemo, useState } from "react";
import { Boxes, Sparkles, TrendingUp, ArrowRight, ShieldCheck, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { calculateBundleOptions, type BundleOption } from "@/lib/finance/bundles";
import type { AnalysisInputs, ChannelResult } from "@/lib/finance/types";
import { formatPct, formatUyu } from "@/lib/format";

interface BundleOptimizerProps {
  inputs: AnalysisInputs;
  baseResult: ChannelResult;
  onApplyBundle: (bundlePrice: number, bundleTitle: string) => void;
}

export function BundleOptimizer({ inputs, baseResult, onApplyBundle }: BundleOptimizerProps) {
  const [expanded, setExpanded] = useState(true);

  const bundleData = useMemo(() => {
    return calculateBundleOptions(inputs);
  }, [inputs]);

  if (!inputs.salePrice || inputs.salePrice <= 0) {
    return null;
  }

  const { isEligibleForBundleBoost, options, baseFixedFee } = bundleData;

  return (
    <div
      className={`rounded-xl border transition-all shadow-sm overflow-hidden ${
        isEligibleForBundleBoost
          ? "border-amber-500/40 bg-gradient-to-br from-amber-500/5 via-surface to-amber-500/10 dark:from-amber-950/20 dark:via-zinc-900/60 dark:to-amber-900/10"
          : "border-border bg-surface"
      }`}
    >
      {/* Header bar */}
      <div className="p-4 sm:p-5 flex items-start sm:items-center justify-between gap-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
              isEligibleForBundleBoost
                ? "bg-amber-500 text-white shadow-amber-500/20 shadow-md"
                : "bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900"
            }`}
          >
            <Boxes className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black uppercase tracking-tight text-foreground flex items-center gap-1.5">
                <span>Estrategia de Packs & Bundles (MLU)</span>
              </h3>
              {isEligibleForBundleBoost ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  <Zap className="size-3" /> Anti-Cargo Fijo
                </span>
              ) : (
                <span className="rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-muted uppercase">
                  Multiplicador
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              {isEligibleForBundleBoost
                ? `PVP actual ($U ${inputs.salePrice}) < $U 1.200: MLU cobra $U ${baseFixedFee} de cargo fijo por unidad. Armando un pack eliminás esta pérdida.`
                : "Aumentá el ticket promedio y volumen de venta ofreciendo combos y packs a tus compradores."}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="rounded-md border border-border bg-surface-2 p-1.5 text-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label={expanded ? "Minimizar opciones de packs" : "Expandir opciones de packs"}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="p-4 sm:p-5">
          {isEligibleForBundleBoost && (
            <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <Sparkles className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <strong className="font-bold">Efecto Palanca Financiero:</strong> Al empaquetar 2 o más unidades superás los $U 1.200. Mercado Libre <strong>elimina el cargo fijo unitario</strong> y el costo de despacho se amortiza en una sola entrega.
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {options.map((opt) => {
              const crosses = opt.crossesThreshold === 1;
              return (
                <div
                  key={opt.quantity}
                  className={`relative flex flex-col justify-between rounded-xl border p-3.5 transition-all ${
                    crosses && isEligibleForBundleBoost
                      ? "border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20 hover:border-emerald-500/60 shadow-sm"
                      : "border-border bg-surface-2 hover:border-border-strong"
                  }`}
                >
                  {crosses && isEligibleForBundleBoost && (
                    <div className="absolute -top-2.5 right-3 rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm flex items-center gap-1">
                      <ShieldCheck className="size-2.5" /> Sin cargo fijo
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-foreground">
                        {opt.label}
                      </span>
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-bold text-muted border border-border">
                        -{opt.discountPct}% promo
                      </span>
                    </div>

                    <div className="mt-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                        PVP Sugerido Pack
                      </div>
                      <div className="num text-xl font-black text-foreground">
                        {formatUyu(opt.bundlePrice)}
                      </div>
                      <div className="text-[11px] text-muted">
                        ({formatUyu(opt.effectiveUnitPrice)} / unidad)
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Ganancia neta total:</span>
                        <strong className="num font-bold text-emerald-600 dark:text-emerald-400">
                          {formatUyu(opt.bundleAnalysis.netProfit)}
                        </strong>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted">Margen Neto:</span>
                        <span className="num font-bold text-foreground">
                          {formatPct(opt.bundleAnalysis.netMargin)}
                        </span>
                      </div>

                      {opt.fixedFeeSavings > 0 && (
                        <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                          <span>Ahorro cargo fijo:</span>
                          <span className="num font-bold">+{formatUyu(opt.fixedFeeSavings)}</span>
                        </div>
                      )}

                      {opt.extraNetProfitUyu > 0 && (
                        <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 font-semibold">
                          <span>Extra en bolsillo:</span>
                          <span className="num font-bold">+{formatUyu(opt.extraNetProfitUyu)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onApplyBundle(
                        opt.bundlePrice,
                        `${inputs.productName || "Producto"} (${opt.label})`
                      )
                    }
                    className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-3 py-2 text-xs font-black uppercase tracking-wider text-foreground transition-all cursor-pointer shadow-xs active:scale-98"
                  >
                    <span>Simular {opt.label.split(" ")[0]}</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
