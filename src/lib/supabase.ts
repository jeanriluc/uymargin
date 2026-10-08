import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";

export interface CloudAuditRecord {
  id?: string;
  created_at?: string;
  /** Quién la guardó (lo completa el servidor). Las anteriores al login no tienen autor. */
  owner_email?: string | null;
  title: string;
  product_url?: string;
  thumbnail?: string | null;
  target_price?: number;
  target_currency?: string;
  target_price_uyu?: number;
  competitor_min?: number;
  competitor_median?: number;
  competitor_max?: number;
  competitor_count?: number;
  same_product_sellers?: Array<{
    seller: string;
    price: number;
    currency: string;
    priceUyu: number;
    permalink?: string;
  }>;
  similar_products?: Array<{
    title: string;
    price: number;
    currency: string;
    permalink: string;
    thumbnail?: string | null;
  }>;
  financial_simulation?: {
    channel: string;
    costWholesale: number;
    sellingPrice: number;
    netMarginPercent: number;
    netProfitUyu: number;
    taxRegime: string;
  };
  notes?: string;
}

// Solo la URL y la clave pública (anon): las variables VITE_* quedan en el JavaScript del navegador.
// La clave secreta vive únicamente en el servidor (server/cloud.ts).
function getSupabaseConfig(): { url: string; key: string } {
  return {
    url: (import.meta.env.VITE_SUPABASE_URL ?? "").trim(),
    key: (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  };
}

/** True when a project URL and anon key are available (does not load the SDK). */
export function isSupabaseConfigured(): boolean {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** Cliente del navegador: se usa para la sesión (enlace mágico). El SDK se descarga la primera vez. */
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return Promise.resolve(null);

  clientPromise ??= import("@supabase/supabase-js")
    .then(({ createClient }) =>
      createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    )
    .catch((e) => {
      console.error("[supabase] initialization error", e);
      clientPromise = null;
      return null;
    });
  return clientPromise;
}

// ------------------------------------------------------------------
// Auditorías guardadas: pasan por el servidor (/api/audits), que es el único que escribe en Supabase.
// ------------------------------------------------------------------
async function errorText(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.message || data?.error || fallback;
}

/** Lectura mínima para el indicador de la nube. */
export async function checkCloudConnection(): Promise<{ ok: boolean; configured: boolean }> {
  try {
    const res = await apiFetch("/api/audits?limit=1");
    if (res.ok) return { ok: true, configured: true };
    const data = await res.json().catch(() => null);
    return { ok: false, configured: data?.code !== "CLOUD_NOT_CONFIGURED" };
  } catch {
    return { ok: false, configured: true };
  }
}

export async function saveAuditToCloud(record: CloudAuditRecord): Promise<{ ok: boolean; data?: CloudAuditRecord; error?: string }> {
  try {
    const res = await apiFetch("/api/audits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audit: record }),
    });
    if (!res.ok) return { ok: false, error: await errorText(res, "No se pudo guardar la auditoría en la nube.") };
    const data = await res.json();
    return { ok: true, data: data.audit };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor para guardar en la nube." };
  }
}

export async function getCloudAudits(): Promise<{ ok: boolean; data: CloudAuditRecord[]; error?: string }> {
  try {
    const res = await apiFetch("/api/audits");
    if (!res.ok) return { ok: false, data: [], error: await errorText(res, "No se pudieron cargar las auditorías guardadas.") };
    const data = await res.json();
    return { ok: true, data: Array.isArray(data.audits) ? data.audits : [] };
  } catch {
    return { ok: false, data: [], error: "No se pudo conectar con el servidor." };
  }
}

export async function deleteCloudAudit(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/audits?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return { ok: false, error: await errorText(res, "No se pudo eliminar la auditoría de la nube.") };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}
