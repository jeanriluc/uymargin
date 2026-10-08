import { ArrowLeftRight, Bot, RefreshCw, Settings, Wifi, WifiOff, Zap } from "lucide-react";
import type { ExchangeRateResponse } from "@/lib/mlu/types";
import { NumberField } from "@/components/ui/NumberField";
import { ThemeToggle } from "./ThemeToggle";

export type ConnectionStatus = "online" | "manual" | "offline" | "idle";

const STATUS: Record<ConnectionStatus, { label: string; badgeClass: string; Icon: typeof Wifi }> = {
  idle: { label: "MLU LISTO", badgeClass: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700", Icon: Zap },
  online: { label: "MLU EN LÍNEA", badgeClass: "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white", Icon: Wifi },
  manual: { label: "MODO MANUAL", badgeClass: "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 border-zinc-400", Icon: Zap },
  offline: { label: "SIN CONEXIÓN", badgeClass: "border-dashed border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100", Icon: WifiOff },
};

const SOURCE_LABEL: Record<ExchangeRateResponse["source"], string> = {
  dolarapi: "DolarApi UY (Venta Oficial)",
  "open-er-api": "Interbancario USD/UYU",
  fallback: "Cotización por defecto",
};

interface HeaderProps {
  exchangeRate: number;
  onExchangeRateChange: (rate: number) => void;
  rateInfo: ExchangeRateResponse | null;
  rateLoading: boolean;
  onRefreshRate: () => void;
  status: ConnectionStatus;
  onOpenAiAdvisor: () => void;
  onOpenCloudModal: () => void;
  onOpenSavedAudits: () => void;
}

export function Header({
  exchangeRate,
  onExchangeRateChange,
  rateInfo,
  rateLoading,
  onRefreshRate,
  status,
  onOpenAiAdvisor,
  onOpenCloudModal,
  onOpenSavedAudits,
}: HeaderProps) {
  const s = STATUS[status];

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-[#fbfbfb]/90 dark:bg-[#0c0c0e]/90 backdrop-blur-md transition-colors">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-4 sm:px-6">
        {/* Brand with editorial black block logo inspired by reference image */}
        <div className="flex items-center gap-2 sm:gap-3.5">
          <div role="img" aria-label="UyMargin" className="flex size-10 shrink-0 items-center justify-center bg-black text-white dark:bg-white dark:text-black font-black text-base tracking-tighter shadow-sm">
            UY
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="hidden min-[420px]:inline heading-grotesk text-base sm:text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase">
                UyMargin
              </span>
              <span className="hidden bg-black text-white dark:bg-white dark:text-black px-1.5 py-0.5 text-[11px] font-black uppercase tracking-widest sm:inline-block">
                MONTEVIDEO
              </span>
            </div>
            <p className="hidden text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider sm:block">
              Analizador Financiero & Rentabilidad Mayorista
            </p>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Status pill */}
          <span
            className={`hidden items-center gap-1.5 px-2.5 py-1 text-[11px] font-black tracking-wider uppercase border rounded-md sm:inline-flex ${s.badgeClass}`}
            role="status"
          >
            <s.Icon className="size-3" aria-hidden />
            {s.label}
          </span>

          {/* Dólar BCU / UYU rate ticker */}
          <div className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 rounded-md">
            <div className="flex flex-col">
              <div className="flex items-center gap-1 text-[11px] font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
                <ArrowLeftRight className="size-2.5 text-zinc-800 dark:text-zinc-200" />
                <span>USD/UYU</span>
              </div>
              <div className="w-16">
                <label htmlFor="header-rate" className="visually-hidden">
                  Cotización del dólar en pesos uruguayos
                </label>
                <NumberField
                  id="header-rate"
                  value={exchangeRate}
                  onChange={(v) => onExchangeRateChange(v > 0 ? v : 40)}
                  inputClassName="h-6 text-xs font-black border-0 bg-transparent px-0! focus:ring-0 text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={onRefreshRate}
              disabled={rateLoading}
              title={rateInfo ? `Fuente: ${SOURCE_LABEL[rateInfo.source]}` : "Actualizar cotización"}
              aria-label="Actualizar cotización"
              className="size-7 rounded text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${rateLoading ? "animate-spin text-black dark:text-white" : ""}`} />
            </button>
          </div>

          {/* Cloud Database (Supabase) button */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onOpenSavedAudits}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-2 text-xs font-black uppercase tracking-wider rounded-l-md transition-all cursor-pointer text-zinc-800 dark:text-zinc-200"
              title="Ver auditorías en Supabase"
              aria-label="Ver auditorías guardadas en la nube"
            >
              <span className="size-2 rounded-full bg-emerald-500"></span>
              <span className="hidden sm:inline">Nube</span>
            </button>
            <button
              type="button"
              onClick={onOpenCloudModal}
              className="border-y border-r border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 py-2 text-xs font-bold rounded-r-md transition-all cursor-pointer text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
              title="Configuración de Supabase"
              aria-label="Configuración de Supabase"
            >
              <Settings className="size-3.5" aria-hidden />
            </button>
          </div>

          {/* AI Copilot trigger */}
          <button
            type="button"
            onClick={onOpenAiAdvisor}
            className="hidden sm:flex items-center gap-1.5 bg-black hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black px-3.5 py-2 text-xs font-black uppercase tracking-wider rounded-md transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <Bot className="size-3.5" />
            <span className="hidden md:inline">Copilot IA</span>
          </button>

          {/* Theme switcher */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
