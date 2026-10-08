import { GATEWAYS, gatewayEffectiveRate } from "./constants";
import type { ChannelId, DirectChannelSettings, MlChannelSettings } from "./types";

export interface ChannelFees {
  commission: number;
  fixedFee: number;
  gatewayFee: number;
  /** Effective variable rate applied to the sale price. */
  rate: number;
}

/** A channel cost model: fees as a function of price + fixed seller shipping. */
export interface ChannelModel {
  id: ChannelId;
  label: string;
  fees(price: number): ChannelFees;
  shipping: number;
}

export function mlCommissionRate(settings: MlChannelSettings): number {
  return settings.listingType === "premium" ? settings.premiumRate : settings.classicRate;
}

/** Mercado Libre Uruguay: commission by listing type + fixed fee below threshold + Mercado Envíos. */
export function createMlModel(settings: MlChannelSettings): ChannelModel {
  const rate = mlCommissionRate(settings);
  return {
    id: "ml",
    label: "Mercado Libre UY",
    shipping: settings.shippingMode === "seller" ? Math.max(0, settings.sellerShippingCost) : 0,
    fees(price) {
      const applyFixed = price > 0 && price < settings.fixedFeeThreshold;
      return {
        commission: price * rate,
        fixedFee: applyFixed ? Math.max(0, settings.fixedFee) : 0,
        gatewayFee: 0,
        rate,
      };
    },
  };
}

/** Tienda propia / venta directa: payment gateway fee + local logistics. */
export function createDirectModel(settings: DirectChannelSettings): ChannelModel {
  const rate = gatewayEffectiveRate(settings.gateway);
  return {
    id: "direct",
    label: "Tienda Propia / POS",
    shipping: settings.shippingMode === "seller" ? Math.max(0, settings.shippingCost) : 0,
    fees(price) {
      return { commission: 0, fixedFee: 0, gatewayFee: price * rate, rate };
    },
  };
}

export function gatewayLabel(settings: DirectChannelSettings): string {
  return GATEWAYS[settings.gateway].label;
}
