"use client";

import { useState } from "react";
import {
  AlertTriangle,
  DollarSign,
  Package,
  Trophy,
  Calculator,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { formatUyu, formatPct, formatDecimal } from "@/lib/format";
import type { MultichannelAnalysis } from "@/lib/finance/engine";
import type { ChannelResult, AnalysisInputs } from "@/lib/finance/types";
import { StepHeader } from "@/components/ui/StepHeader";

export type VerdictTone = "loss" | "tight" | "good";

/** Traffic-light reading of a channel result, shared by the hero and the mobile sticky bar. */
export function verdictTone(result: ChannelResult): VerdictTone {
  if (result.netProfit <= 0) return "loss";
  if (result.netMargin < 15) return "tight";
  return "good";
}

function focusField(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus({ preventScroll: true });
}

interface ProfitHeroCardProps {
  id?: string;
  inputs: AnalysisInputs;
  analysis: MultichannelAnalysis;
  bestChannel: "ml" | "direct";
  /** Hay montos en dólares y no hay cotización: el resultado queda pendiente. */
  rateMissing?: boolean;
  /** Sale price that reaches the target net margin, when it can be computed. */
  targetMarginPrice?: number | null;
  onSelectSalePrice?: (price: number) => void;
  onUpdateCostAmount: (cost: number) => void;
  onUpdateExchangeRate: (rate: number) => void;
}

export function ProfitHeroCard({
  id,
  inputs,
  analysis,
  bestChannel,
  rateMissing = false,
  targetMarginPrice,
  onSelectSalePrice,
  onUpdateCostAmount,
  onUpdateExchangeRate,
}: ProfitHeroCardProps) {
  const [showReverseCalc, setShowReverseCalc] = useState(false);
  const [targetMarginGoal, setTargetMarginGoal] = useState(20);
  // Exchange rate before any stress test, so +5% / +10% never compound and can be undone.
  const [baseRate, setBaseRate] = useState<number | null>(null);
  const [stressPct, setStressPct] = useState<number | null>(null);

  const price = inputs.salePrice || 0;
  const hasPrice = price > 0;
  const hasCost = analysis.costs.landed > 0;
  const isReady = hasPrice && hasCost && !rateMissing;

  const winningResult = bestChannel === "direct" ? analysis.direct : analysis.ml;
  const losingResult = bestChannel === "direct" ? analysis.ml : analysis.direct;
  const profitDiff = Math.abs(winningResult.netProfit - losingResult.netProfit);

  // Human metric: Per $U 1,000 sold, how much goes into pocket
  const pocketPerThousand = isReady
    ? Math.max(0, Math.round((winningResult.netMargin / 100) * 1000))
    : 0;

  // Risk badges detection
  const isLowTicket = price > 0 && price < 1200;
  const isCostUsd = inputs.cost.currency === "USD";
  const tone = verdictTone(winningResult);
  const isTightMargin = isReady && tone === "tight";
  const isLosingMoney = isReady && tone === "loss";
  const hasNoVatCredit = inputs.tax.regime === "general" && !inputs.tax.costIncludesVat;

  // Reverse Negotiation Calculator: Max acquisition cost to achieve targetMarginGoal
  // Formula: Max Cost Landed = Price - Channel Fees - Shipping - Taxes - (TargetMargin * Price)
  const channelFeeEst = bestChannel === "ml"
    ? price * (inputs.ml.listingType === "premium" ? inputs.ml.premiumRate : inputs.ml.classicRate) + (price < inputs.ml.fixedFeeThreshold ? inputs.ml.fixedFee : 0)
    : price * 0.04;
  const shippingEst = bestChannel === "ml"
    ? (inputs.ml.shippingMode === "seller" ? inputs.ml.sellerShippingCost : 0)
    : (inputs.direct.shippingMode === "seller" ? inputs.direct.shippingCost : 0);
  
  const targetProfitAmount = (targetMarginGoal / 100) * price;
  const maxLandedCostUyu = Math.max(0, price - channelFeeEst - shippingEst - targetProfitAmount);
  const maxCostUsd = inputs.exchangeRate > 0 ? (maxLandedCostUyu / inputs.exchangeRate) : 0;

  // Currency stress testing, always computed from the pre-stress rate.
  const handleStressRate = (pct: number) => {
    const base = baseRate ?? inputs.exchangeRate;
    setBaseRate(base);
    setStressPct(pct);
    onUpdateExchangeRate(Number((base * (1 + pct / 100)).toFixed(2)));
  };

  const handleResetRate = () => {
    if (baseRate !== null) onUpdateExchangeRate(baseRate);
    setBaseRate(null);
    setStressPct(null);
  };

  const missing = rateMissing
    ? { pill: "Falta la cotización del dólar", field: "header-rate", action: "Ingresar cotización" }
    : !hasCost && !hasPrice
    ? { pill: "Faltan costo y precio", field: "wholesale-cost", action: "Cargar el costo" }
    : !hasCost
      ? { pill: "Falta el costo", field: "wholesale-cost", action: "Cargar el costo" }
      : !hasPrice
        ? { pill: "Falta el precio de venta", field: "sale-price", action: "Cargar el precio" }
        : null;

  return (
    <section
      id={id}
      aria-label="Resultado"
      className="scroll-mt-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-5 shadow-sm transition-all"
    >
      <StepHeader step="03" title="Resultado: lo que te queda limpio" />

      {/* 1. Status pill & big headline */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {missing ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                {missing.pill}
              </span>
            ) : isLosingMoney ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-xs font-black text-red-700 dark:text-red-400 uppercase tracking-wider">
                <ShieldAlert className="size-3.5" aria-hidden /> No Viable (Pérdida Neta)
              </span>
            ) : isTightMargin ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                <AlertTriangle className="size-3.5" aria-hidden /> Margen Ajustado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                <ShieldCheck className="size-3.5" aria-hidden /> Rentabilidad Positiva
              </span>
            )}
          </div>

          {/* Hero Profit Headline */}
          <div className="mt-2.5">
            <p className={`font-black text-zinc-900 dark:text-zinc-100 tracking-tight text-balance ${isReady ? "text-xl sm:text-2xl leading-snug" : "text-2xl sm:text-3xl leading-tight"}`}>
              {isReady ? (
                isLosingMoney ? (
                  <>
                    Perdés{" "}
                    <span className="num whitespace-nowrap align-baseline text-4xl sm:text-5xl leading-none text-red-600 dark:text-red-400">
                      {formatUyu(Math.abs(winningResult.netProfit))}
                    </span>{" "}
                    por unidad{" "}
                    <span className="whitespace-nowrap text-base sm:text-lg font-bold text-zinc-600 dark:text-zinc-400">
                      ({formatPct(winningResult.netMargin)} del precio)
                    </span>
                  </>
                ) : (
                  <>
                    Te quedan{" "}
                    <span className={`num whitespace-nowrap align-baseline text-4xl sm:text-5xl leading-none ${isTightMargin ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {formatUyu(winningResult.netProfit)}
                    </span>{" "}
                    en el bolsillo{" "}
                    <span className="whitespace-nowrap text-base sm:text-lg font-bold text-zinc-600 dark:text-zinc-400">
                      ({formatPct(winningResult.netMargin)} del precio)
                    </span>
                  </>
                )
              ) : rateMissing ? (
                "Falta la cotización del dólar: tu costo está en dólares y no se puede calcular"
              ) : !hasCost && !hasPrice ? (
                "Cargá el costo y el precio para ver cuánto te queda limpio"
              ) : !hasCost ? (
                "Cargá el costo mayorista para ver cuánto te queda limpio"
              ) : (
                "Cargá el precio de venta para ver cuánto te queda limpio"
              )}
            </p>

            {isReady && !isLosingMoney && (
              <p className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Por cada <strong className="text-black dark:text-white">$U 1.000</strong> que vendés, ponés{" "}
                <strong className="text-emerald-700 dark:text-emerald-400">{formatUyu(pocketPerThousand)}</strong> limpios en tu cuenta.
              </p>
            )}

            {isLosingMoney && (
              <p className="mt-1 text-sm font-semibold text-red-700 dark:text-red-400 leading-relaxed">
                Subí el precio o negociá el costo con tu proveedor antes de comprar.
              </p>
            )}

            {missing && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => focusField(missing.field)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-md bg-black text-white dark:bg-white dark:text-black text-xs font-black uppercase tracking-wider cursor-pointer hover:opacity-90"
                >
                  <span>{missing.action}</span>
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>

                {hasCost && !hasPrice && targetMarginPrice && targetMarginPrice > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectSalePrice?.(Math.round(targetMarginPrice))}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 underline underline-offset-2 hover:text-black dark:hover:text-white cursor-pointer"
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    <span>
                      O simular con <span className="num">{formatUyu(targetMarginPrice)}</span> (precio para 30% neto)
                    </span>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Recommended Channel Callout */}
        {isReady && (
          <div className="shrink-0 rounded-xl bg-black text-white dark:bg-white dark:text-black p-4 flex sm:flex-col justify-between items-start gap-3 shadow-md min-w-[200px]">
            <div className="flex items-center gap-2">
              <Trophy className="size-4.5 text-amber-400 dark:text-amber-600 shrink-0" aria-hidden />
              <div>
                <span className="text-[11px] font-black uppercase tracking-widest opacity-80 block">
                  Canal Ganador
                </span>
                <span className="text-xs font-black uppercase tracking-wider">
                  {bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia / POS"}
                </span>
              </div>
            </div>

            <div className="sm:border-t border-zinc-700 dark:border-zinc-300 sm:pt-2 sm:w-full text-right sm:text-left">
              <span className="text-[11px] opacity-80 block">Diferencia a favor:</span>
              <span className="font-black text-sm text-emerald-400 dark:text-emerald-700">
                <span className="num">+{formatUyu(profitDiff)}</span> por unidad
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. SECOND ROW: Break-Even, Capital Recovery & Risk Chips */}
      {hasCost && (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        {/* Key Operational Thresholds */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          <div>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block font-bold">Precio Mínimo de Equilibrio</span>
            <span className="num font-black text-zinc-900 dark:text-zinc-100 text-sm">
              {winningResult.breakEvenPrice ? formatUyu(winningResult.breakEvenPrice) : "—"}
            </span>
          </div>

          {isReady && (
            <>
              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

              <div>
                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block font-bold">Retorno s/ Inversión (ROI)</span>
                <span className="num font-black text-zinc-900 dark:text-zinc-100 text-sm">
                  {formatPct(winningResult.roi)}
                </span>
              </div>
            </>
          )}

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

          <div>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block font-bold">Régimen DGI Activo</span>
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              {inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : `Régimen General (${Math.round((inputs.tax.vatRate ?? 0.22) * 100)}%)`}
            </span>
          </div>

          {isReady && winningResult.annualizedRoi ? (
            <>
              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />
              <div>
                <span className="text-[11px] text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block font-bold">
                  ROI Anualizado ({inputs.stockTurnoverDays} d)
                </span>
                <span className="num font-black text-indigo-600 dark:text-indigo-400 text-sm">
                  {formatPct(winningResult.annualizedRoi)} / año
                </span>
              </div>
            </>
          ) : null}
        </div>

        {/* Risk & Opportunity Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isReady && winningResult.reservesCost && winningResult.reservesCost > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase"
              title="Reserva estimada descontada por posibles mermas y devoluciones"
            >
              <Package className="size-3" aria-hidden /> Reserva: {formatUyu(-winningResult.reservesCost)}
            </span>
          ) : null}

          {isLowTicket && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[11px] font-black text-amber-800 dark:text-amber-300 uppercase"
              title="Ventas menores a $U 1.200 pagan cargo fijo unitario en Mercado Libre"
            >
              <AlertTriangle className="size-3" aria-hidden /> Ticket &lt; $U 1.200 (Cargo Fijo MLU)
            </span>
          )}

          {hasNoVatCredit && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-500/10 border border-red-500/20 px-2 py-1 text-[11px] font-black text-red-700 dark:text-red-300 uppercase"
              title="Sin e-factura con RUT no descuentas crédito fiscal de compras"
            >
              <AlertTriangle className="size-3" aria-hidden /> Proveedor sin e-factura (Sin Crédito)
            </span>
          )}

          {isCostUsd && (
            <span
              className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 uppercase"
              title="Comprás en USD y vendés en $U: Expuesto a fluctuación cambiaria"
            >
              <DollarSign className="size-3" aria-hidden /> Expuesto a Dólar
            </span>
          )}
        </div>
      </div>
      )}

      {/* 3. STRESS TEST & REVERSE NEGOTIATION CALCULATOR TOGGLE */}
      {isReady && (
      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        {/* USD Stress Test Buttons */}
        {isCostUsd && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-bold uppercase">Si sube el dólar:</span>
            {[5, 10].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleStressRate(pct)}
                aria-pressed={stressPct === pct}
                className={`px-3 py-1.5 rounded border text-[11px] font-bold cursor-pointer transition-colors ${
                  stressPct === pct
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-black dark:hover:border-white text-zinc-700 dark:text-zinc-300"
                }`}
              >
                +{pct}%
              </button>
            ))}
            {baseRate !== null && (
              <>
                <span className="num text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                  Simulando a {formatDecimal(inputs.exchangeRate)}
                </span>
                <button
                  type="button"
                  onClick={handleResetRate}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold underline underline-offset-2 cursor-pointer"
                >
                  Volver a {formatDecimal(baseRate)}
                </button>
              </>
            )}
          </div>
        )}

        {/* Reverse Calculator Button */}
        <button
          type="button"
          onClick={() => setShowReverseCalc(!showReverseCalc)}
          aria-expanded={showReverseCalc}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-black uppercase text-left text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          <Calculator className="size-3.5 shrink-0" aria-hidden />
          <span>Calculadora Inversa: ¿Cuánto puedo pagarle al proveedor?</span>
          {showReverseCalc ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
        </button>
      </div>
      )}

      {/* 4. EXPANDABLE: REVERSE NEGOTIATION CALCULATOR */}
      {isReady && showReverseCalc && (
        <div className="mt-3 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h4 className="font-black text-xs uppercase text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-indigo-600" />
                <span>Negociación con Mayorista / Importador</span>
              </h4>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                Para vender al precio de mercado ({formatUyu(price)}) y asegurar tu objetivo de ganancia:
              </p>
            </div>

            {/* Target Margin Selector */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-1 rounded-lg">
              <span className="text-[11px] font-bold uppercase text-zinc-600 dark:text-zinc-400 pl-2">Margen Deseado:</span>
              {[15, 20, 25, 30].map((m) => (
                <button
                  key={m}
                  onClick={() => setTargetMarginGoal(m)}
                  className={`px-2 py-1 text-xs font-black rounded cursor-pointer transition-all ${
                    targetMarginGoal === m
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  {m}%
                </button>
              ))}
            </div>
          </div>

          {/* Result Card */}
          <div className="mt-3.5 p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 block">
                Costo Máximo Admisible de Compra (Landed)
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-xl font-black text-zinc-900 dark:text-zinc-100 num">
                  {formatUyu(maxLandedCostUyu)}
                </span>
                <span className="text-sm font-bold text-zinc-600 dark:text-zinc-400 num">
                  (≈ USD {maxCostUsd.toFixed(2)})
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                const targetUnitCost = isCostUsd ? Number(maxCostUsd.toFixed(2)) : Math.round(maxLandedCostUyu);
                onUpdateCostAmount(targetUnitCost);
              }}
              className="px-3.5 py-2 bg-black hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black text-xs font-black uppercase tracking-wider rounded-md transition-all cursor-pointer shadow-xs"
            >
              Aplicar este costo a la simulación
            </button>
          </div>
        </div>
      )}

      {/* 5. FOOTER: Fiscal Disclaimer */}
      <div className="mt-3 pt-2 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800/60">
        <span>
          Estimación analítica informativa. No reemplaza el asesoramiento de un contador profesional. Literal E y Monotributo son regímenes distintos ante DGI y BPS.
        </span>
      </div>
    </section>
  );
}
