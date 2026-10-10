import type { AnalysisInputs } from "@/lib/finance/types";
import { storableProductImage } from "@/lib/productImage";

const STORAGE_KEY = "uymargin:draft:v1";

/**
 * The simulation in progress survives a reload or the phone locking mid-purchase.
 * Only the inputs are stored; results are always recomputed by the finance engine.
 */
export function loadDraft(defaults: AnalysisInputs): AnalysisInputs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<AnalysisInputs> | null;
    if (!saved || typeof saved !== "object") return defaults;
    return {
      ...defaults,
      ...saved,
      // Solo una dirección conocida; un borrador viejo sin el campo queda sin foto.
      productImage: storableProductImage(saved.productImage),
      cost: { ...defaults.cost, ...saved.cost },
      freight: { ...defaults.freight, ...saved.freight },
      tax: { ...defaults.tax, ...saved.tax },
      ml: { ...defaults.ml, ...saved.ml },
      direct: { ...defaults.direct, ...saved.direct },
    };
  } catch {
    return defaults;
  }
}

export function saveDraft(inputs: AnalysisInputs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...inputs, productImage: storableProductImage(inputs.productImage) }));
  } catch {
    // Storage unavailable: the draft is simply not kept.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
