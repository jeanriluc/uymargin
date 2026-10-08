import type { Currency } from "@/lib/finance/types";

/**
 * Producto de catálogo del radar (y de "Similares"). Lleva el precio de su oferta activa más barata
 * y los datos de ese vendedor. Solo datos que informa Mercado Libre; lo que falta va en null.
 */
export interface MluItem {
  id: string;
  title: string;
  /** Precio de la oferta activa más barata del producto. */
  price: number;
  currency: Currency;
  condition?: "new" | "used" | "other" | null;
  thumbnail: string | null;
  permalink: string;
  freeShipping: boolean;
  /** La oferta mostrada es de una tienda oficial (official_store_id). */
  isOfficialStore?: boolean;
  /** Cantidad de ofertas activas del producto de catálogo. */
  activeSellersCount?: number;
  sellerCity?: string | null;
  /** Vendedor de la oferta mostrada, según /users. null = no disponible. */
  seller?: ExactOfferSeller | null;
  /** Solo en el radar por nombre: si el producto menciona todo lo que se buscó y, si no, qué le falta. */
  match?: { matches: boolean; missing: string[] };
}

/** Cómo se separó el radar entre "Coinciden con tu búsqueda" y "Relacionados". */
export interface RadarRelevance {
  /** Palabras y números de la búsqueda que se compararon. */
  terms: string[];
  /** Productos con ofertas activas que mencionan todos los términos: con ellos se calculan las estadísticas. */
  matched: number;
  /** Productos con ofertas activas a los que les falta algún término: no entran a las estadísticas. */
  related: number;
  /** Suma de las ofertas activas de los productos que coinciden. */
  matchedOffers: number;
  /** Coinciden por nombre pero Mercado Libre no informa ofertas activas en Uruguay: no se muestran. */
  matchedWithoutOffers: number;
  /** Coinciden por nombre pero no se consultaron sus ofertas por el tope de consultas por búsqueda. */
  matchedNotChecked: number;
  /** Tope de productos de la búsqueda a los que se les consultan las ofertas. */
  searchCheckLimit: number;
  /** Por cada término, cuántos de los relacionados no lo mencionan. */
  missingCounts: { term: string; count: number }[];
}

/** Criterio real con el que se eligieron los "Similares" de un enlace. */
export interface SimilarCriteria {
  /** Palabras de tipo de producto que debe mencionar el nombre ("olla", "presion"). */
  typeWords: string[];
  /** domain_id de Mercado Libre admitidos (el del producto y el que Mercado Libre asigna a su nombre). */
  domains: string[];
  /** Productos con ofertas activas que se descartaron por ser de otro tipo. */
  discarded: number;
}

export interface MarketStats {
  /** Number of prices used for stats after outlier removal. 0 when a cloud audit did not store it. */
  sampleSize: number;
  /** Outliers removed by the IQR filter. null = not available (cloud audits do not store it). */
  outliersRemoved: number | null;
  min: number;
  max: number;
  /** null = not available (cloud audits do not store it; it is never reconstructed). */
  average: number | null;
  median: number;
  /** True when loaded from a saved cloud audit: only min, median, max and offer count were stored. */
  fromCloud?: boolean;
}

export type MluErrorCode =
  | "BAD_REQUEST"
  | "AUTH_REQUIRED"
  | "NO_RESULTS"
  | "UNSUPPORTED_CURRENCY"
  | "RATE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "NETWORK";

export interface MluSearchSuccess {
  ok: true;
  query: string;
  /** Productos de catálogo con ofertas activas que coinciden con la búsqueda (los que entran a `stats`). */
  total: number;
  /** Primero los que coinciden, después los relacionados (`match.matches`). */
  items: MluItem[];
  /** En pesos, con la cotización del pedido y solo con los productos que coinciden. null = no coincide ninguno. */
  stats: MarketStats | null;
  relevance?: RadarRelevance;
  /** Cotización con la que el servidor calculó `stats`. */
  rateUsed?: number;
  /** Publicaciones en una moneda que no convertimos: se informan, no se calculan. */
  unsupported?: UnsupportedListing[];
  /** Ofertas del producto de catálogo que mejor coincide con la búsqueda. null = no disponible. */
  exact?: ExactProductBlock | null;
  fetchedAt: string;
}

