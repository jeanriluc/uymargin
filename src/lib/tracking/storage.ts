import type { TrackedCompetitor, TriggeredAlert, TrackingStats } from "./types";
import { getSupabaseClient } from "@/lib/supabase";

const STORAGE_KEY = "uymargin_tracked_competitors";

// Example records kept for reference only. They are NOT loaded into the app: tracked competitors
// must come from real listings the user adds (PRODUCT.md, "Evidencia real, nunca fabricada").
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const INITIAL_TRACKED_ITEMS: TrackedCompetitor[] = [
  {
    id: "MLU36006952",
    productId: "MLU36006952",
    title: "Botella termo Stanley Classic, 950 ml, color verde martillado | Cuotas sin interés",
    permalink: "https://www.mercadolibre.com.uy/botella-termo-stanley-classic-950-ml-color-verde-martillado/p/MLU36006952",
    thumbnail: "https://http2.mlstatic.com/D_NQ_NP_664195-MLU78142130761_082024-F.webp",
    seller: "Tienda Oficial Stanley UY",
    sellerBadge: "Tienda Oficial",
    sellerCity: "Montevideo",
    currency: "UYU",
    initialPrice: 3490,
    currentPrice: 3190,
    lowestPrice: 3190,
    highestPrice: 3690,
    inStock: true,
    alertThresholdPct: 5,
    alertOnDrop: true,
    alertOnMarginRisk: true,
    myTargetMarginPct: 20,
    myLandedCostUyu: 1850,
    priceHistory: [
      { date: new Date(Date.now() - 14 * 86400000).toISOString(), price: 3490, inStock: true, note: "Precio base inicial" },
      { date: new Date(Date.now() - 10 * 86400000).toISOString(), price: 3690, inStock: true, note: "Aumento por reposición" },
      { date: new Date(Date.now() - 6 * 86400000).toISOString(), price: 3490, inStock: true, note: "Normalización de precio" },
      { date: new Date(Date.now() - 2 * 86400000).toISOString(), price: 3290, inStock: true, note: "Campaña de descuento" },
      { date: new Date().toISOString(), price: 3190, inStock: true, note: "Oferta relámpago (-8.6%)" },
    ],
    triggeredAlerts: [
      {
        id: "alert_1",
        competitorId: "MLU36006952",
        competitorTitle: "Botella termo Stanley Classic 950 ml",
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        type: "price_drop",
        message: "El competidor bajó el precio de $U 3.490 a $U 3.290 (-5.7%).",
        oldPrice: 3490,
        newPrice: 3290,
        pctChange: -5.7,
        read: true,
      },
      {
        id: "alert_2",
        competitorId: "MLU36006952",
        competitorTitle: "Botella termo Stanley Classic 950 ml",
        date: new Date().toISOString(),
        type: "price_drop",
        message: "Alerta crítica: Nuevo mínimo de $U 3.190 (-8.6% vs inicial). Margen proyectado cae al 16.8%.",
        oldPrice: 3290,
        newPrice: 3190,
        pctChange: -3.0,
        read: false,
      },
    ],
    lastChecked: new Date().toISOString(),
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    status: "alert_triggered",
  },
  {
    id: "MLU69842105",
    productId: "MLU69842105",
    title: "Olla A Presion Electrica 5 Lts Xion Xi-op105 900w / Color Negro | Cuotas sin interés",
    permalink: "https://www.mercadolibre.com.uy/olla-a-presion-electrica-5-lts-xion-xi-op105-900w-color-negro/p/MLU69842105",
    thumbnail: "https://http2.mlstatic.com/D_NQ_NP_906939-MLA91902809756_092025-F.webp",
    seller: "Distribuidor Electro Platinum",
    sellerBadge: "MercadoLíder Platinum",
    sellerCity: "Manga, Montevideo",
    currency: "UYU",
    initialPrice: 2490,
    currentPrice: 2490,
    lowestPrice: 2390,
    highestPrice: 2490,
    inStock: true,
    alertThresholdPct: 5,
    alertOnDrop: true,
    alertOnMarginRisk: true,
    myTargetMarginPct: 22,
    myLandedCostUyu: 1140,
    priceHistory: [
      { date: new Date(Date.now() - 12 * 86400000).toISOString(), price: 2490, inStock: true, note: "Precio estable de catálogo" },
      { date: new Date(Date.now() - 7 * 86400000).toISOString(), price: 2390, inStock: true, note: "Promo fin de semana" },
      { date: new Date(Date.now() - 3 * 86400000).toISOString(), price: 2490, inStock: true, note: "Retorno a precio de lista" },
      { date: new Date().toISOString(), price: 2490, inStock: true, note: "Verificado hoy (En stock)" },
    ],
    triggeredAlerts: [],
    lastChecked: new Date().toISOString(),
    createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    status: "active",
  },
];

