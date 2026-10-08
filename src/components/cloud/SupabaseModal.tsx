import { useDialog } from "@/lib/hooks/useDialog";
import { useState, useEffect } from "react";
import { Cloud, CheckCircle2, AlertCircle, Copy, Check, X, Database, ExternalLink, Loader2 } from "lucide-react";
import { getSupabaseConfig, setSupabaseConfig, testSupabaseConnection, SUPABASE_SCHEMA_SQL } from "@/lib/supabase";

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: () => void;
}

export function SupabaseModal({ isOpen, onClose, onConnected }: SupabaseModalProps) {
  const dialogRef = useDialog(isOpen, onClose);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const config = getSupabaseConfig();
      setUrl(config.url);
      setKey(config.key);
      if (config.url && config.key) {
        handleTest(config.url, config.key);
      } else {
        setStatus("idle");
        setStatusMessage("");
      }
    }
  }, [isOpen]);

  async function handleTest(testUrl?: string, testKey?: string) {
    const finalUrl = (testUrl ?? url).trim();
    const finalKey = (testKey ?? key).trim();

    if (!finalUrl || !finalKey) {
      setStatus("error");
      setStatusMessage("Por favor completá la URL y la Anon Key.");
      return;
    }

    setSupabaseConfig(finalUrl, finalKey);
    setStatus("testing");
    setStatusMessage("Verificando conexión con Supabase...");

    const res = await testSupabaseConnection();
    if (res.ok) {
      setStatus("success");
      setStatusMessage(res.message);
      if (onConnected) onConnected();
    } else {
      setStatus("error");
      setStatusMessage(res.message);
    }
  }

  function handleSave() {
    setSupabaseConfig(url, key);
    handleTest();
  }

  function handleCopySql() {
    navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  }

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Conexión con Supabase" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-surface p-6 shadow-2xl">
        {/* Close Button */}
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 hover:text-black dark:hover:bg-zinc-800 dark:hover:text-white transition-colors"
        >
          <X className="size-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4 mb-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <Cloud className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Conexión Supabase (Base de Datos en la Nube)
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Guardá productos auditados, ofertas de competidores y márgenes en tu nube.
            </p>
          </div>
        </div>

        {/* Status Alert */}
        {statusMessage && (
          <div
            className={`mb-5 flex items-start gap-2.5 rounded-lg border p-3 text-xs leading-relaxed ${
              status === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : status === "error"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {status === "testing" && <Loader2 className="size-4 shrink-0 animate-spin text-zinc-600 dark:text-zinc-400" />}
            {status === "success" && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
            {status === "error" && <AlertCircle className="size-4 shrink-0 text-amber-500" />}
            <span className="flex-1">{statusMessage}</span>
          </div>
        )}

        {/* Form Inputs */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
              Project URL
            </label>
            <input
              type="url"
              placeholder="https://tu-proyecto.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-black dark:focus:border-white transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
              Anon Public Key (API Key)
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-black dark:focus:border-white transition-all font-mono"
            />
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              Encontrás estos datos en tu panel de{" "}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-0.5 hover:underline"
              >
                Supabase &gt; Project Settings &gt; API
                <ExternalLink className="size-2.5" />
              </a>
            </p>
          </div>

          {/* SQL Setup Helper */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3.5 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
                <Database className="size-3.5 text-zinc-600 dark:text-zinc-400" />
                Tabla requerida en Supabase (`uymargin_audits`)
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white"
              >
                {copiedSql ? (
                  <>
                    <Check className="size-3 text-emerald-500" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copiar SQL</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Copiá y ejecutá el script en el <b>SQL Editor</b> de tu proyecto en Supabase para habilitar el guardado automático de auditorías.
            </p>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={status === "testing" || !url || !key}
            className="flex items-center gap-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-xs font-black uppercase tracking-wider hover:opacity-90 disabled:opacity-40"
          >
            {status === "testing" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Conectando...</span>
              </>
            ) : (
              <span>Probar y Guardar</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
