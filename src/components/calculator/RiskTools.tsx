import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, ChevronUp, Layers, TrendingUp } from "lucide-react";
import { ViabilityBadge } from "@/components/ui/ViabilityBadge";
import { createDirectModel, createMlModel, type ChannelModel } from "@/lib/finance/channels";
import { VIABILITY_LABELS, VIABILITY_THRESHOLDS } from "@/lib/finance/constants";
import type { MultichannelAnalysis } from "@/lib/finance/engine";
import {
  CYBER_LABEL,
  CYBER_SCENARIO,
  DEFAULT_SCENARIOS,
  SCENARIO_LABELS,
  SCENARIO_PCT_RANGE,
  clampScenarioPct,
  isSameScenario,
  runScenario,
  type Scenario,
} from "@/lib/finance/scenarios";
import {
  BREAK_EVEN_RATE_LIMIT,
  breakEvenExchangeRate,
  dollarSensitivity,
  tightExchangeRate,
  type RateThreshold,
} from "@/lib/finance/sensitivity";
import type { AnalysisInputs } from "@/lib/finance/types";
import { formatPct, formatRate, formatUyu } from "@/lib/format";

interface RiskToolsProps {
  inputs: AnalysisInputs;
  analysis: MultichannelAnalysis;
  bestChannel: "ml" | "direct";
  /** Hay montos en dólares y no hay cotización. */
  rateMissing?: boolean;
}

const signedPct = (value: number) => `${value > 0 ? "+" : ""}${formatPct(value)}`;
const dollar = (rate: number) => `$ ${formatRate(rate)}`;

