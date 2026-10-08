import { useState, useEffect } from "react";
import { Cloud, Trash2, ExternalLink, Calculator, ArrowRight, X, Loader2, RefreshCw } from "lucide-react";
import { getCloudAudits, deleteCloudAudit, CloudAuditRecord } from "@/lib/supabase";
import { formatMoney, formatUyu } from "@/lib/format";

interface SavedAuditsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadAudit: (audit: CloudAuditRecord) => void;
  onOpenSettings?: () => void;
}

export function SavedAuditsDrawer({ isOpen, onClose, onLoadAudit, onOpenSettings }: SavedAuditsDrawerProps) {
  const [audits, setAudits] = useState<CloudAuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  async function loadData() {
    setLoading(true);
    setError(null);
    const res = await getCloudAudits();
    if (res.ok) {
      setAudits(res.data);
    } else {
      setError(res.error || "No se pudieron cargar las auditorías");
    }
    setLoading(false);
  }

  async function handleDelete(id?: string) {
    if (!id) return;
    const res = await deleteCloudAudit(id);
    if (res.ok) {
      setAudits((prev) => prev.filter((a) => a.id !== id));
    }
  }

  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const filteredAudits = audits.filter((a) =>
    a.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Cloud className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Auditorías en Supabase ({audits.length})
              </h3>
              <p className="text-[11px] text-zinc-500">Historial sincronizado en la nube</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadData}
              title="Refrescar"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Buscar por producto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden focus:ring-1 focus:ring-black dark:focus:ring-white"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <Loader2 className="size-6 animate-spin mb-2" />
              <p className="text-xs">Cargando auditorías de Supabase...</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
              <p className="font-bold">Aviso de conexión:</p>
              <p className="mt-1">{error}</p>
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="mt-3 block w-full rounded-md bg-amber-600 text-white font-bold py-1.5 text-center hover:bg-amber-700 transition-colors"
                >
                  Configurar Credenciales de Supabase
                </button>
              )}
            </div>
          )}

          {!loading && !error && audits.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-400">
              <Cloud className="size-10 stroke-1 mb-2 text-zinc-300 dark:text-zinc-700" />
              <p className="text-xs font-semibold">Aún no hay auditorías guardadas en la nube.</p>
              <p className="text-[11px] text-zinc-500 mt-1 max-w-xs">
                Cuando analices un producto o link de Mercado Libre, hacé clic en "Guardar en Nube".
              </p>
            </div>
          )}

          {!loading &&
            filteredAudits.map((item) => (
              <div
                key={item.id}
                className="group relative rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3.5 transition-all hover:border-black dark:hover:border-white"
              >
                <div className="flex items-start gap-3">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt=""
                      className="size-12 shrink-0 rounded-lg object-contain bg-white border border-zinc-200 dark:border-zinc-700 p-0.5"
                    />
                  ) : (
                    <div className="size-12 shrink-0 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500">
                      MLU
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
                      {item.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      {item.target_price && (
                        <span className="font-extrabold text-black dark:text-white num">
                          {formatMoney(item.target_price, (item.target_currency as any) || "UYU")}
                        </span>
                      )}
                      {item.competitor_median && (
                        <span className="text-zinc-500">
                          Mediana: <b className="text-zinc-800 dark:text-zinc-200 num">{formatUyu(item.competitor_median)}</b>
                        </span>
                      )}
                      {item.competitor_count && (
                        <span className="rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.2 text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                          {item.competitor_count} ofertas
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="mt-3 flex items-center justify-between border-t border-zinc-200/60 dark:border-zinc-800/60 pt-2.5">
                  <span className="text-[10px] text-zinc-400">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString("es-UY") : ""}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.product_url && (
                      <a
                        href={item.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-zinc-400 hover:text-black dark:hover:text-white"
                        title="Abrir en Mercado Libre"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="rounded p-1 text-zinc-400 hover:text-red-500 transition-colors"
                      title="Eliminar de la nube"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        onLoadAudit(item);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1 rounded bg-black text-white dark:bg-white dark:text-black px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                    >
                      <Calculator className="size-3" />
                      <span>Cargar</span>
                      <ArrowRight className="size-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