/** Retrieve all tracked competitors from localStorage. Empty until the user adds one. */
export function getTrackedCompetitors(): TrackedCompetitor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to load tracked competitors from storage", e);
    return [];
  }
}

/** Sync tracked items to Supabase cloud if connected */
export async function syncTrackedToSupabase(items: TrackedCompetitor[]): Promise<{ ok: boolean; failed: number }> {
  if (typeof window === "undefined") return { ok: true, failed: 0 };
  const client = await getSupabaseClient();
  if (!client || items.length === 0) return { ok: true, failed: 0 };

  let failed = 0;
  try {
    for (const item of items) {
      // supabase-js reports failures in `error` instead of throwing.
      const { error } = await client.from("competitor_tracking").upsert({
        id: item.id,
        product_id: item.productId || item.id,
        title: item.title,
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        seller: item.seller,
        seller_badge: item.sellerBadge,
        seller_city: item.sellerCity,
        currency: item.currency,
        initial_price: item.initialPrice,
        current_price: item.currentPrice,
        lowest_price: item.lowestPrice,
        highest_price: item.highestPrice,
        in_stock: item.inStock,
        alert_threshold_pct: item.alertThresholdPct,
        alert_on_drop: item.alertOnDrop,
        alert_on_margin_risk: item.alertOnMarginRisk,
        my_target_margin_pct: item.myTargetMarginPct,
        my_landed_cost_uyu: item.myLandedCostUyu,
        status: item.status,
        last_checked: item.lastChecked,
      });
      if (error) {
        failed++;
        console.warn("[syncTrackedToSupabase] no se pudo sincronizar", item.id, error.message);
      }
    }
  } catch (err) {
    console.warn("[syncTrackedToSupabase] error syncing items:", err);
    return { ok: false, failed: items.length };
  }
  if (failed > 0) {
    window.dispatchEvent(new CustomEvent("uymargin_tracking_sync_failed", { detail: { failed } }));
  }
  return { ok: failed === 0, failed };
}

/** Save full list to storage */
export function saveTrackedList(items: TrackedCompetitor[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("uymargin_tracking_updated", { detail: items }));
    syncTrackedToSupabase(items);
  } catch (e) {
    console.error("Failed to persist tracked competitors", e);
  }
}

/** Add or update a competitor to track */
export function addOrUpdateTrackedCompetitor(
  item: Omit<TrackedCompetitor, "createdAt" | "lastChecked" | "priceHistory" | "triggeredAlerts" | "status" | "lowestPrice" | "highestPrice"> & {
    priceHistory?: TrackedCompetitor["priceHistory"];
    triggeredAlerts?: TrackedCompetitor["triggeredAlerts"];
  }
): TrackedCompetitor {
  const current = getTrackedCompetitors();
  const existingIdx = current.findIndex((c) => c.id === item.id || (c.permalink && c.permalink === item.permalink));

  const now = new Date().toISOString();
  let updatedRecord: TrackedCompetitor;

  if (existingIdx >= 0) {
    const prev = current[existingIdx];
    const newPrice = item.currentPrice;
    const history = prev.priceHistory || [];

    // Add point if price differs or if last point is > 12h old
    const lastPoint = history[history.length - 1];
    const isDifferent = !lastPoint || lastPoint.price !== newPrice;

    const newHistory = isDifferent
      ? [...history, { date: now, price: newPrice, inStock: item.inStock ?? true }]
      : history;

    updatedRecord = {
      ...prev,
      ...item,
      lowestPrice: Math.min(prev.lowestPrice, newPrice),
      highestPrice: Math.max(prev.highestPrice, newPrice),
      priceHistory: newHistory,
      lastChecked: now,
    };
    current[existingIdx] = updatedRecord;
  } else {
    updatedRecord = {
      ...item,
      lowestPrice: item.currentPrice,
      highestPrice: item.currentPrice,
      priceHistory: [
        {
          date: now,
          price: item.currentPrice,
          inStock: item.inStock ?? true,
          note: "Inicio de tracking",
        },
      ],
      triggeredAlerts: [],
      status: "active",
      createdAt: now,
      lastChecked: now,
    };
    current.unshift(updatedRecord);
  }

  saveTrackedList(current);
  return updatedRecord;
}

