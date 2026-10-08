import { useSyncExternalStore } from "react";
import { Download, Trash2, History as HistoryIcon, ArrowUpCircle } from "lucide-react";
import { historyStore, type HistoryEntry } from "@/lib/storage/history";
import { historyToCsv, downloadCsv } from "@/lib/storage/csv";
import { formatPct, formatUyu } from "@/lib/format";
import { ViabilityBadge } from "@/components/ui/ViabilityBadge";

interface HistorySectionProps {
  onLoadEntry: (entry: HistoryEntry) => void;
}

export function HistorySection({ onLoadEntry }: HistorySectionProps) {
  const entries = useSyncExternalStore(
    historyStore.subscribe,
    historyStore.getSnapshot,
    historyStore.getServerSnapshot
  );

  const handleExport = () => {
    if (entries.length === 0) return;
    const csv = historyToCsv(entries);
    downloadCsv(`uymargin_export_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/30 p-10 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-md bg-black text-white dark:bg-white dark:text-black mb-3 font-black">
          <HistoryIcon className="size-5" />
        </div>
        <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
          Aún no guardaste simulaciones
        </h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
          Podés guardar escenarios haciendo clic en "Guardar Simulación" arriba para comparar productos y exportar tus reportes a Excel / CSV.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-zinc-800 bg-[#fafafa] dark:bg-zinc-900/40">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center bg-black text-white dark:bg-white dark:text-black text-xs font-black">
            <HistoryIcon className="size-3.5" />
          </div>
          <div>
            <h3 className="heading-grotesk text-sm font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
              Bóveda de Simulaciones Guardadas
            </h3>
            <p className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
              Historial persistente para auditoría de compras mayoristas
            </p>
          </div>
          <span className="rounded bg-black text-white dark:bg-white dark:text-black px-2 py-0.5 text-[11px] font-black">
            {entries.length}
          </span>
        </div>

        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded-md border border-black dark:border-white bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-3.5 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
        >
          <Download className="size-3.5" />
          <span>Exportar CSV</span>
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs whitespace-nowrap">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-[11px] font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3">Fecha</th>
              <th className="px-5 py-3">Producto / Referencia</th>
              <th className="px-5 py-3 text-right">Costo Unit.</th>
              <th className="px-5 py-3 text-right">Venta $U</th>
              <th className="px-5 py-3 text-right">Margen ML</th>
              <th className="px-5 py-3 text-right">Margen Web</th>
              <th className="px-5 py-3 text-center">Viabilidad</th>
              <th className="px-5 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {entries.map((entry) => {
              const date = new Date(entry.savedAt).toLocaleDateString("es-UY", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <tr
                  key={entry.id}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-5 py-3.5 text-zinc-500 dark:text-zinc-400 font-medium text-[11px]">{date}</td>
                  <td className="px-5 py-3.5 font-bold text-zinc-900 dark:text-zinc-100 max-w-[200px] truncate" title={entry.inputs.productName || entry.inputs.query}>
                    {entry.inputs.productName || entry.inputs.query || "Sin nombre"}
                  </td>
                  <td className="px-5 py-3.5 text-right num text-zinc-600 dark:text-zinc-400 font-semibold">
                    {entry.inputs.cost.currency} {entry.inputs.cost.amount}
                  </td>
                  <td className="px-5 py-3.5 text-right num font-black text-zinc-900 dark:text-zinc-100">
                    {formatUyu(entry.inputs.salePrice)}
                  </td>
                  <td className="px-5 py-3.5 text-right num font-black text-black dark:text-white">
                    {formatPct(entry.ml.netMargin)} ({formatUyu(entry.ml.netProfit)})
                  </td>
                  <td className="px-5 py-3.5 text-right num font-black text-black dark:text-white">
                    {formatPct(entry.direct.netMargin)} ({formatUyu(entry.direct.netProfit)})
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <ViabilityBadge viability={entry.ml.viability} compact />
                  </td>
                  <td className="px-5 py-3.5 text-right space-x-1.5">
                    <button
                      type="button"
                      onClick={() => onLoadEntry(entry)}
                      title="Cargar simulación en el dashboard"
                      className="inline-flex size-7 items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white transition-colors cursor-pointer"
                    >
                      <ArrowUpCircle className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => historyStore.remove(entry.id)}
                      title="Eliminar registro"
                      className="inline-flex size-7 items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-red-600 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
