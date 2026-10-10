import type { AnalysisInputs, PaymentGateway, Viability } from "./types";

/** IVA tasa básica Uruguay. */
export const IVA_RATE = 0.22;

export const DEFAULT_EXCHANGE_RATE = 40;

export const TARGET_NET_MARGIN = 0.3;

/**
 * Cuts of the viability traffic light, in percentage points (0–100).
 * Single source of truth: every screen, CSV and AI prompt reads these through classifyViability.
 */
export const VIABILITY_THRESHOLDS = {
  /** Net margin from which a sale stops being "tight" and becomes "good". */
  goodMargin: 15,
  /** "Excellent" needs this net margin AND `excellentRoi`. */
  excellentMargin: 25,
  excellentRoi: 40,
} as const;

/** Labels shown everywhere (badge, result card, mobile bar, batch table and CSV exports). */
export const VIABILITY_LABELS: Record<Viability, string> = {
  loss: "Pierde plata",
  tight: "Ajustado",
  good: "Bueno",
  excellent: "Excelente",
};

/** The criteria in words, for help texts and the AI prompt. */
export const VIABILITY_CRITERIA =
  `"${VIABILITY_LABELS.loss}": ganancia neta menor o igual a cero. ` +
  `"${VIABILITY_LABELS.tight}": hay ganancia pero el margen neto es menor a ${VIABILITY_THRESHOLDS.goodMargin}%. ` +
  `"${VIABILITY_LABELS.good}": margen neto de ${VIABILITY_THRESHOLDS.goodMargin}% o más. ` +
  `"${VIABILITY_LABELS.excellent}": margen neto de ${VIABILITY_THRESHOLDS.excellentMargin}% o más y ROI de ${VIABILITY_THRESHOLDS.excellentRoi}% o más.`;

export interface GatewayInfo {
  label: string;
  /** Base rate before IVA. */
  baseRate: number;
  description: string;
}

export const GATEWAYS: Record<PaymentGateway, GatewayInfo> = {
  mercadopago: {
    label: "Mercado Pago",
    baseRate: 0.0399,
    description: "Checkout / Link de pago · 3,99% + IVA",
  },
  handy: {
    label: "Handy / dLocal",
    baseRate: 0.035,
    description: "POS / Link · 3,5% + IVA",
  },
  transfer: {
    label: "Transferencia / Efectivo",
    baseRate: 0,
    description: "Sin comisión de pasarela",
  },
};

export const URUGUAY_CARRIERS = [
  { id: "dac", name: "DAC (Agencia Central)", defaultCost: 210, note: "Nacional / Interior" },
  { id: "mirtrans", name: "Mirtrans", defaultCost: 195, note: "Nacional / Encomiendas" },
  { id: "cadeteria", name: "Cadetería Montevideo", defaultCost: 170, note: "Reparto urbano en el día" },
  { id: "colecta", name: "Mercado Envíos Colecta", defaultCost: 210, note: "Tarifa subsidiada vendedor" },
  { id: "pickup", name: "Retiro en Local / Mostrador", defaultCost: 0, note: "Sin costo de logística" },
] as const;

/** Effective gateway rate including IVA. */
export function gatewayEffectiveRate(gateway: PaymentGateway): number {
  return GATEWAYS[gateway].baseRate * (1 + IVA_RATE);
}

export const ML_DEFAULT_RATES = {
  classic: 0.13,
  premium: 0.175,
} as const;

export const ML_RATE_RANGES = {
  classic: { min: 0.12, max: 0.16 },
  premium: { min: 0.16, max: 0.19 },
} as const;

export function createDefaultInputs(): AnalysisInputs {
  return {
    productName: "",
    productImage: null,
    query: "",
    cost: { amount: 0, currency: "USD" },
    freight: { amount: 0, currency: "UYU" },
    exchangeRate: DEFAULT_EXCHANGE_RATE,
    salePrice: 0,
    tax: {
      regime: "literal_e",
      costIncludesVat: true,
      feesInvoicedWithRut: true,
      provisionIrae: false,
      iraeRate: 0.25,
    },
    ml: {
      listingType: "classic",
      classicRate: ML_DEFAULT_RATES.classic,
      premiumRate: ML_DEFAULT_RATES.premium,
      fixedFeeThreshold: 1200,
      fixedFee: 40,
      shippingMode: "buyer",
      sellerShippingCost: 210,
    },
    direct: {
      gateway: "mercadopago",
      shippingMode: "seller",
      shippingCost: 190,
    },
  };
}
