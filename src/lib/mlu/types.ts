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
  /** Number of prices used for stats after outlier removal. */
  sampleSize: number;
  /** Outliers removed by the IQR filter. */
  outliersRemoved: number;
  min: number;
  max: number;
  average: number;
  median: number;
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
