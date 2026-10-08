"use client";

import { SlidersHorizontal } from "lucide-react";
import { GATEWAYS, ML_DEFAULT_RATES, ML_RATE_RANGES, URUGUAY_CARRIERS } from "@/lib/finance/constants";
import type { DirectChannelSettings, MlChannelSettings } from "@/lib/finance/types";
import { formatPct } from "@/lib/format";
import { NumberField } from "@/components/ui/NumberField";
import { Segmented } from "@/components/ui/Segmented";
import { InfoTip } from "@/components/ui/InfoTip";

/* ---------------------------------------------------------------- */
/* Mercado Libre                                                     */
/* ---------------------------------------------------------------- */

interface MlSettingsProps {
  value: MlChannelSettings;
  onChange: (patch: Partial<MlChannelSettings>) => void;
}

export function MlSettings({ value, onChange }: MlSettingsProps) {
  const isPremium = value.listingType === "premium";
  const rate = isPremium ? value.premiumRate : value.classicRate;
  const range = ML_RATE_RANGES[value.listingType];

  return (
    <div className="grid gap-4">
      <Segmented
        name="ml-listing-type"
        legend="Tipo de publicación"
        value={value.listingType}
        onChange={(listingType) => onChange({ listingType })}
        options={[
          { value: "classic", label: "Clásica" },
          { value: "premium", label: "Premium" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          id="ml-commission-rate"
          label={
            <>
              Comisión {isPremium ? "Premium" : "Clásica"}
              <InfoTip label="Sobre la comisión de Mercado Libre">
                Rango típico {formatPct(range.min * 100)} – {formatPct(range.max * 100)} según categoría. Ajustala a la de tu rubro.
              </InfoTip>
            </>
          }
          value={Number((rate * 100).toFixed(2))}
          onChange={(v) => onChange(isPremium ? { premiumRate: v / 100 } : { classicRate: v / 100 })}
          max={60}
          suffix={<span className="pr-2 text-sm text-muted">%</span>}
          hint={`Predeterminado ${formatPct(ML_DEFAULT_RATES[value.listingType] * 100)}`}
        />
        <Segmented
          name="ml-shipping-mode"
          legend="Mercado Envíos"
          value={value.shippingMode}
          onChange={(shippingMode) => onChange({ shippingMode })}
          size="sm"
          options={[
            { value: "buyer", label: "Paga comprador" },
            { value: "seller", label: "Envío gratis" },
          ]}
        />
      </div>

      {value.shippingMode === "seller" && (
        <div className="space-y-2">
          <NumberField
            id="ml-shipping-cost"
            label="Costo de envío gratis (absorbido por vos)"
            value={value.sellerShippingCost}
            onChange={(sellerShippingCost) => onChange({ sellerShippingCost })}
            prefix="$U"
            hint="Estimado según peso volumétrico en Mercado Envíos UY."
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted mr-1">Tramos MLU:</span>
            {[
              { label: "Ligero (<1kg)", cost: 180 },
              { label: "Estándar (1-3kg)", cost: 210 },
              { label: "Mediano (3-5kg)", cost: 245 },
            ].map((t) => (
              <button
                key={t.cost}
                type="button"
                onClick={() => onChange({ sellerShippingCost: t.cost })}
                className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                  value.sellerShippingCost === t.cost
                    ? "border-brand bg-brand-soft text-brand-strong"
                    : "border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground"
                }`}
              >
                {t.label} ($U {t.cost})
              </button>
            ))}
          </div>
        </div>
      )}

      <details className="group rounded-xl border border-dashed border-border px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted">
          <SlidersHorizontal className="size-3.5" aria-hidden /> Cargo fijo por venta de bajo valor
        </summary>
        <div className="mt-3 grid gap-3 pb-1 sm:grid-cols-2">
          <NumberField
            id="ml-fixed-fee-threshold"
            label="Aplica a ventas menores a"
            value={value.fixedFeeThreshold}
            onChange={(fixedFeeThreshold) => onChange({ fixedFeeThreshold })}
            prefix="$U"
          />
          <NumberField
            id="ml-fixed-fee"
            label="Cargo fijo por unidad"
            value={value.fixedFee}
            onChange={(fixedFee) => onChange({ fixedFee })}
            prefix="$U"
          />
        </div>
      </details>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Tienda propia                                                     */
/* ---------------------------------------------------------------- */

interface DirectSettingsProps {
  value: DirectChannelSettings;
  onChange: (patch: Partial<DirectChannelSettings>) => void;
}

export function DirectSettings({ value, onChange }: DirectSettingsProps) {
  return (
    <div className="grid gap-4">
      <fieldset>
        <legend className="field-label">Pasarela de pago</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(GATEWAYS) as (keyof typeof GATEWAYS)[]).map((key) => {
            const g = GATEWAYS[key];
            return (
              <label
                key={key}
                className="flex cursor-pointer flex-col rounded-xl border border-border bg-surface-2 px-3 py-2.5 transition-colors hover:border-border-strong has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand"
              >
                <input
                  type="radio"
                  name="direct-gateway"
                  value={key}
                  checked={value.gateway === key}
                  onChange={() => onChange({ gateway: key })}
                  className="visually-hidden"
                />
                <span className="text-sm font-semibold">{g.label}</span>
                <span className="text-[0.7rem] leading-tight text-muted">{g.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Segmented
          name="direct-shipping-mode"
          legend="Envío local (DAC, Mirtrans, cadetería)"
          value={value.shippingMode}
          onChange={(shippingMode) => onChange({ shippingMode })}
          size="sm"
          options={[
            { value: "buyer", label: "Paga comprador" },
            { value: "seller", label: "Lo pago yo" },
          ]}
        />
        {value.shippingMode === "seller" && (
          <div className="space-y-2">
            <NumberField
              id="direct-shipping-cost"
              label="Costo por envío local"
              value={value.shippingCost}
              onChange={(shippingCost) => onChange({ shippingCost })}
              prefix="$U"
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted mr-1">Tarifas UY:</span>
              {URUGUAY_CARRIERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ shippingCost: c.defaultCost })}
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                    value.shippingCost === c.defaultCost
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-border bg-surface hover:bg-surface-2 text-muted hover:text-foreground"
                  }`}
                  title={c.note}
                >
                  {c.name.split(" ")[0]} ($U {c.defaultCost})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
