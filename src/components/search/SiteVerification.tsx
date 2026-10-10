import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { VERIFY_LIMITS, VERIFY_MESSAGES, parseVerifyResponse, signalsPhrase, type SiteVerdict } from "@/lib/web/verify";

/** Un resultado que se puede mandar a verificar. Sin permiso firmado no se manda. */
export interface VerifyCandidate {
  url: string;
  verifyToken?: string;
}

export type SiteCheck = { status: "checking" } | { status: "done"; verdict: SiteVerdict };

export interface Verification {
  /** "failed": no se pudo verificar (falló, no está configurada o se llegó al límite). La lista sigue como estaba. */
  status: "idle" | "checking" | "done" | "failed";
  /** Por dirección. Lo que no figura no se mandó a verificar. */
  checks: ReadonlyMap<string, SiteCheck>;
  /** Repite la verificación. Nunca se repite sola. */
  again: () => void;
}

const NO_CHECKS: ReadonlyMap<string, SiteCheck> = new Map();

/**
 * Verifica los sitios de una lista de resultados: una vez por cada lista nueva (`listKey` cambia cuando llegan
 * otros resultados) y después solo con «Verificar de nuevo». Manda como mucho 8, en el orden recibido.
 */
export function useSiteVerification(listKey: object | null, candidates: VerifyCandidate[]): Verification {
  const [state, setState] = useState<{ status: Verification["status"]; checks: ReadonlyMap<string, SiteCheck> }>({ status: "idle", checks: NO_CHECKS });
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    abortRef.current?.abort();
    const picked = candidatesRef.current.slice(0, VERIFY_LIMITS.maxSites);
    if (picked.length === 0) return setState({ status: "idle", checks: NO_CHECKS });
    const sendable = picked.filter((c): c is Required<VerifyCandidate> => typeof c.verifyToken === "string");
    // Sin permisos, el servidor no tiene la verificación configurada: no hay nada que pedir.
    if (sendable.length === 0) return setState({ status: "failed", checks: NO_CHECKS });

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "checking", checks: new Map(sendable.map((c) => [c.url, { status: "checking" }])) });
    try {
      const res = await apiFetch("/api/verify-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: sendable.map((c) => c.verifyToken) }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (abortRef.current !== controller) return;
      const verdicts = res.ok ? parseVerifyResponse(data, sendable.length) : null;
      if (!verdicts) return setState({ status: "failed", checks: NO_CHECKS });
      setState({ status: "done", checks: new Map(sendable.map((c, i) => [c.url, { status: "done", verdict: verdicts[i] }])) });
    } catch {
      if (abortRef.current !== controller) return;
      setState({ status: "failed", checks: NO_CHECKS });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  useEffect(() => {
    if (listKey) void run();
    else {
      abortRef.current?.abort();
      abortRef.current = null;
      setState({ status: "idle", checks: NO_CHECKS });
    }
    return () => abortRef.current?.abort();
    // Solo cuando cambia la lista: los candidatos se leen de la referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  return { ...state, again: () => void run() };
}

/** Sin verificación (por ejemplo, en una lista que no la usa). */
export const NO_VERIFICATION: Verification = { status: "idle", checks: NO_CHECKS, again: () => {} };

/** El veredicto de un sitio, o null si no se verificó o todavía no terminó. */
export function verdictOf(verification: Verification, url: string): SiteVerdict | null {
  const check = verification.checks.get(url);
  return check?.status === "done" ? check.verdict : null;
}

export const isDead = (verification: Verification, url: string) => verdictOf(verification, url)?.live === "dead";

/** ¿La verificación encontró indicios de Uruguay en la página? */
export function verifiedUruguay(verification: Verification, url: string): "confirmado" | "probable" | null {
  const verdict = verdictOf(verification, url);
  if (!verdict || verdict.live !== "alive") return null;
  return verdict.uruguay === "confirmed" ? "confirmado" : verdict.uruguay === "probable" ? "probable" : null;
}

const CHIP = "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold";
const CHIP_STYLES = {
  checking: "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400",
  alive: "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  outOfStock: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  unknown: "border-zinc-400/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  dead: "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300",
} as const;

/** Estado de un sitio ("Verificando…", "Activa", "Agotado", "No se pudo verificar", "Caída") y sus indicios de Uruguay. */
export function SiteStatus({ verification, url }: { verification: Verification; url: string }) {
  const check = verification.checks.get(url);
  if (!check) return null;
  if (check.status === "checking") {
    return (
      <p data-site-status="checking" className={`${CHIP} ${CHIP_STYLES.checking} self-start`}>
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {VERIFY_MESSAGES.checking}
      </p>
    );
  }
  const { verdict } = check;
  const kind = verdict.live === "dead" ? "dead" : verdict.live === "unknown" ? "unknown" : verdict.outOfStock ? "outOfStock" : "alive";
  // Las frases salen de una lista fija del servidor y se validan al llegar; acá van como texto plano.
  const phrase = signalsPhrase(verdict);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span data-site-status={kind} className={`${CHIP} ${CHIP_STYLES[kind]}`}>
        {VERIFY_MESSAGES[kind]}
      </span>
      {phrase && (
        <span data-site-signals className="min-w-0 break-words text-[11px] text-zinc-600 dark:text-zinc-400">
          {phrase}
        </span>
      )}
    </div>
  );
}

const SMALL_BUTTON =
  "rounded border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-bold text-zinc-700 dark:text-zinc-300 hover:border-black hover:text-black dark:hover:border-white dark:hover:text-white cursor-pointer disabled:opacity-40 disabled:pointer-events-none";

/** Línea de estado de la verificación de una lista, con «Verificar de nuevo». Sin nada que decir, no se muestra. */
export function VerificationNote({ verification }: { verification: Verification }) {
  if (verification.status === "idle") return null;
  return (
    <p data-verify-note={verification.status} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
      <span>
        {verification.status === "checking"
          ? "Verificando que los sitios estén activos y sean de Uruguay…"
          : verification.status === "failed"
            ? `${VERIFY_MESSAGES.failed}.`
            : "Se abrió cada sitio para ver si está activo y si es de Uruguay."}
      </span>
      {verification.status !== "checking" && (
        <button type="button" onClick={verification.again} data-verify-again className={SMALL_BUTTON}>
          Verificar de nuevo
        </button>
      )}
    </p>
  );
}