function Collapsible({ title, Icon, children }: { title: string; Icon: typeof TrendingUp; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
          <Icon className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
          {title}
        </span>
        {open ? <ChevronUp className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
      </button>
      {/* El contenido se calcula recién al abrir. */}
      {open && (
        <div id={panelId} className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-4 animate-in fade-in duration-200">
          {children()}
        </div>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">{children}</p>;
}

/** Qué falta para poder calcular, o null si está todo. */
function missingData(inputs: AnalysisInputs, analysis: MultichannelAnalysis, rateMissing: boolean): string | null {
  if (rateMissing) return "Falta la cotización del dólar. Cargala arriba para ver este análisis.";
  if (!(analysis.costs.landed > 0) && !(inputs.salePrice > 0)) return "Cargá el costo y el precio de venta para ver este análisis.";
  if (!(analysis.costs.landed > 0)) return "Cargá el costo del producto para ver este análisis.";
  if (!(inputs.salePrice > 0)) return "Cargá el precio de venta para ver este análisis.";
  return null;
}

function breakEvenSentence(be: RateThreshold, currentRate: number): { tone: "ok" | "warn" | "bad"; text: ReactNode } {
  if (be.rate !== null && be.deltaPct !== null && !be.alreadyBelow) {
    return {
      tone: be.deltaPct < 10 ? "warn" : "ok",
      text: (
        <>
          Si el dólar sube a <strong className="num">{dollar(be.rate)}</strong> ({signedPct(be.deltaPct)}), este producto deja de dar ganancia.
        </>
      ),
    };
  }
  if (be.rate !== null && be.deltaPct !== null) {
    return {
      tone: "bad",
      text: (
        <>
          Ya perdés plata al dólar actual ({dollar(currentRate)}). Recién deja de perder si el dólar baja a{" "}
          <strong className="num">{dollar(be.rate)}</strong> ({signedPct(be.deltaPct)}).
        </>
      ),
    };
  }
  if (be.reason === "never_within_limit") {
    return { tone: "ok", text: `Aunque el dólar se multiplique por ${BREAK_EVEN_RATE_LIMIT}, este producto sigue dando ganancia.` };
  }
  if (be.reason === "below_at_any_rate") {
    return { tone: "bad", text: "Perdés plata aunque el dólar baje a cero: el problema no es el dólar, son los costos en pesos." };
  }
  return { tone: "ok", text: "No se pudo calcular el dólar de quiebre." };
}

const TONE_CLASS = {
  ok: "border-emerald-500/30 bg-emerald-500/5",
  warn: "border-amber-500/40 bg-amber-500/10",
  bad: "border-red-500/30 bg-red-500/5",
} as const;

function DollarSensitivity({ inputs, model, otherModel, channelLabel, otherLabel }: {
  inputs: AnalysisInputs;
  model: ChannelModel;
  otherModel: ChannelModel;
  channelLabel: string;
  otherLabel: string;
}) {
  const be = breakEvenExchangeRate(model, inputs);
  if (be.reason === "cost_in_uyu") {
    return <EmptyState>Tu costo está en pesos: el dólar no cambia este resultado.</EmptyState>;
  }
  const sentence = breakEvenSentence(be, inputs.exchangeRate);
  const tight = tightExchangeRate(model, inputs);
  const otherBe = breakEvenExchangeRate(otherModel, inputs);
  const rows = dollarSensitivity(model, inputs);

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-3 ${TONE_CLASS[sentence.tone]}`}>
        <span className="block text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
          Dólar de quiebre · {channelLabel}
        </span>
        <p className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100 text-balance">{sentence.text}</p>
        {tight.rate !== null && tight.deltaPct !== null && !tight.alreadyBelow && (
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Antes de eso, a <span className="num font-bold">{dollar(tight.rate)}</span> ({signedPct(tight.deltaPct)}) pasa de «
            {VIABILITY_LABELS.good}» a «{VIABILITY_LABELS.tight}» (margen neto menor a {VIABILITY_THRESHOLDS.goodMargin}%).
          </p>
        )}
      </div>

      <table className="w-full text-left text-xs">
        <caption className="visually-hidden">Resultado en {channelLabel} según el valor del dólar</caption>
        <thead>
          <tr className="text-[11px] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            <th scope="col" className="py-1.5 pr-2 font-black">Dólar</th>
            <th scope="col" className="py-1.5 px-2 text-right font-black">Ganancia</th>
            <th scope="col" className="py-1.5 px-2 text-right font-black">Margen</th>
            <th scope="col" className="py-1.5 pl-2 text-right font-black">Semáforo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.deltaPct} className={row.deltaPct === 0 ? "bg-zinc-50 dark:bg-zinc-900/40" : undefined}>
              <th scope="row" className="py-2 pr-2 font-bold text-zinc-900 dark:text-zinc-100">
                <span className="num block">{dollar(row.exchangeRate)}</span>
                <span className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                  {row.deltaPct === 0 ? "actual" : `${row.deltaPct > 0 ? "+" : "−"}${Math.abs(row.deltaPct)}%`}
                </span>
              </th>
              <td className={`py-2 px-2 text-right num font-bold ${row.netProfit > 0 ? "text-zinc-900 dark:text-zinc-100" : "text-red-600 dark:text-red-400"}`}>
                {formatUyu(row.netProfit)}
              </td>
              <td className="py-2 px-2 text-right num font-bold text-zinc-700 dark:text-zinc-300">{formatPct(row.netMargin)}</td>
              <td className="py-2 pl-2 text-right">
                <ViabilityBadge viability={row.viability} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {otherBe.rate !== null && otherBe.deltaPct !== null && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-bold">Referencia · {otherLabel}:</span>{" "}
          {otherBe.alreadyBelow ? "ya pierde plata al dólar actual; quiebra a " : "el dólar de quiebre es "}
          <span className="num font-bold">{dollar(otherBe.rate)}</span> ({signedPct(otherBe.deltaPct)}).
        </p>
      )}
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Se mueve solo el dólar; el precio de venta y lo demás quedan como están cargados.
      </p>
    </div>
  );
}

type EditableId = "pessimistic" | "optimistic";
type ScenarioDraft = Record<keyof Scenario, string>;

const toDraft = (s: Scenario): ScenarioDraft => ({
  priceDeltaPct: String(s.priceDeltaPct),
  exchangeDeltaPct: String(s.exchangeDeltaPct),
  shippingDeltaPct: String(s.shippingDeltaPct),
});
const parsePct = (text: string) => clampScenarioPct(Number(text.trim().replace(",", ".")));
const fromDraft = (draft: ScenarioDraft): Scenario => ({
  priceDeltaPct: parsePct(draft.priceDeltaPct),
  exchangeDeltaPct: parsePct(draft.exchangeDeltaPct),
  shippingDeltaPct: parsePct(draft.shippingDeltaPct),
});
const defaultDrafts = (): Record<EditableId, ScenarioDraft> => ({
  pessimistic: toDraft(DEFAULT_SCENARIOS.pessimistic),
  optimistic: toDraft(DEFAULT_SCENARIOS.optimistic),
});

const FIELDS: Array<{ key: keyof Scenario; label: string }> = [
  { key: "priceDeltaPct", label: "Precio" },
  { key: "exchangeDeltaPct", label: "Dólar" },
  { key: "shippingDeltaPct", label: "Envío" },
];

function Scenarios({ inputs, model, channelLabel, drafts, setDrafts }: {
  inputs: AnalysisInputs;
  model: ChannelModel;
  channelLabel: string;
  drafts: Record<EditableId, ScenarioDraft>;
  setDrafts: Dispatch<SetStateAction<Record<EditableId, ScenarioDraft>>>;
}) {
  const fieldId = useId();

  const scenarios: Array<{ id: "pessimistic" | "base" | "optimistic"; scenario: Scenario }> = [
    { id: "pessimistic", scenario: fromDraft(drafts.pessimistic) },
    { id: "base", scenario: DEFAULT_SCENARIOS.base },
    { id: "optimistic", scenario: fromDraft(drafts.optimistic) },
  ];
  const isDefault =
    isSameScenario(scenarios[0].scenario, DEFAULT_SCENARIOS.pessimistic) && isSameScenario(scenarios[2].scenario, DEFAULT_SCENARIOS.optimistic);

  const setField = (id: EditableId, key: keyof Scenario, value: string) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Cómo te queda en <strong>{channelLabel}</strong> si cambian el precio, el dólar y el envío. Son simulaciones para comparar, no predicciones.
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        {scenarios.map(({ id, scenario }) => {
          const run = runScenario(model, inputs, scenario);
          const title = id === "pessimistic" && isSameScenario(scenario, CYBER_SCENARIO) ? CYBER_LABEL : SCENARIO_LABELS[id];
          return (
            <div key={id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3" data-scenario={id}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100">{title}</h4>
                <ViabilityBadge viability={run.result.viability} />
              </div>
              <p className="mt-2 text-zinc-900 dark:text-zinc-100">
                <span className={`num text-xl font-black ${run.result.netProfit > 0 ? "" : "text-red-600 dark:text-red-400"}`}>
                  {formatUyu(run.result.netProfit)}
                </span>{" "}
                <span className="num text-sm font-bold text-zinc-600 dark:text-zinc-400">({formatPct(run.result.netMargin)} del precio)</span>
              </p>
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400 num">
                Precio {formatUyu(run.salePrice)} · dólar {dollar(run.exchangeRate)} · envío {formatUyu(run.shipping)}
              </p>

              {id === "base" ? (
                <p className="mt-3 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Sin cambios: es tu resultado de hoy.</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {FIELDS.map(({ key, label }) => (
                    <label key={key} htmlFor={`${fieldId}-${id}-${key}`} className="block text-[11px] font-bold text-zinc-600 dark:text-zinc-400">
                      {label} %
                      <input
                        id={`${fieldId}-${id}-${key}`}
                        type="number"
                        inputMode="decimal"
                        min={SCENARIO_PCT_RANGE.min}
                        max={SCENARIO_PCT_RANGE.max}
                        step={1}
                        value={drafts[id][key]}
                        onChange={(e) => setField(id, key, e.target.value)}
                        onBlur={() => setField(id, key, String(parsePct(drafts[id][key])))}
                        className="num mt-1 block w-full min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Porcentajes entre {SCENARIO_PCT_RANGE.min}% y +{SCENARIO_PCT_RANGE.max}%: negativo baja, positivo sube. «Envío» es el que pagás vos en
        este canal; el flete de compra no cambia.
        {model.shipping === 0 && " Hoy en este canal el envío lo paga el comprador, así que ese porcentaje no mueve nada."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDrafts((prev) => ({ ...prev, pessimistic: toDraft(CYBER_SCENARIO) }))}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 cursor-pointer hover:border-black dark:hover:border-white"
        >
          {CYBER_LABEL}: ¿aguanta un 20% de descuento?
        </button>
        <button
          type="button"
          onClick={() => setDrafts(defaultDrafts())}
          disabled={isDefault}
          className="rounded-md px-3 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 underline underline-offset-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          Restaurar valores por defecto
        </button>
      </div>
    </div>
  );
}

/** Análisis de riesgo sobre el resultado: no cambia ningún número de la calculadora, solo la consulta con otros valores. */
export function RiskTools({ inputs, analysis, bestChannel, rateMissing = false }: RiskToolsProps) {
  // Ajustes de los escenarios: estado local (no se guarda en el historial ni en la nube).
  // Vive acá para que no se pierda al cerrar y volver a abrir el bloque.
  const [drafts, setDrafts] = useState(defaultDrafts);
  const missing = missingData(inputs, analysis, rateMissing);
  const mlModel = createMlModel(inputs.ml);
  const directModel = createDirectModel(inputs.direct);
  const model = bestChannel === "ml" ? mlModel : directModel;
  const otherModel = bestChannel === "ml" ? directModel : mlModel;

  return (
    <section aria-label="Análisis de riesgo" className="flex flex-col gap-3">
      <Collapsible title="Sensibilidad al dólar" Icon={TrendingUp}>
        {() =>
          missing ? (
            <EmptyState>{missing}</EmptyState>
          ) : (
            <DollarSensitivity inputs={inputs} model={model} otherModel={otherModel} channelLabel={model.label} otherLabel={otherModel.label} />
          )
        }
      </Collapsible>
      <Collapsible title="Escenarios" Icon={Layers}>
        {() => (missing ? <EmptyState>{missing}</EmptyState> : <Scenarios inputs={inputs} model={model} channelLabel={model.label} drafts={drafts} setDrafts={setDrafts} />)}
      </Collapsible>
    </section>
  );
}
