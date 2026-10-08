import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { AuthNotConfiguredError, requestUser, type AuthUser, type TokenVerifier } from "./auth.js";
import type { RateStore } from "./rateLimit.js";

/**
 * Supabase del lado del servidor: validación de sesiones, auditorías guardadas y contador del límite de uso.
 * La clave secreta (SUPABASE_SERVICE_ROLE_KEY) solo se lee acá; nunca viaja al navegador.
 */

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
}

const SERVER_CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let adminClient: SupabaseClient | null = null;
/** Cliente con la clave secreta: saltea RLS. null si faltan variables. */
function getAdminClient(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const url = supabaseUrl();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  adminClient = createClient(url, key, SERVER_CLIENT_OPTIONS);
  return adminClient;
}

let authClient: SupabaseClient | null = null;
/** Para validar tokens alcanza la clave pública (menor privilegio); sin ella se usa la secreta. */
function getAuthClient(): SupabaseClient | null {
  if (authClient) return authClient;
  const url = supabaseUrl();
  const key = (process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return getAdminClient();
  authClient = createClient(url, key, SERVER_CLIENT_OPTIONS);
  return authClient;
}

// ------------------------------------------------------------------
// Validación del token contra Supabase Auth
// ------------------------------------------------------------------
// Un token ya validado se recuerda un minuto (por su hash, nunca el token) para no consultar a Supabase
// en cada pedido: el Lote hace decenas seguidos. Una sesión revocada deja de servir a lo sumo un minuto después.
const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX = 200;
const tokenCache = new Map<string, { user: AuthUser; expires: number }>();

export const verifySupabaseToken: TokenVerifier = async (token) => {
  const key = createHash("sha256").update(token).digest("hex");
  const cached = tokenCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;
  tokenCache.delete(key);

  const client = getAuthClient();
  if (!client) throw new AuthNotConfiguredError("faltan variables de Supabase en el servidor");

  const { data, error } = await client.auth.getUser(token);
  if (error) {
    const status = typeof error.status === "number" ? error.status : 0;
    // Un 401 sin código, o que habla de la "API key", es Supabase rechazando la clave del servidor
    // (por ejemplo "Legacy API keys are disabled"), no el token del usuario: es un problema de configuración.
    if (/api key/i.test(error.message) || (status === 401 && !error.code)) {
      throw new AuthNotConfiguredError("Supabase rechazó la clave del servidor");
    }
    // Otro 4xx (bad_jwt, sesión inexistente): Supabase rechazó el token. Red o 5xx no dicen nada sobre el token.
    if (status >= 400 && status < 500) return null;
    throw new Error(`Supabase Auth no respondió (HTTP ${status || "sin respuesta"})`);
  }
  const email = data.user?.email;
  if (!data.user || !email) return null;

  const user: AuthUser = { id: data.user.id, email };
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(key, { user, expires: Date.now() + TOKEN_CACHE_TTL_MS });
  return user;
};

// ------------------------------------------------------------------
// Contador del límite de uso (función SQL uymargin_rate_hit, ver supabase/migrations/)
// ------------------------------------------------------------------
export const supabaseRateStore: RateStore = {
  async hit(userId, scope, minuteStart, dayStart) {
    const client = getAdminClient();
    if (!client) throw new Error("falta SUPABASE_SERVICE_ROLE_KEY");
    const { data, error } = await client.rpc("uymargin_rate_hit", {
      p_user_id: userId,
      p_scope: scope,
      p_minute_start: minuteStart.toISOString(),
      p_day_start: dayStart.toISOString(),
    });
    if (error) throw new Error(error.code ? `Supabase ${error.code}` : "Supabase no respondió");
    const row = Array.isArray(data) ? data[0] : data;
    const minute = Number(row?.minute_count);
    const day = Number(row?.day_count);
    if (!Number.isFinite(minute) || !Number.isFinite(day)) throw new Error("respuesta inesperada del contador");
    return { minute, day };
  },
};

// ------------------------------------------------------------------
// Auditorías guardadas (tabla uymargin_audits), compartidas entre los usuarios permitidos
// ------------------------------------------------------------------
const AUDITS_TABLE = "uymargin_audits";
const AUDITS_LIST_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLOUD_MESSAGES = {
  notConfigured: "La nube no está configurada en el servidor.",
  list: "No se pudieron cargar las auditorías guardadas.",
  save: "No se pudo guardar la auditoría en la nube.",
  remove: "No se pudo eliminar la auditoría de la nube.",
} as const;

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, code, message, error: message });
}

