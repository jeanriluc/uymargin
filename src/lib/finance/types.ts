/**
 * Domain types for the UyMargin financial engine.
 * All monetary amounts handled internally by the engine are in UYU (pesos uruguayos).
 */

export type Currency = "UYU" | "USD";

export interface Money {
  amount: number;
  currency: Currency;
}

/** DGI tax regimes supported by the simulator. */
export type TaxRegime = "literal_e" | "general";

export type MlListingType = "classic" | "premium";

/** Who pays the shipping on a given channel. */
export type ShippingMode = "buyer" | "seller";

export type PaymentGateway = "mercadopago" | "handy" | "transfer";

export type ChannelId = "ml" | "direct";

export interface TaxSettings {
  regime: TaxRegime;
  /** Wholesale invoice includes IVA (e-factura with RUT). Creditable under régimen general. */
  costIncludesVat: boolean;
  /** Platform commissions and shipping are invoiced to the seller's RUT (IVA creditable). */
  feesInvoicedWithRut: boolean;
  /** Provision IRAE on the per-unit profit (régimen general only). */
  provisionIrae: boolean;
  /** IRAE rate, 0.25 by default. */
  iraeRate: number;
  /** Product VAT rate: 0.22 (basic), 0.10 (minimum), or 0 (exempt). Default 0.22. */
  vatRate?: number;
}

export interface MlChannelSettings {
  listingType: MlListingType;
  /** Commission rate (IVA included) for Clásica listings, e.g. 0.13. */
  classicRate: number;
  /** Commission rate (IVA included) for Premium listings, e.g. 0.175. */
  premiumRate: number;
  /** Sales below this price (UYU) pay an additional fixed fee. */
  fixedFeeThreshold: number;
  /** Fixed fee per unit (UYU) applied below the threshold. */
  fixedFee: number;
  shippingMode: ShippingMode;
  /** Mercado Envíos cost absorbed by the seller when offering free shipping (UYU). */
  sellerShippingCost: number;
}

export interface DirectChannelSettings {
  gateway: PaymentGateway;
  shippingMode: ShippingMode;
  /** Local logistics cost (DAC, Mirtrans, cadetería) in UYU. */
  shippingCost: number;
}

/** Full set of user inputs for one analysis. Serializable (stored in history). */
export interface AnalysisInputs {
  productName: string;
  query: string;
  cost: Money;
  freight: Money;
  /** UYU per 1 USD. */
  exchangeRate: number;
  /** Simulated gross (consumer) sale price, in UYU. */
  salePrice: number;
  tax: TaxSettings;
  ml: MlChannelSettings;
  direct: DirectChannelSettings;
  /** Estimated return/claims percentage (e.g. 3). */
  returnRatePct?: number;
  /** Estimated breakage/warranty/shrinkage percentage (e.g. 2). */
  shrinkageRatePct?: number;
  /** Estimated stock turnover in days (e.g. 45) to annualize ROI. */
  stockTurnoverDays?: number;
}

export type Viability = "excellent" | "tight" | "risky";

export interface WaterfallStep {
  key: "price" | "product" | "fees" | "shipping" | "taxes" | "net" | "reserves";
  label: string;
  /** Signed amount in UYU (price/net positive, deductions negative). */
  amount: number;
}

export interface TaxBreakdown {
  /** IVA débito fiscal on the sale. */
  vatDebit: number;
  /** IVA crédito from merchandise purchase. */
  vatCreditCost: number;
  /** IVA crédito from platform fees and shipping. */
  vatCreditServices: number;
  /** Net IVA to pay DGI (negative = saldo a favor that offsets other sales). */
  vatPayable: number;
  irae: number;
  total: number;
}

export interface ChannelResult {
  channel: ChannelId;
  label: string;
  salePrice: number;
  /** Merchandise cost + acquisition freight (landed cost), UYU. */
  productCost: number;
  /** Commission breakdown, UYU. */
  commission: number;
  fixedFee: number;
  gatewayFee: number;
  platformFees: number;
  /** Effective commission rate applied (IVA included). */
  effectiveFeeRate: number;
  shipping: number;
  taxes: TaxBreakdown;
  netProfit: number;
  netProfitUsd: number;
  /** Percentages expressed as 0–100. */
  netMargin: number;
  grossMargin: number;
  roi: number;
  annualizedRoi?: number;
  reservesCost?: number;
  breakEvenPrice: number | null;
  /** Price required for a 30% net margin (null if unreachable). */
  targetMarginPrice: number | null;
  viability: Viability;
  waterfall: WaterfallStep[];
}
