import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface CloudAuditRecord {
  id?: string;
  created_at?: string;
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

const STORAGE_KEY_URL = "uymargin_supabase_url";
const STORAGE_KEY_KEY = "uymargin_supabase_key";

export function getSupabaseConfig(): { url: string; key: string } {
  const envUrl = (typeof process !== "undefined" && process.env?.SUPABASE_URL) || (import.meta as any).env?.VITE_SUPABASE_URL || "";
  const envKey = (typeof process !== "undefined" && process.env?.SUPABASE_ANON_KEY) || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";

  if (typeof window !== "undefined") {
    const localUrl = localStorage.getItem(STORAGE_KEY_URL);
    const localKey = localStorage.getItem(STORAGE_KEY_KEY);
    return {
      url: localUrl || envUrl || "",
      key: localKey || envKey || "",
    };
  }

  return { url: envUrl, key: envKey };
}

export function setSupabaseConfig(url: string, key: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY_URL, url.trim());
    localStorage.setItem(STORAGE_KEY_KEY, key.trim());
  }
}

let clientInstance: SupabaseClient | null = null;
let lastUsedConfig = { url: "", key: "" };

export function getSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;

  if (!clientInstance || lastUsedConfig.url !== url || lastUsedConfig.key !== key) {
    try {
      clientInstance = createClient(url, key, {
        auth: { persistSession: true },
      });
      lastUsedConfig = { url, key };
    } catch (e) {
      console.error("[supabase] initialization error", e);
      return null;
    }
  }

  return clientInstance;
}

export const SUPABASE_SCHEMA_SQL = `-- Ejecutá este script en el editor SQL de tu panel de Supabase:
create table if not exists uymargin_audits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  product_url text,
  thumbnail text,
  target_price numeric,
  target_currency text default 'UYU',
  target_price_uyu numeric,
  competitor_min numeric,
  competitor_median numeric,
  competitor_max numeric,
  competitor_count integer default 0,
  same_product_sellers jsonb default '[]'::jsonb,
  similar_products jsonb default '[]'::jsonb,
  financial_simulation jsonb,
  notes text
);

-- Habilitar lectura y escritura pública para la anon key
alter table uymargin_audits enable row level security;
create policy "Allow all on uymargin_audits" on uymargin_audits for all using (true) with check (true);
`;

export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, message: "Ingresá la URL del proyecto y la Anon Key de Supabase." };
  }

  try {
    const { error } = await client.from("uymargin_audits").select("id").limit(1);
    if (error) {
      if (error.code === "PGRST204" || error.code === "42P01" || error.message?.includes("does not exist")) {
        return {
          ok: false,
          message: "Conexión exitosa, pero la tabla 'uymargin_audits' aún no está creada en Supabase. Creala usando el script SQL adjunto.",
        };
      }
      return { ok: false, message: `Error de Supabase: ${error.message}` };
    }
    return { ok: true, message: "¡Conectado exitosamente con Supabase!" };
  } catch (err: any) {
    return { ok: false, message: err?.message || "No se pudo conectar a Supabase." };
  }
}

export async function saveAuditToCloud(record: CloudAuditRecord): Promise<{ ok: boolean; data?: any; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, error: "Supabase no está configurado. Conectá tu proyecto en el botón de la nube." };
  }

  try {
    const { data, error } = await client.from("uymargin_audits").insert([record]).select();
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error al guardar en la nube" };
  }
}

export async function getCloudAudits(): Promise<{ ok: boolean; data: CloudAuditRecord[]; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }

  try {
    const { data, error } = await client
      .from("uymargin_audits")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, data: [], error: error.message };
    }
    return { ok: true, data: data || [] };
  } catch (err: any) {
    return { ok: false, data: [], error: err?.message || "Error al obtener auditorías de la nube" };
  }
}

export async function deleteCloudAudit(id: string): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: "Supabase no configurado" };

  try {
    const { error } = await client.from("uymargin_audits").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error al eliminar" };
  }
}