/** Remove a tracked competitor */
export function removeTrackedCompetitor(id: string): void {
  const current = getTrackedCompetitors().filter((c) => c.id !== id);
  saveTrackedList(current);
}

/** Update settings of a tracked item (e.g. alert threshold, landed cost) */
export function updateCompetitorSettings(
  id: string,
  patch: Partial<Pick<TrackedCompetitor, "alertThresholdPct" | "alertOnDrop" | "alertOnMarginRisk" | "myTargetMarginPct" | "myLandedCostUyu" | "status">>
): void {
  const current = getTrackedCompetitors();
  const idx = current.findIndex((c) => c.id === id);
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...patch };
    saveTrackedList(current);
  }
}

/** Mark alert as read */
export function markAlertAsRead(competitorId: string, alertId: string): void {
  const current = getTrackedCompetitors();
  const idx = current.findIndex((c) => c.id === competitorId);
  if (idx >= 0) {
    current[idx].triggeredAlerts = current[idx].triggeredAlerts.map((a) =>
      a.id === alertId ? { ...a, read: true } : a
    );
    // If no unread alerts left, set status to active
    if (!current[idx].triggeredAlerts.some((a) => !a.read && a.type === "price_drop")) {
      current[idx].status = "active";
    }
    saveTrackedList(current);
  }
}

/** Mark all alerts across all competitors as read */
export function markAllAlertsAsRead(): void {
  const current = getTrackedCompetitors();
  const updated = current.map((c) => ({
    ...c,
    status: "active" as const,
    triggeredAlerts: c.triggeredAlerts.map((a) => ({ ...a, read: true })),
  }));
  saveTrackedList(updated);
}

/** Compute aggregate stats for the tracking badge and header */
export function getTrackingStats(): TrackingStats {
  const items = getTrackedCompetitors();
  let unread = 0;
  let activeAlerts = 0;
  let priceDrops = 0;
  let totalVar = 0;

  for (const item of items) {
    for (const a of item.triggeredAlerts) {
      if (!a.read) unread++;
    }
    if (item.status === "alert_triggered") activeAlerts++;
    if (item.currentPrice < item.initialPrice) priceDrops++;
    if (item.initialPrice > 0) {
      totalVar += ((item.currentPrice - item.initialPrice) / item.initialPrice) * 100;
    }
  }

  return {
    totalTracked: items.length,
    activeAlertsCount: activeAlerts,
    unreadAlertsCount: unread,
    priceDropsCount: priceDrops,
    averageVariationPct: items.length > 0 ? totalVar / items.length : 0,
  };
}

/** Export tracking history to CSV */
export function exportTrackingHistoryCsv(items: TrackedCompetitor[]): string {
  const rows = [
    ["ID", "Título", "Vendedor", "Precio Inicial UYU", "Precio Actual UYU", "Precio Mínimo UYU", "Variación %", "Último Chequeo", "En Stock", "Alertas"].join(","),
  ];

  for (const item of items) {
    const varPct = item.initialPrice > 0 ? (((item.currentPrice - item.initialPrice) / item.initialPrice) * 100).toFixed(1) : "0";
    rows.push([
      `"${item.id}"`,
      `"${item.title.replace(/"/g, '""')}"`,
      `"${item.seller.replace(/"/g, '""')}"`,
      item.initialPrice,
      item.currentPrice,
      item.lowestPrice,
      `${varPct}%`,
      `"${item.lastChecked}"`,
      item.inStock ? "Sí" : "No",
      item.triggeredAlerts.length,
    ].join(","));
  }

  return rows.join("\n");
}
