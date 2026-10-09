import type { NextFunction, Request, Response } from "express";

/**
 * Límite de uso por usuario, con ventanas fijas de un minuto y de un día (el día corre de medianoche a medianoche en Uruguay, UTC-3).
 * El contador se inyecta: en producción es una función SQL de Supabase (compartida entre instancias);
 * en los tests y como respaldo, un contador en memoria. Este archivo no importa Supabase ni lee .env.
 */

export interface RateRule {
  /** Nombre del grupo de endpoints que comparten contador. */
  scope: string;
  perMinute: number;
  perDay: number;
}

/** Topes por usuario. Búsqueda y análisis de enlaces comparten contador. */
export const RATE_RULES = {
  chat: { scope: "chat", perMinute: 10, perDay: 150 },
  market: { scope: "mercado", perMinute: 60, perDay: 1500 },
  // Identificación por foto: cada uso es una llamada a la IA con una imagen, así que el tope es bajo.
  photo: { scope: "foto", perMinute: 5, perDay: 40 },
} as const satisfies Record<string, RateRule>;

export interface RateCounts {
  minute: number;
  day: number;
}

/** Suma un uso en las dos ventanas y devuelve cuántos van en cada una (contando este). */
export interface RateStore {
  hit(userId: string, scope: string, minuteStart: Date, dayStart: Date): Promise<RateCounts>;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Uruguay no tiene horario de verano: es UTC-3 todo el año. */
const UY_OFFSET_MS = 3 * 60 * 60 * 1000;

export function createMemoryRateStore(): RateStore {
  const counts = new Map<string, number>();
  let lastSweep = 0;
  return {
    async hit(userId, scope, minuteStart, dayStart) {
      // Limpieza ocasional de ventanas viejas, para que el mapa no crezca sin límite.
      if (minuteStart.getTime() - lastSweep > 10 * MINUTE_MS) {
        lastSweep = minuteStart.getTime();
        for (const key of counts.keys()) {
          const start = Number(key.slice(key.lastIndexOf("|") + 1));
          if (start < dayStart.getTime()) counts.delete(key);
        }
      }
      const bump = (kind: string, start: Date) => {
        const key = `${userId}|${scope}|${kind}|${start.getTime()}`;
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      };
      // El minuto actual siempre es posterior al inicio del día, así que la limpieza no lo borra.
      return { minute: bump("m", minuteStart), day: bump("d", dayStart) };
    },
  };
}

export type RateDecision =
  | { ok: true }
  | { ok: false; window: "minuto" | "día"; limit: number; retryAfterSeconds: number };

export async function checkRate(store: RateStore, userId: string, rule: RateRule, now = Date.now()): Promise<RateDecision> {
  const minuteStart = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const dayStart = Math.floor((now - UY_OFFSET_MS) / DAY_MS) * DAY_MS + UY_OFFSET_MS;
  const counts = await store.hit(userId, rule.scope, new Date(minuteStart), new Date(dayStart));

  const secondsUntil = (end: number) => Math.max(1, Math.ceil((end - now) / 1000));
  // El tope diario se informa primero: esperar un minuto no lo resuelve.
  if (counts.day > rule.perDay) {
    return { ok: false, window: "día", limit: rule.perDay, retryAfterSeconds: secondsUntil(dayStart + DAY_MS) };
  }
  if (counts.minute > rule.perMinute) {
    return { ok: false, window: "minuto", limit: rule.perMinute, retryAfterSeconds: secondsUntil(minuteStart + MINUTE_MS) };
  }
  return { ok: true };
}

function waitText(seconds: number): string {
  if (seconds < 90) return `${seconds} segundos`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutos`;
  return `${Math.round(seconds / 3600)} horas`;
}

export function rateLimitMessage(decision: Extract<RateDecision, { ok: false }>): string {
  return `Llegaste al límite de ${decision.limit} usos por ${decision.window}. Probá de nuevo en ${waitText(decision.retryAfterSeconds)}.`;
}

export function createRateLimiter(options: {
  /** Contador principal; puede fallar (por ejemplo, si la migración todavía no se aplicó). */
  store: () => RateStore;
  /** Contador de respaldo cuando el principal falla. */
  fallback: RateStore;
  userId: (res: Response) => string;
  now?: () => number;
}) {
  let lastWarning = 0;

  return function rateLimit(rule: RateRule) {
    return async function limiter(_req: Request, res: Response, next: NextFunction) {
      const userId = options.userId(res);
      const now = options.now?.() ?? Date.now();
      let decision: RateDecision;
      try {
        decision = await checkRate(options.store(), userId, rule, now);
      } catch (err) {
        if (now - lastWarning > MINUTE_MS) {
          lastWarning = now;
          console.warn(
            "[rate-limit] el contador compartido no respondió; se usa el contador en memoria de esta instancia:",
            err instanceof Error ? err.message : "error"
          );
        }
        decision = await checkRate(options.fallback, userId, rule, now);
      }

      if (decision.ok === false) {
        const message = rateLimitMessage(decision);
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        return res.status(429).json({ ok: false, code: "RATE_LIMITED", message, error: message });
      }
      return next();
    };
  };
}
