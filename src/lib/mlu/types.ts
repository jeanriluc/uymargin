import type { Currency } from "@/lib/finance/types";

export interface MluItem {
  id: string;
  title: string;
  price: number;
  currency: Currency;
  condition: "new" | "used" | "other";
  thumbnail: string | null;
  permalink: string;
  freeShipping: boolean;
  seller: string | null;
  isAvailable?: boolean;
  stockStatus?: string;
  salesVolume?: string;
  sellerBadge?: "Tienda Oficial" | "MercadoLíder Platinum" | "MercadoLíder Gold" | "Vendedor Destacado";
  sellerReputation?: string;
  positivePercentage?: number;
  ratingAverage?: number;
  reviewsCount?: number;
  activeSellersCount?: number;
  sellerCity?: string;
  isTopChoice?: boolean;
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
  /** Total active listings reported by Mercado Libre. */
  total: number;
  items: MluItem[];
  /** Stats in UYU, computed with the exchange rate supplied in the request. */
  stats: MarketStats | null;
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
