"use client";

import { useState } from "react";
import {
  Building2,
  Landmark,
  Store,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Percent,
  Clock,
  RotateCcw,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { formatUsd, formatUyu, formatPct } from "@/lib/format";
import type { AnalysisInputs, TaxSettings } from "@/lib/finance/types";
import type { UnitCosts } from "@/lib/finance/engine";
import { NumberField } from "@/components/ui/NumberField";
import { CurrencyToggle } from "@/components/ui/Segmented";
import { InfoTip } from "@/components/ui/InfoTip";
import { StepHeader } from "@/components/ui/StepHeader";

interface CostPanelProps {
  inputs: AnalysisInputs;
  costs: UnitCosts;
  onChange: (patch: Partial<AnalysisInputs>) => void;
  onTaxChange: (patch: Partial<TaxSettings>) => void;
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-2">
      <input
        id={id}
        name={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer visually-hidden"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white dark:after:bg-zinc-900 after:shadow after:transition-transform peer-checked:after:translate-x-4"
      />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function CostPanel({ inputs, costs, onChange, onTaxChange }: CostPanelProps) {
  const { tax } = inputs;
  const [showAdvancedRealism, setShowAdvancedRealism] = useState(false);

  const currentVatRate = typeof tax.vatRate === "number" ? tax.vatRate : 0.22;
  const returnRate = inputs.returnRatePct || 0;
  const shrinkageRate = inputs.shrinkageRatePct || 0;
  const turnoverDays = inputs.stockTurnoverDays || 0;

  return (
    <section aria-labelledby="cost-heading" className="card card-pad">
      <StepHeader step="01" id="cost-heading" title="Costo mayorista y régimen DGI" aside="Lo que pagás" />

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          id="wholesale-cost"
          label="Costo mayorista por unidad"
          value={inputs.cost.amount}
          onChange={(amount) => onChange({ cost: { ...inputs.cost, amount } })}
          suffix={
            <CurrencyToggle
              name="cost-currency"
              label="Moneda del costo"
              value={inputs.cost.currency}
              onChange={(currency) => onChange({ cost: { ...inputs.cost, currency } })}
            />
          }
          hint={
            inputs.cost.currency === "USD"
              ? `≈ ${formatUyu(costs.merchandise)} al cambio ${inputs.exchangeRate.toFixed(2)}`
              : inputs.exchangeRate > 0
                ? `≈ ${formatUsd(costs.merchandise / inputs.exchangeRate)}`
                : undefined
          }
        />

        <NumberField
          id="acquisition-freight"
          label={
            <>
              Flete de adquisición <span className="text-xs font-normal text-faint">(por unidad)</span>
            </>
          }
          value={inputs.freight.amount}
          onChange={(amount) => onChange({ freight: { ...inputs.freight, amount } })}
          suffix={
            <CurrencyToggle
              name="freight-currency"
              label="Moneda del flete"
              value={inputs.freight.currency}
              onChange={(currency) => onChange({ freight: { ...inputs.freight, currency } })}
            />
          }
          hint={`Costo puesto: ${formatUyu(costs.landed)}`}
        />

        <div className="sm:col-span-2">
          <label htmlFor="product-name" className="field-label">
            Nombre interno del producto <span className="text-xs font-normal text-faint">(opcional)</span>
          </label>
          <input
            id="product-name"
            name="product-name"
            type="text"
            autoComplete="off"
            maxLength={120}
            placeholder="Ej: Auriculares F9 · Proveedor Montevideo"
            value={inputs.productName}
            onChange={(e) => onChange({ productName: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="field-label">
          Régimen tributario DGI
          <InfoTip label="Sobre los regímenes">
            <strong>Literal E / Pequeña empresa (DGI):</strong> No discriminás IVA en tus ventas (se considera exento hacia el consumidor final) y el IVA de tus compras es costo (sin crédito fiscal). Pagás una cuota fija mensual independientemente de la venta unitaria.
            <br /><br />
            <strong>Régimen General (DGI):</strong> IVA 22% (o tasa aplicable) — debitás IVA en la venta y descontás crédito fiscal de facturas de compra y servicios con tu RUT.
            <br /><br />
            <em>Nota: Monotributo y Monotributo Social son regímenes de BPS/DGI independientes para actividades de reducida dimensión económica.</em>
          </InfoTip>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                value: "literal_e",
                title: "Literal E (Pequeña Empresa DGI)",
                desc: "IVA de compras es costo · ventas sin IVA discriminado",
                Icon: Store,
              },
              {
                value: "general",
                title: "Régimen General",
                desc: "IRAE + IVA con crédito fiscal de compras y servicios",
                Icon: Building2,
              },
            ] as const
          ).map(({ value, title, desc, Icon }) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3.5 transition-colors hover:border-border-strong has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
            >
              <input
                type="radio"
                name="tax-regime"
                value={value}
                checked={tax.regime === value}
                onChange={() => onTaxChange({ regime: value })}
                className="visually-hidden"
              />
              <Icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-muted">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {tax.regime === "general" && (
        <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-2/60 p-3.5 animate-rise">
          <p className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted">
            <Landmark className="size-3.5" aria-hidden /> Opciones de IVA / IRAE (Régimen General)
          </p>

          {/* Selector de Tasa de IVA del Producto */}
          <div className="px-1 py-1">
            <label className="text-xs font-medium text-fg block mb-1.5">
              Tasa de IVA del Producto (DGI)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { rate: 0.22, label: "22% Básica", sub: "General / Bazar" },
                { rate: 0.10, label: "10% Mínima", sub: "Canasta / Salud" },
                { rate: 0.00, label: "0% Exento", sub: "Libros / Básicos" },
              ].map(({ rate, label, sub }) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => onTaxChange({ vatRate: rate })}
                  className={`px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                    Math.abs(currentVatRate - rate) < 0.001
                      ? "border-brand bg-brand-soft text-brand font-semibold"
                      : "border-border bg-surface-1 hover:border-border-strong text-muted"
                  }`}
                >
                  <span className="block text-xs leading-tight">{label}</span>
                  <span className="block text-[10px] opacity-75">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <Toggle
            id="cost-includes-vat"
            checked={tax.costIncludesVat}
            onChange={(v) => onTaxChange({ costIncludesVat: v })}
            label="Mi proveedor emite e-factura con RUT (Crédito Fiscal)"
            hint="Descontás el IVA de compra del débito fiscal. Si comprás sin factura o boleta común, desactivalo."
          />
          <Toggle
            id="fees-with-rut"
            checked={tax.feesInvoicedWithRut}
            onChange={(v) => onTaxChange({ feesInvoicedWithRut: v })}
            label="Comisiones y envíos facturados a mi RUT"
            hint="El IVA de comisiones de ML, pasarelas y fletes genera crédito fiscal compensable."
          />
          <Toggle
            id="provision-irae"
            checked={tax.provisionIrae}
            onChange={(v) => onTaxChange({ provisionIrae: v })}
            label={`Provisionar IRAE (${Math.round(tax.iraeRate * 100)}%) sobre la utilidad`}
            hint="Estimación conservadora por unidad; el IRAE real se liquida anualmente con costos fijos y deducciones."
          />
        </div>
      )}

      {/* Accordion: Parámetros de Realismo Financiero */}
      <div className="mt-4 pt-3 border-t border-border">
        <button
          type="button"
          onClick={() => setShowAdvancedRealism(!showAdvancedRealism)}
          className="flex w-full items-center justify-between py-1 text-xs font-semibold text-muted hover:text-fg transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="size-3.5 text-brand" />
            <span>Factores de Realismo Financiero (Mermas, Devoluciones y Rotación)</span>
            {(returnRate > 0 || shrinkageRate > 0 || turnoverDays > 0) && (
              <span className="inline-block size-2 rounded-full bg-brand" />
            )}
          </span>
          {showAdvancedRealism ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {showAdvancedRealism && (
          <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2/40 p-3.5 animate-rise text-xs">
            <p className="text-muted leading-relaxed">
              Ajustá variables operativas reales del mercado uruguayo para evitar márgenes teóricos ficticios.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="return-rate" className="field-label text-xs">
                  % Devoluciones / Reclamos
                </label>
                <div className="relative mt-1">
                  <input
                    id="return-rate"
                    type="number"
                    min="0"
                    max="30"
                    step="0.5"
                    placeholder="Ej: 3"
                    value={returnRate || ""}
                    onChange={(e) =>
                      onChange({ returnRatePct: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="input py-1.5 text-xs pr-7"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[11px] font-bold">
                    %
                  </span>
                </div>
                <span className="text-[10px] text-faint block mt-1">Típico e-comm: 3% a 6%</span>
              </div>

              <div>
                <label htmlFor="shrinkage-rate" className="field-label text-xs">
                  % Mermas / Roturas / Garantía
                </label>
                <div className="relative mt-1">
                  <input
                    id="shrinkage-rate"
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    placeholder="Ej: 1.5"
                    value={shrinkageRate || ""}
                    onChange={(e) =>
                      onChange({ shrinkageRatePct: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="input py-1.5 text-xs pr-7"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[11px] font-bold">
                    %
                  </span>
                </div>
                <span className="text-[10px] text-faint block mt-1">Vidrio/electrónica: 1% a 3%</span>
              </div>

              <div>
                <label htmlFor="turnover-days" className="field-label text-xs">
                  Rotación de Stock (Días)
                </label>
                <div className="relative mt-1">
                  <input
                    id="turnover-days"
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    placeholder="Ej: 45"
                    value={turnoverDays || ""}
                    onChange={(e) =>
                      onChange({ stockTurnoverDays: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="input py-1.5 text-xs pr-9"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[11px] font-bold">
                    días
                  </span>
                </div>
                <span className="text-[10px] text-faint block mt-1">Calcula el ROI Anualizado</span>
              </div>
            </div>

            {turnoverDays > 0 && (
              <div className="mt-2 rounded-lg bg-surface-1 border border-border p-2.5 flex items-center justify-between">
                <span className="text-muted flex items-center gap-1.5">
                  <Clock className="size-3.5 text-brand" />
                  <span>Vueltas de inventario al año:</span>
                </span>
                <span className="font-semibold text-fg">
                  {(365 / turnoverDays).toFixed(1)} ciclos anuales
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
