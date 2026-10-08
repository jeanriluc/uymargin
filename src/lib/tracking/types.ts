/**
 * Types for the Competitor Price Tracking and Alert System in Mercado Libre Uruguay.
 */

export interface PricePoint {
  date: string; // ISO string YYYY-MM-DDTHH:mm:ss.sssZ
  price: number; // in UYU
  inStock: boolean;
  marketMedian?: number;
  note?: string;
}

export type AlertType = "price_drop" | "price_hike" | "margin_risk" | "out_of_stock";

export interface TriggeredAlert {
  id: string;
  competitorId: string;
  competitorTitle: string;
  date: string; // ISO string
  type: AlertType;
  message: string;
  oldPrice?: number;
  newPrice?: number;
  pctChange?: number;
  read: boolean;
}

export interface TrackedCompetitor {
  id: string; // unique internal tracking ID (e.g. "MLU_36006952" or uuid)
  productId?: string; // MLU item ID
  title: string;
  permalink: string;
  thumbnail: string | null;
  seller: string;
  sellerBadge?: "Tienda Oficial" | "MercadoLíder Platinum" | "MercadoLíder Gold" | "Vendedor Destacado" | string;
  sellerCity?: string;
  currency: "UYU" | "USD";
  
  // Price dynamics
  initialPrice: number; // in UYU
  currentPrice: number; // in UYU
  lowestPrice: number; // in UYU
  highestPrice: number; // in UYU
  inStock: boolean;
  
  // Alert settings
  alertThresholdPct: number; // e.g. 5 means alert if drops >= 5%
  alertOnDrop: boolean;
  alertOnMarginRisk: boolean;
  myTargetMarginPct?: number; // e.g. 15%
  myLandedCostUyu?: number; // e.g. 1140 UYU
  
  // Historical data
  priceHistory: PricePoint[];
  triggeredAlerts: TriggeredAlert[];
  
  lastChecked: string; // ISO string
  createdAt: string; // ISO string
  status: "active" | "alert_triggered" | "paused";
}

export interface TrackingStats {
  totalTracked: number;
  activeAlertsCount: number;
  unreadAlertsCount: number;
  priceDropsCount: number;
  averageVariationPct: number;
}
