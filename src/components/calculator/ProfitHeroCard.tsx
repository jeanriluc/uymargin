"use client";

import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Trophy,
  Calculator,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  ArrowRight,
  Info,
  ChevronDown,
  ChevronUp,
  Percent,
  Sparkles,
} from "lucide-react";
import { formatUyu, formatPct, formatMoney } from "@/lib/format";
import type { MultichannelAnalysis } from "@/lib/finance/engine";
import type { ChannelResult, AnalysisInputs } from "@/lib/finance/types";

interface ProfitHeroCardProps {
  inputs: AnalysisInputs;
  analysis: MultichannelAnalysis;
  suggestedMarketPrice?: number | null;
  onSelectSalePrice?: (price: number) => void;
  onUpdateCostAmount: (cost: number) => void;
  onUpdateExchangeRate: (rate: number) => void;
}

export function ProfitHeroCard({
  inputs,
  analysis,
  suggestedMarketPrice,
  onSelectSalePrice,
  onUpdateCostAmount,
  onUpdateExchangeRate,
}: ProfitHeroCardProps) {
  const [showReverseCalc, setShowReverseCalc] = useState(false);
  const [targetMarginGoal, setTargetMarginGoal] = useState(20);
  const [stressTestedRate, setStressTestedRate] = useState<number | null>(null);

  const price = inputs.salePrice || 0;
  const isSaleSet = price > 0;

  // Determine winning channel and differential
  const mlProfit = analysis.ml.netProfit;
  const directProfit = analysis.direct.netProfit;
  const bestChannel = directProfit >= mlProfit ? "direct" : "ml";
  const winningResult = bestChannel === "direct" ? analysis.direct : analysis.ml;
  const losingResult = bestChannel === "direct" ? analysis.ml : analysis.direct;
  const profitDiff = Math.abs(winningResult.netProfit - losingResult.netProfit);

  // Human metric: Per $U 1,000 sold, how much goes into pocket
  const pocketPerThousand = isSaleSet
    ? Math.max(0, Math.round((winningResult.netMargin / 100) * 1000))
    : 0;

  // Risk badges detection
  const isLowTicket = price > 0 && price < 1200;
  const isCostUsd = inputs.cost.currency === "USD";
  const isTightMargin = winningResult.netMargin > 0 && winningResult.netMargin < 15;
  const isLosingMoney = winningResult.netProfit <= 0 && isSaleSet;
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

  // Currency stress testing
  const handleStressRate = (pct: number) => {
    const newRate = Number((inputs.exchangeRate * (1 + pct / 100)).toFixed(2));
    setStressTestedRate(newRate);
    onUpdateExchangeRate(newRate);
  };

  const handleResetRate = () => {
    setStressTestedRate(null);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-5 shadow-sm transition-all">
      {/* 1. TOP HEADER: Status Pill & Big Headline */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            {isLosingMoney ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-xs font-black text-red-600 dark:text-red-400 uppercase tracking-wider">
                <ShieldAlert className="size-3.5" /> No Viable (Pérdida Neta)
              </span>
            ) : isTightMargin ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-xs font-black text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                <AlertTriangle className="size-3.5" /> Margen Ajustado
              </span>
            ) : isSaleSet ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                <ShieldCheck className="size-3.5" /> Rentabilidad Positiva
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                Ingresá precio para simular
              </span>
            )}

            <span className="text-xs text-zinc-400 font-bold uppercase">· Nivel 1 Ejecutivo</span>
          </div>

          {/* Hero Profit Headline */}
          <div className="mt-2.5">
            <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight leading-tight">
              {isSaleSet ? (
                <>
                  Te quedan{" "}
                  <span className={`num ${isLosingMoney ? "text-red-600" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {formatUyu(winningResult.netProfit)}
                  </span>{" "}
                  en el bolsillo{" "}
                  <span className="text-lg sm:text-xl font-bold text-zinc-500">
                    ({formatPct(winningResult.netMargin)} del precio)
                  </span>
                </>
              ) : (
                "Simulador de Ganancia Líquida en Mano"
              )}
            </h2>

            {isSaleSet && !isLosingMoney && (
              <p className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-400 leading-relaxed">
                «Por cada <strong className="text-black dark:text-white">$U 1.000</strong> que vendés, ponés{" "}
                <strong className="text-emerald-600 dark:text-emerald-400">${pocketPerThousand}</strong> limpios en tu cuenta.»
              </p>
            )}

            {isLosingMoney && (
              <p className="mt-1 text-sm font-semibold text-red-600 dark:text-red-400 leading-relaxed">
                «Por cada unidad vendida perdés {formatUyu(Math.abs(winningResult.netProfit))}. Necesitás subir el precio o negociar costo con tu proveedor.»
              </p>
            )}

            {!isSaleSet && suggestedMarketPrice && suggestedMarketPrice > 0 ? (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-semibold">
                  Mediana en Mercado Libre: <strong>{formatUyu(suggestedMarketPrice)}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSalePrice?.(suggestedMarketPrice)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-black text-white dark:bg-white dark:text-black text-xs font-black uppercase tracking-wider cursor-pointer hover:opacity-90 shadow-2xs"
                >
                  <Sparkles className="size-3 text-amber-400" />
                  <span>Simular con este precio</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Recommended Channel Callout */}
        {isSaleSet && (
          <div className="shrink-0 rounded-xl bg-black text-white dark:bg-white dark:text-black p-4 flex sm:flex-col justify-between items-start gap-3 shadow-md min-w-[200px]">
            <div className="flex items-center gap-2">
              <Trophy className="size-4.5 text-amber-400 shrink-0" />
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-80 block">
                  Canal Ganador
                </span>
                <span className="text-xs font-black uppercase tracking-wider">
                  {bestChannel === "ml" ? "Mercado Libre UY" : "Tienda Propia / POS"}
                </span>
              </div>
            </div>

            <div className="border-t border-zinc-700 dark:border-zinc-300 pt-2 w-full">
              <span className="text-[10px] opacity-80 block">Diferencial a favor:</span>
              <span className="num font-black text-sm text-emerald-400 dark:text-emerald-600">
                +{formatUyu(profitDiff)} por unidad
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 2. SECOND ROW: Break-Even, Capital Recovery & Risk Chips */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Key Operational Thresholds */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">Precio Mínimo de Equilibrio</span>
            <span className="num font-black text-zinc-900 dark:text-zinc-100 text-sm">
              {formatUyu(winningResult.breakEvenPrice || 0)}
            </span>
          </div>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">Retorno s/ Inversión (ROI)</span>
            <span className="num font-black text-zinc-900 dark:text-zinc-100 text-sm">
              {formatPct(winningResult.roi)}
            </span>
          </div>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

          <div>
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">Régimen DGI Activo</span>
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              {inputs.tax.regime === "literal_e" ? "Literal E (Pequeña Empresa)" : `Régimen General (${Math.round((inputs.tax.vatRate ?? 0.22) * 100)}%)`}
            </span>
          </div>

          {winningResult.annualizedRoi ? (
            <>
              <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />
              <div>
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">
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
          {winningResult.reservesCost && winningResult.reservesCost > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase"
              title="Reserva estimada descontada por posibles mermas y devoluciones"
            >
              📦 Reserva: -{formatUyu(winningResult.reservesCost)}
            </span>
          ) : null}

          {isLowTicket && (
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[10px] font-black text-amber-700 dark:text-amber-300 uppercase"
              title="Ventas menores a $U 1.200 pagan cargo fijo unitario en Mercado Libre"
            >
              ⚠ Ticket &lt; $U 1.200 (Cargo Fijo MLU)
            </span>
          )}

          {hasNoVatCredit && (
            <span
              className="inline-flex items-center gap-1 rounded bg-red-500/10 border border-red-500/20 px-2 py-1 text-[10px] font-black text-red-700 dark:text-red-300 uppercase"
              title="Sin e-factura con RUT no descuentas crédito fiscal de compras"
            >
              ⚠ Proveedor sin e-factura (Sin Crédito)
            </span>
          )}

          {isCostUsd && (
            <span
              className="inline-flex items-center gap-1 rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 uppercase"
              title="Comprás en USD y vendés en $U: Expuesto a fluctuación cambiaria"
            >
              💵 Expuesto a Dólar
            </span>
          )}
        </div>
      </div>

      {/* 3. STRESS TEST & REVERSE NEGOTIATION CALCULATOR TOGGLE */}
      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        {/* USD Stress Test Buttons */}
        {isCostUsd && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[10px] text-zinc-500 font-bold uppercase">Test de Estrés Cambiario:</span>
            <button
              onClick={() => handleStressRate(5)}
              className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:border-black dark:hover:border-white text-[10px] font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              title="Simular escenario con Dólar subiendo 5% en Uruguay"
            >
              +5% USD
            </button>
            <button
              onClick={() => handleStressRate(10)}
              className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:border-black dark:hover:border-white text-[10px] font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              title="Simular escenario con Dólar subiendo 10% en Uruguay"
            >
              +10% USD
            </button>
            {stressTestedRate && (
              <button
                onClick={handleResetRate}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold underline cursor-pointer"
              >
                Resetear cotización
              </button>
            )}
          </div>
        )}

        {/* Reverse Calculator Button */}
        <button
          onClick={() => setShowReverseCalc(!showReverseCalc)}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-black uppercase text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          <Calculator className="size-3.5" />
          <span>Calculadora Inversa: ¿Cuánto puedo pagarle al proveedor?</span>
          {showReverseCalc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {/* 4. EXPANDABLE: REVERSE NEGOTIATION CALCULATOR */}
      {showReverseCalc && (
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
              <span className="text-[10px] font-bold uppercase text-zinc-500 pl-2">Margen Deseado:</span>
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                Costo Máximo Admisible de Compra (Landed)
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-xl font-black text-zinc-900 dark:text-zinc-100 num">
                  {formatUyu(maxLandedCostUyu)}
                </span>
                <span className="text-sm font-bold text-zinc-500 num">
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
      <div className="mt-3 pt-2 text-[10px] text-zinc-400 font-medium flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800/60">
        <span>
          ⚠ Estimación analítica informativa. No reemplaza el asesoramiento de un contador profesional. Literal E y Monotributo son regímenes distintos ante DGI y BPS.
        </span>
      </div>
    </div>
  );
}
