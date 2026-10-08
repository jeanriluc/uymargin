import { getSupabaseClient } from "@/lib/supabase";

/**
 * Llamadas a /api/*: agregan el token de la sesión. Si el servidor responde 401 (sesión vencida) o
 * 403 por correo no permitido, avisan a la pantalla de acceso (AuthGate) además de devolver la respuesta.
 */

/** Solo en desarrollo local: sin login, a juego con AUTH_DISABLED=true en el servidor. Nunca en el build. */
export const AUTH_DISABLED_IN_DEV = import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === "true";

export type AccessProblem = "unauthorized" | "forbidden";
type Listener = (problem: AccessProblem) => void;
const listeners = new Set<Listener>();

export function onAccessProblem(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function accessToken(): Promise<string | null> {
  if (AUTH_DISABLED_IN_DEV) return null;
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    listeners.forEach((l) => l("unauthorized"));
  } else if (res.status === 403) {
    const data = await res.clone().json().catch(() => null);
    if (data?.code === "FORBIDDEN_EMAIL") listeners.forEach((l) => l("forbidden"));
  }
  return res;
}
