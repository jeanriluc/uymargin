import { ChevronDown, Scale, Target, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { formatPct, formatUsd, formatUyu } from "@/lib/format";
import type { ChannelResult, TaxRegime } from "@/lib/finance/types";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ViabilityBadge } from "@/components/ui/ViabilityBadge";
import { WaterfallChart } from "./WaterfallChart";

interface ChannelCardProps {
  result: ChannelResult;
  icon: ReactNode;
  subtitle: string;
  settings: ReactNode;
  regime: TaxRegime;
  isWinner: boolean;
}

function StatBox({
  label,
  value,
  subtext,
}: {
  label: string;
  value: ReactNode;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col justify-between rounded-md border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/60 p-3">
      <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="num text-base font-black tracking-tight mt-1 text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      {subtext && <span className="text-[9px] font-semibold text-zinc-400 mt-0.5">{subtext}</span>}
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: ReactNode;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-xs ${
        strong ? "font-black text-black dark:text-white" : ""
      } ${muted ? "text-zinc-500" : ""}`}
    >
      <span className="uppercase text-[11px] tracking-wide">{label}</span>
      <span className={`num font-bold ${strong ? "text-sm font-black" : ""}`}>{formatUyu(value)}</span>
    </div>
  );
}

export function ChannelCard({
  result: r,
  icon,
  subtitle,
  settings,
  regime,
  isWinner,
}: ChannelCardProps) {
  const hasPrice = r.salePrice > 0;

  return (
    <article
      className={`flex flex-col rounded-xl border transition-all duration-200 shadow-sm overflow-hidden bg-white dark:bg-[#121214] ${
        isWinner && hasPrice
          ? "border-black dark:border-white ring-1 ring-black dark:ring-white"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {/* Top Banner Accent in solid black */}
      <div className="h-1 w-full bg-black dark:bg-white" />

      <div className="p-6 flex flex-col gap-5 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 items-center justify-center rounded-md bg-black text-white dark:bg-white dark:text-black font-black">
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="heading-grotesk text-base font-black tracking-tight uppercase text-zinc-900 dark:text-zinc-100">
                  {r.label}
                </h3>
                {isWinner && hasPrice && (
                  <span className="inline-flex items-center gap-1 bg-black text-white dark:bg-white dark:text-black px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded">
                    <Trophy className="size-2.5" /> RECOMENDADO
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
            </div>
          </div>

          {hasPrice && <ViabilityBadge viability={r.viability} compact />}
        </div>

        {/* Channel parameter toggles */}
        {settings}

        {/* Hero KPI: Ganancia Neta Líquida */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-1">
            <span>Ganancia Neta Líquida por Unidad</span>
            {hasPrice && (
              <span className="font-semibold text-zinc-400">
                IVA & Deducciones Incluidas
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-3">
            <p className="num text-3xl sm:text-4xl font-black tracking-tight text-black dark:text-white">
              <AnimatedNumber value={r.netProfit} format={formatUyu} />
            </p>
            <p className="num text-sm font-bold text-zinc-400">
              ≈ <AnimatedNumber value={r.netProfitUsd} format={formatUsd} />
            </p>
          </div>
        </div>

        {/* 4 Financial Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatBox
            label="MARGEN NETO"
            value={<AnimatedNumber value={r.netMargin} format={formatPct} />}
            subtext="Ganancia ÷ Venta"
          />
          <StatBox
            label="MARGEN BRUTO"
            value={<AnimatedNumber value={r.grossMargin} format={formatPct} />}
            subtext="Bruto unitario"
          />
          <StatBox
            label="RETORNO (ROI)"
            value={<AnimatedNumber value={r.roi} format={formatPct} />}
            subtext="Utilidad ÷ Costo"
          />
          <StatBox
            label="PTO. EQUILIBRIO"
            value={r.breakEvenPrice !== null ? formatUyu(r.breakEvenPrice) : "—"}
            subtext="Venta mínima $0"
          />
        </div>

        {/* Additional channel indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
            <Scale className="size-3" />
            <span>Comisión efectiva: {formatPct(r.effectiveFeeRate * 100)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
            <Target className="size-3" />
            <span>Precio para 30% neto: {r.targetMarginPrice !== null ? formatUyu(r.targetMarginPrice) : "—"}</span>
          </span>
        </div>

        {/* Waterfall Chart */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
            <span>Cascada de Rentabilidad</span>
            <span className="text-[10px] font-normal text-zinc-400">Desglose secuencial</span>
          </div>
          <WaterfallChart id={`${r.channel}-waterfall`} steps={r.waterfall} />
        </div>

        {/* Detailed Breakdown Accordion */}
        <details className="group rounded-md border border-zinc-200 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/30">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white">
            <span>Auditoría Impositiva & Deducciones DGI</span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 space-y-1 divide-y divide-zinc-200/60 dark:divide-zinc-800">
            <BreakdownRow label="Precio Venta Bruto" value={r.salePrice} strong />
            <BreakdownRow label="Costo Puesto (Mercadería + Flete)" value={-r.productCost} muted />
            {r.commission > 0 && (
              <BreakdownRow
                label={`Comisión ML (${formatPct(r.effectiveFeeRate * 100)})`}
                value={-r.commission}
                muted
              />
            )}
            {r.fixedFee > 0 && <BreakdownRow label="Cargo Fijo ML por Unidad" value={-r.fixedFee} muted />}
            {r.channel === "direct" && (
              <BreakdownRow
                label={`Comisión Pasarela (${formatPct(r.effectiveFeeRate * 100)})`}
                value={-r.gatewayFee}
                muted
              />
            )}
            {r.shipping > 0 && (
              <BreakdownRow label="Logística asumida por el vendedor" value={-r.shipping} muted />
            )}

            {regime === "general" ? (
              <>
                <BreakdownRow label="IVA Débito Fiscal Ventas (22%)" value={-r.taxes.vatDebit} muted />
                <BreakdownRow label="IVA Crédito Fiscal Compras" value={r.taxes.vatCreditCost} muted />
                <BreakdownRow label="IVA Crédito Fiscal Comisiones/Servicios" value={r.taxes.vatCreditServices} muted />
                <BreakdownRow
                  label={r.taxes.vatPayable < 0 ? "IVA Saldo a Favor DGI" : "IVA a Pagar DGI"}
                  value={-r.taxes.vatPayable}
                  strong
                />
                {r.taxes.irae > 0 && <BreakdownRow label="Provisión Estimada IRAE" value={-r.taxes.irae} muted />}
              </>
            ) : (
              <BreakdownRow
                label="Impuesto Unitario (Literal E mensual fijo)"
                value={0}
                muted
              />
            )}

            <div className="pt-1.5">
              <BreakdownRow label="Ganancia Neta Final Líquida" value={r.netProfit} strong />
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}
