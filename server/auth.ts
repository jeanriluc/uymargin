import type { NextFunction, Request, Response } from "express";

/**
 * Autenticación de /api/*: token de Supabase en "Authorization: Bearer <token>" y correo en ALLOWED_EMAILS.
 * Este archivo no importa Supabase ni lee .env: la validación del token se inyecta, así se prueba sin red.
 */

export interface AuthUser {
  id: string;
  email: string;
}

/** Devuelve el usuario del token, o null si el token no es válido. Lanza si no se pudo comprobar. */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>;

type Env = Record<string, string | undefined>;

/** El servidor no tiene con qué validar sesiones (faltan variables de Supabase). */
export class AuthNotConfiguredError extends Error {}

/** Usuario que se usa solo con AUTH_DISABLED en desarrollo local. */
export const DEV_USER: AuthUser = { id: "dev-local", email: "dev@local" };

/**
 * AUTH_DISABLED=true solo vale fuera de producción y fuera de Vercel.
 * En producción o en Vercel se ignora aunque esté definida.
 */
export function isAuthDisabled(env: Env = process.env): boolean {
  if (env.AUTH_DISABLED !== "true") return false;
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL) return false;
  return true;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** ALLOWED_EMAILS: lista separada por comas. Vacía = no entra nadie. */
export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter((e) => e.length > 0)
  );
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

export const AUTH_MESSAGES = {
  missing: "Tenés que iniciar sesión para usar UyMargin.",
  invalid: "Tu sesión no es válida o venció. Volvé a iniciar sesión.",
  forbidden: "Tu correo no tiene acceso a UyMargin. Pedile al administrador que lo habilite.",
  unavailable: "No se pudo comprobar tu sesión en este momento. Probá de nuevo en un rato.",
  notConfigured: "El acceso no está configurado en el servidor.",
} as const;

function deny(res: Response, status: number, code: string, message: string) {
  // "message" y "error" llevan el mismo texto: los distintos paneles de la interfaz leen uno u otro.
  return res.status(status).json({ ok: false, code, message, error: message });
}

/** Usuario autenticado del pedido (lo deja el middleware). */
export function requestUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

export function createAuthMiddleware(options: { verifyToken: TokenVerifier; env?: Env }) {
  const { verifyToken } = options;

  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    // Se lee en cada pedido: así el test puede cambiar el entorno, y ALLOWED_EMAILS no queda cacheada.
    const env = options.env ?? process.env;

    if (isAuthDisabled(env)) {
      res.locals.user = DEV_USER;
      return next();
    }

    const token = bearerToken(req.headers.authorization);
    if (!token) return deny(res, 401, "UNAUTHENTICATED", AUTH_MESSAGES.missing);

    let user: AuthUser | null;
    try {
      user = await verifyToken(token);
    } catch (err) {
      if (err instanceof AuthNotConfiguredError) {
        console.error("[auth] acceso sin configurar:", err.message || "faltan variables de Supabase en el servidor");
        return deny(res, 503, "AUTH_NOT_CONFIGURED", AUTH_MESSAGES.notConfigured);
      }
      // Nunca se registra el token ni la respuesta completa de Supabase.
      console.error("[auth] no se pudo validar la sesión:", err instanceof Error ? err.name : "error");
      return deny(res, 503, "AUTH_UNAVAILABLE", AUTH_MESSAGES.unavailable);
    }
    if (!user || !user.email) return deny(res, 401, "INVALID_TOKEN", AUTH_MESSAGES.invalid);

    const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);
    if (!allowed.has(normalizeEmail(user.email))) {
      return deny(res, 403, "FORBIDDEN_EMAIL", AUTH_MESSAGES.forbidden);
    }

    res.locals.user = { id: user.id, email: normalizeEmail(user.email) } satisfies AuthUser;
    return next();
  };
}
