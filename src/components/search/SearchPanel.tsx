import { Loader2, Search } from "lucide-react";
import type { FormEvent } from "react";
import { StepHeader } from "@/components/ui/StepHeader";

interface SearchPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: (q: string) => void;
  loading: boolean;
}

const EXAMPLES = [
  "Termo Stanley 1L",
  "Auriculares Bluetooth F9",
  "Smartwatch D20",
  "Mate Torpedo Uruguayo",
  "Vaso Térmico Inox",
];

export function SearchPanel({ query, onQueryChange, onSearch, loading }: SearchPanelProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) onSearch(q);
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
      <StepHeader title="Radar de competencia en Mercado Libre Uruguay" aside="Opcional" />

      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
        Buscá por producto o modelo para auditar precios en vivo en MLU y calcular mediana real sin publicaciones atípicas.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 group">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-500 dark:text-zinc-400 group-focus-within:text-black dark:group-focus-within:text-white transition-colors" />
          <input
            id="mlu-search-input"
            aria-label="Producto o modelo a buscar en Mercado Libre Uruguay"
            type="search"
            required
            minLength={2}
            maxLength={120}
            placeholder="Ej: Termo Stanley 1L o Auriculares F9..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="h-12 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 pl-10 text-sm font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 outline-none transition-all hover:border-zinc-500 focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black dark:focus:ring-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading || query.trim().length < 2}
          className="h-12 px-6 rounded-md bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black dark:hover:bg-zinc-200 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:pointer-events-none active:scale-95 shrink-0"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Buscando...</span>
            </>
          ) : (
            <>
              <Search className="size-4" />
              <span>Analizar MLU</span>
            </>
          )}
        </button>
      </form>

      {/* Suggested chips */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
        <span className="text-[11px] font-black uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mr-1">
          SUGERENCIAS:
        </span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              onQueryChange(ex);
              onSearch(ex);
            }}
            className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white transition-colors cursor-pointer"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