/** Error de Supabase en una operación de auditorías. Un 401 es la clave secreta rechazada, no un dato del usuario. */
function cloudFailure(res: Response, action: string, httpStatus: number, error: { code?: string; message: string }, message: string) {
  if (httpStatus === 401) {
    console.error(`[api/audits] Supabase rechazó SUPABASE_SERVICE_ROLE_KEY al ${action}`);
    return fail(res, 503, "CLOUD_NOT_CONFIGURED", CLOUD_MESSAGES.notConfigured);
  }
  console.error(`[api/audits] error al ${action}:`, error.code || error.message);
  return fail(res, 502, "CLOUD_ERROR", message);
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Solo las columnas del esquema, con tipos y tamaños acotados. null = registro inválido. */
export function sanitizeAudit(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const title = text(raw.title, 300);
  if (!title) return null;

  const count = num(raw.competitor_count);
  const record: Record<string, unknown> = {
    title,
    product_url: text(raw.product_url, 1000),
    thumbnail: text(raw.thumbnail, 1000),
    target_price: num(raw.target_price),
    target_currency: text(raw.target_currency, 8),
    target_price_uyu: num(raw.target_price_uyu),
    competitor_min: num(raw.competitor_min),
    competitor_median: num(raw.competitor_median),
    competitor_max: num(raw.competitor_max),
    competitor_count: count === undefined ? undefined : Math.max(0, Math.round(count)),
    same_product_sellers: Array.isArray(raw.same_product_sellers) ? raw.same_product_sellers.slice(0, 100) : undefined,
    similar_products: Array.isArray(raw.similar_products) ? raw.similar_products.slice(0, 50) : undefined,
    financial_simulation:
      raw.financial_simulation && typeof raw.financial_simulation === "object" && !Array.isArray(raw.financial_simulation)
        ? raw.financial_simulation
        : undefined,
    notes: text(raw.notes, 2000),
  };
  // Lo que no vino no se manda: quedan los valores por defecto de la tabla.
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  return record;
}

export async function listAudits(req: Request, res: Response) {
  const client = getAdminClient();
  if (!client) return fail(res, 503, "CLOUD_NOT_CONFIGURED", CLOUD_MESSAGES.notConfigured);
  const asked = parseInt(String(req.query.limit ?? ""), 10);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, AUDITS_LIST_LIMIT) : AUDITS_LIST_LIMIT;
  const { data, error, status } = await client
    .from(AUDITS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return cloudFailure(res, "listar", status, error, CLOUD_MESSAGES.list);
  return res.json({ ok: true, audits: data ?? [] });
}

export async function createAudit(req: Request, res: Response) {
  const client = getAdminClient();
  if (!client) return fail(res, 503, "CLOUD_NOT_CONFIGURED", CLOUD_MESSAGES.notConfigured);
  const record = sanitizeAudit(req.body?.audit);
  if (!record) return fail(res, 400, "INVALID_AUDIT", "La auditoría no tiene título.");

  const user = requestUser(res);
  // El usuario de desarrollo (AUTH_DISABLED) no existe en Supabase: se guarda sin autor.
  const owner = UUID.test(user.id) ? { owner_id: user.id, owner_email: user.email } : {};
  let { data, error, status } = await client
    .from(AUDITS_TABLE)
    .insert([{ ...record, ...owner }])
    .select();
  // PGRST204: la tabla todavía no tiene owner_id / owner_email (migración sin aplicar). Se guarda sin autor.
  if (error?.code === "PGRST204") {
    console.warn("[api/audits] faltan las columnas de autor: aplicá la migración de supabase/migrations/");
    ({ data, error, status } = await client.from(AUDITS_TABLE).insert([record]).select());
  }
  if (error) return cloudFailure(res, "guardar", status, error, CLOUD_MESSAGES.save);
  return res.status(201).json({ ok: true, audit: data?.[0] ?? null });
}

export async function deleteAudit(req: Request, res: Response) {
  const client = getAdminClient();
  if (!client) return fail(res, 503, "CLOUD_NOT_CONFIGURED", CLOUD_MESSAGES.notConfigured);
  const id = String(req.query.id ?? "");
  if (!UUID.test(id)) return fail(res, 400, "INVALID_ID", "Falta el identificador de la auditoría.");

  const { error, status } = await client.from(AUDITS_TABLE).delete().eq("id", id);
  if (error) return cloudFailure(res, "eliminar", status, error, CLOUD_MESSAGES.remove);
  return res.json({ ok: true });
}