export interface UnsupportedListing {
  id: string;
  title: string;
  price: number;
  /** currency_id tal como lo informa Mercado Libre. */
  currency: string;
  permalink: string;
}

export interface MluSearchError {
  ok: false;
  code: MluErrorCode;
  message: string;
}

export type MluSearchResponse = MluSearchSuccess | MluSearchError;

/** Respuesta de /api/exchange-rate. La fuente es el BCU; `stale` indica último valor guardado. */
export type ExchangeRateResponse =
  | {
      ok: true;
      rate: number;
      buy: number;
      sell: number;
      /** Fecha del cierre del BCU al que corresponde (AAAA-MM-DD). */
      referenceDate: string;
      source: "bcu";
      fetchedAt: string;
      stale: boolean;
      error?: string;
    }
  | { ok: false; code: "RATE_UNAVAILABLE"; message: string };

// ------------------------------------------------------------------
// "Productos exactos": ofertas del mismo producto de catálogo (mismo product_id MLU…).
// Todo lo de acá viene de la API de Mercado Libre; lo que la API no informa va en null
// y la interfaz lo rotula "no disponible".
// ------------------------------------------------------------------

/** Datos del vendedor según /users de Mercado Libre. */
export interface ExactOfferSeller {
  id: number;
  /** Apodo de la cuenta. Puede no coincidir con el nombre que muestra la página de la publicación. */
  nickname: string | null;
  /** level_id de la reputación ("5_green", "3_yellow"…). null = el vendedor no tiene nivel asignado. */
  reputationLevel: string | null;
  /** Estado MercadoLíder real. null = no es MercadoLíder. */
  powerSellerStatus: "platinum" | "gold" | "silver" | null;
  /** Transacciones históricas de la cuenta. */
  transactionsTotal: number | null;
}

export interface ExactOffer {
  itemId: string;
  productId: string;
  price: number;
  currency: "UYU" | "USD";
  /** Precio en pesos con la cotización de la respuesta (`rateUsed`). */
  priceUyu: number;
  /** Página del producto de catálogo con esta oferta seleccionada. */
  permalink: string;
  freeShipping: boolean;
  condition: "new" | "used" | "other" | null;
  isOfficialStore: boolean;
  sellerCity: string | null;
  /** null = no se consultó o Mercado Libre no respondió: no disponible. */
  seller: ExactOfferSeller | null;
}

export interface CatalogCandidate {
  productId: string;
  title: string;
  thumbnail: string | null;
  permalink: string;
  /** Ofertas activas del producto. null = no se consultó. */
  offersCount: number | null;
}

export interface ExactMatch extends CatalogCandidate {
  /**
   * "enlace": el product_id venía en el enlace pegado. "busqueda": se eligió por nombre.
   * "elegido": el usuario lo eligió entre los candidatos (solo lo pone la interfaz).
   */
  source: "enlace" | "busqueda" | "elegido";
  confidence: "exacta" | "alta" | "dudosa";
  /** Motivos de la duda, en texto para mostrar. */
  reasons: string[];
}

/** Mínimo, mediana y máximo de las ofertas exactas, en pesos, sin excluir ninguna. */
export interface ExactStats {
  count: number;
  min: number;
  median: number;
  max: number;
}

export interface ExactProductBlock {
  match: ExactMatch;
  /** Productos de catálogo que devolvió la búsqueda (incluye el elegido). Vacío cuando vino por enlace. */
  candidates: CatalogCandidate[];
  /** Ordenadas por precio en pesos, de menor a mayor. */
  offers: ExactOffer[];
  stats: ExactStats | null;
  sellerData: {
    status: "ok" | "parcial" | "no_disponible";
    withData: number;
    withoutData: number;
    /** Tope de vendedores consultados por producto. */
    cap: number;
  };
  unsupported: UnsupportedListing[];
  rateUsed: number;
}
