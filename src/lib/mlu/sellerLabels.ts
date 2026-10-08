/** Textos para los datos de vendedor y de oferta que informa Mercado Libre. */

/** level_id de la reputación del vendedor. */
export const REPUTATION: Record<string, { label: string; dot: string }> = {
  "5_green": { label: "Verde", dot: "bg-emerald-500" },
  "4_light_green": { label: "Verde claro", dot: "bg-lime-500" },
  "3_yellow": { label: "Amarilla", dot: "bg-yellow-500" },
  "2_orange": { label: "Naranja", dot: "bg-orange-500" },
  "1_red": { label: "Roja", dot: "bg-red-500" },
};

/** power_seller_status del vendedor. */
export const POWER_SELLER: Record<string, string> = {
  platinum: "MercadoLíder Platinum",
  gold: "MercadoLíder Gold",
  silver: "MercadoLíder",
};

export const CONDITION: Record<string, string> = { new: "Nuevo", used: "Usado", other: "Otra condición" };

export function activeOffersLabel(count: number): string {
  return `${count} ${count === 1 ? "oferta activa" : "ofertas activas"}`;
}
