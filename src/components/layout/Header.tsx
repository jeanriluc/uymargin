import { useState } from "react";
import { ArrowLeftRight, Bot, LogOut, RefreshCw, Wifi, WifiOff, Zap } from "lucide-react";
import { NumberField } from "@/components/ui/NumberField";
import { ThemeToggle } from "./ThemeToggle";

export type ConnectionStatus = "online" | "manual" | "offline" | "idle";
export type CloudStatus = "off" | "checking" | "ok" | "error";

const CLOUD: Record<CloudStatus, { dot: string; label: string }> = {
  off: { dot: "bg-zinc-400", label: "Nube sin configurar en el servidor" },
  checking: { dot: "bg-zinc-400 animate-pulse", label: "Comprobando conexión con la nube" },
  ok: { dot: "bg-emerald-500", label: "Nube conectada" },
  error: { dot: "bg-amber-500", label: "La nube no responde" },
};

const STATUS: Record<ConnectionStatus, { label: string; badgeClass: string; Icon: typeof Wifi }> = {
  idle: { label: "MLU LISTO", badgeClass: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700", Icon: Zap },
  online: { label: "MLU EN LÍNEA", badgeClass: "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white", Icon: Wifi },
  manual: { label: "MODO MANUAL", badgeClass: "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 border-zinc-400", Icon: Zap },
  offline: { label: "SIN CONEXIÓN", badgeClass: "border-dashed border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100", Icon: WifiOff },
};


interface HeaderProps {
  exchangeRate: number;
  onExchangeRateChange: (rate: number) => void;
  /** Fuente y fecha de la cotización en uso, en texto. */
  rateLabel: string;
  rateLoading: boolean;
  onRefreshRate: () => void;
  status: ConnectionStatus;
  cloudStatus: CloudStatus;
  onOpenAiAdvisor: () => void;
  /** Correo de la sesión; null en desarrollo sin login. */
  userEmail: string | null;
  onSignOut: () => void;
  onOpenSavedAudits: () => void;
}

export function Header({
  exchangeRate,
  onExchangeRateChange,
  rateLabel,
  rateLoading,
  onRefreshRate,
  status,
  cloudStatus,
  onOpenAiAdvisor,
  userEmail,
  onSignOut,
  onOpenSavedAudits,
}: HeaderProps) {
  const s = STATUS[status];
  // Valor tipeado a mano, pendiente de confirmación explícita; no se usa hasta que se confirma.
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [prevRate, setPrevRate] = useState(exchangeRate);
  if (exchangeRate !== prevRate) {
    setPrevRate(exchangeRate);
    setPendingRate(null);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-[#fbfbfb]/90 dark:bg-[#0c0c0e]/90 backdrop-blur-md transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-x-2 px-4 py-2 sm:gap-x-4 sm:px-6 sm:py-3">
        {/* Marca: solo texto. En celular queda el nombre; la etiqueta y el subtítulo aparecen cuando entran. */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="heading-grotesk text-base sm:text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-100 uppercase">
              UyMargin
            </span>
            <span className="hidden bg-black text-white dark:bg-white dark:text-black px-1.5 py-0.5 text-[11px] font-black uppercase tracking-widest sm:inline-block">
              MONTEVIDEO
            </span>
          </div>
          <p className="hidden whitespace-nowrap text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider lg:block">
            Analizador Financiero & Rentabilidad Mayorista
          </p>
        </div>

        {/* Center / Right controls */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Status pill */}
          <span
            className={`hidden items-center gap-1.5 px-2.5 py-1 text-[11px] font-black tracking-wider uppercase border rounded-md whitespace-nowrap xl:inline-flex ${s.badgeClass}`}
            role="status"
          >
            <s.Icon className="size-3" aria-hidden />
            {s.label}
          </span>

          {/* Dólar BCU / UYU: una sola fila baja. La confirmación del valor manual flota debajo, sin mover el encabezado. */}
          <div
            data-rate-box
            className="relative flex h-8 items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-1.5 pr-0.5 sm:pl-2"
          >
            <span aria-hidden className="flex items-center gap-1 text-[11px] font-black uppercase sm:tracking-wide text-zinc-600 dark:text-zinc-400">
              <ArrowLeftRight className="hidden size-2.5 text-zinc-800 dark:text-zinc-200 lg:block" />
              USD/UYU
            </span>
            <div className="w-10 sm:w-11">
              <label htmlFor="header-rate" className="visually-hidden">
                Cotización del dólar en pesos uruguayos
              </label>
              <NumberField
                id="header-rate"
                value={pendingRate ?? exchangeRate}
                onChange={(v) => setPendingRate(v === exchangeRate ? null : v)}
                inputClassName="h-6! rounded-sm! text-center text-xs! font-black! border-0! bg-transparent! px-0! focus:ring-1! text-zinc-900 dark:text-zinc-100"
              />
            </div>

            {/* Va justo después del campo para que el Tab llegue primero acá; se dibuja flotando debajo de la caja. */}
            {pendingRate !== null && (
              <div
                role="group"
                aria-label="Confirmar cotización manual"
                className="absolute left-0 top-full z-40 mt-3.5 flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1.5 shadow-lg sm:left-auto sm:right-0 sm:mt-4.5 lg:mt-5.5"
              >
                {pendingRate > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onExchangeRateChange(pendingRate);
                      setPendingRate(null);
                    }}
                    title="Usar este valor como cotización manual"
                    className="rounded bg-black px-2 py-1 text-[11px] font-black uppercase text-white dark:bg-white dark:text-black cursor-pointer"
                  >
                    Usar este valor
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPendingRate(null)}
                  className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] font-black uppercase text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onRefreshRate}
              disabled={rateLoading}
              title={`${rateLabel}. Actualizar desde el BCU`}
              aria-label={`Actualizar cotización desde el BCU. En uso: ${rateLabel}`}
              className="size-6 shrink-0 rounded text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${rateLoading ? "animate-spin text-black dark:text-white" : ""}`} />
            </button>
          </div>

          {/* Cloud Database (Supabase) button */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onOpenSavedAudits}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 h-8 px-2.5 sm:h-9 sm:px-3 text-xs font-black uppercase tracking-wider rounded-md transition-all cursor-pointer text-zinc-800 dark:text-zinc-200"
              title={`${CLOUD[cloudStatus].label}. Ver auditorías guardadas`}
              aria-label={`${CLOUD[cloudStatus].label}. Ver auditorías guardadas en la nube`}
            >
              <span aria-hidden className={`size-2 rounded-full ${CLOUD[cloudStatus].dot}`}></span>
              <span className="hidden sm:inline">Nube</span>
            </button>
          </div>

          {/* AI Copilot trigger */}
          <button
            type="button"
            onClick={onOpenAiAdvisor}
            className="hidden sm:flex items-center gap-1.5 bg-black hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-black h-9 px-3.5 text-xs font-black uppercase tracking-wider rounded-md transition-all cursor-pointer shadow-sm active:scale-95"
          >
            <Bot className="size-3.5" />
            <span className="hidden md:inline">Copilot IA</span>
          </button>

          {/* Theme switcher */}
          <ThemeToggle />

          {userEmail && (
            <button
              type="button"
              onClick={onSignOut}
              title={`Salir (${userEmail})`}
              aria-label={`Salir. Sesión de ${userEmail}`}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 h-8 px-2 sm:h-9 sm:px-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all cursor-pointer text-zinc-800 dark:text-zinc-200"
            >
              <LogOut className="size-3.5" aria-hidden />
              <span className="hidden lg:inline">Salir</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
