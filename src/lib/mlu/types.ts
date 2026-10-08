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
  fetchedAt: string;
}

export interface MluSearchError {
  ok: false;
  code: MluErrorCode;
  message: string;
}

export type MluSearchResponse = MluSearchSuccess | MluSearchError;

export interface ExchangeRateResponse {
  rate: number;
  source: "dolarapi" | "open-er-api" | "fallback";
  buy: number | null;
  sell: number | null;
  updatedAt: string | null;
}
