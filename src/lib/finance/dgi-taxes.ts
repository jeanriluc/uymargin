import { IVA_RATE } from "./constants";
import type { TaxBreakdown, TaxSettings } from "./types";

/** IVA contained in an IVA-inclusive gross amount. */
export function vatIncluded(gross: number, rate: number = IVA_RATE): number {
  if (rate <= 0) return 0;
  return (gross * rate) / (1 + rate);
}

export interface TaxableOperation {
  salePrice: number;
  /** Merchandise cost (as invoiced) in UYU, excluding acquisition freight. */
  merchandiseCost: number;
  /** Platform fees + gateway fees (IVA included). */
  platformFees: number;
  /** Shipping paid by the seller (IVA included). */
  shipping: number;
  /** Profit before taxes computed with gross (IVA-inclusive) amounts. */
  grossProfit: number;
}

const ZERO_TAXES: TaxBreakdown = {
  vatDebit: 0,
  vatCreditCost: 0,
  vatCreditServices: 0,
  vatPayable: 0,
  irae: 0,
  total: 0,
};

/**
 * Computes DGI taxes for a single unit sale.
 *
 * - Literal E / pequeña empresa: no IVA is broken down on the sale and purchase IVA
 *   is a direct cost (already inside `merchandiseCost`). Taxes per unit = 0
 *   (the fixed monthly DGI/BPS contribution is an overhead, not a per-unit cost).
 * - Régimen general: IVA débito on the sale minus creditable IVA from the
 *   purchase invoice and from services invoiced to the RUT. Optionally provisions IRAE.
 *
 * The net IVA can be negative (saldo a favor), which offsets IVA from other sales.
 */
export function computeTaxes(op: TaxableOperation, settings: TaxSettings): TaxBreakdown {
  if (settings.regime === "literal_e") return ZERO_TAXES;

  const productRate = typeof settings.vatRate === "number" ? settings.vatRate : IVA_RATE;
  const vatDebit = vatIncluded(op.salePrice, productRate);
  const vatCreditCost = settings.costIncludesVat ? vatIncluded(op.merchandiseCost, productRate) : 0;
  const vatCreditServices = settings.feesInvoicedWithRut
    ? vatIncluded(op.platformFees + op.shipping, IVA_RATE)
    : 0;
  const vatPayable = vatDebit - vatCreditCost - vatCreditServices;

  const profitAfterVat = op.grossProfit - vatPayable;
  const irae = settings.provisionIrae ? Math.max(0, profitAfterVat) * settings.iraeRate : 0;

  return {
    vatDebit,
    vatCreditCost,
    vatCreditServices,
    vatPayable,
    irae,
    total: vatPayable + irae,
  };
}
