/** Pestañas de "Precio de mercado". */
export type SearchTab = "keyword" | "url" | "batch";

export const SEARCH_TABS: readonly SearchTab[] = ["keyword", "url", "batch"];

export interface SearchPanelState {
  /** El panel está en el árbol de React (conserva su estado interno). */
  mounted: boolean;
  /** El panel está montado pero no se ve ni es accesible (clase "hidden" + aria-hidden). */
  hidden: boolean;
}

/**
 * Un panel se monta la primera vez que se abre su pestaña y no se desmonta más:
 * al cambiar de pestaña solo se oculta, así el Lote y el análisis por enlace no pierden lo cargado.
 */
export function searchPanelState(tab: SearchTab, active: SearchTab, everOpened: boolean): SearchPanelState {
  const isActive = tab === active;
  return { mounted: isActive || everOpened, hidden: !isActive };
}
