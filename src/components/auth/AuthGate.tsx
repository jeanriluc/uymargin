import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { AUTH_DISABLED_IN_DEV, onAccessProblem } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import { AccessScreen, LoginScreen } from "./LoginScreen";

interface AuthContextValue {
  /** Correo de la sesión; null en desarrollo sin login. */
  email: string | null;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({ email: null, signOut: () => {} });

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type GateState =
  | { status: "loading" }
  | { status: "unconfigured" }
  | { status: "signedOut"; notice?: string }
  | { status: "signedIn"; email: string | null }
  | { status: "forbidden"; email: string | null };

/** Si el enlace mágico venció o ya se usó, Supabase vuelve con el error en la URL. */
function linkErrorFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  if (!params.get("error") && !params.get("error_code")) return undefined;
  window.history.replaceState(null, "", window.location.pathname);
  return "El enlace venció o ya se usó. Pedí uno nuevo.";
}

/** Muestra la app solo con sesión. Todo lo que está adentro puede usar useAuth(). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>(
    AUTH_DISABLED_IN_DEV ? { status: "signedIn", email: null } : { status: "loading" }
  );

  useEffect(() => {
    if (AUTH_DISABLED_IN_DEV) return;
    let cancelled = false;
    let unsubscribe = () => {};
    const notice = linkErrorFromUrl();

    getSupabaseClient().then(async (client) => {
      if (cancelled) return;
      if (!client) return setState({ status: "unconfigured" });

      const { data } = await client.auth.getSession();
      if (cancelled) return;
      setState(
        data.session
          ? { status: "signedIn", email: data.session.user.email ?? null }
          : { status: "signedOut", notice }
      );

      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        setState((prev) => {
          if (!session) return prev.status === "signedOut" ? prev : { status: "signedOut" };
          // Un correo no permitido sigue bloqueado aunque Supabase renueve su sesión.
          const email = session.user.email ?? null;
          if (prev.status === "forbidden" && prev.email === email) return prev;
          if (prev.status === "signedIn" && prev.email === email) return prev;
          return { status: "signedIn", email };
        });
      });
      unsubscribe = () => listener.subscription.unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(() => {
    getSupabaseClient().then((client) => client?.auth.signOut({ scope: "local" }));
    setState({ status: "signedOut" });
  }, []);

  // El servidor es quien decide: 401 = sesión vencida, 403 = correo que no está en la lista.
  useEffect(() => {
    if (AUTH_DISABLED_IN_DEV) return;
    return onAccessProblem((problem) => {
      if (problem === "forbidden") {
        setState((prev) => (prev.status === "signedIn" ? { status: "forbidden", email: prev.email } : prev));
        return;
      }
      getSupabaseClient().then((client) => client?.auth.signOut({ scope: "local" }));
      setState({ status: "signedOut", notice: "Tu sesión venció. Volvé a entrar." });
    });
  }, []);

  if (state.status === "loading") {
    return (
      <AccessScreen>
        <p role="status" className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Comprobando tu sesión…
        </p>
      </AccessScreen>
    );
  }

  if (state.status === "unconfigured") {
    return (
      <AccessScreen title="Falta configurar el acceso">
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          Esta instalación no tiene definidas las variables de Supabase para iniciar sesión. Avisale al administrador.
        </p>
      </AccessScreen>
    );
  }

  if (state.status === "forbidden") {
    return (
      <AccessScreen title="Tu correo no tiene acceso">
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {state.email ? (
            <>
              Entraste como <b className="break-all">{state.email}</b>, pero ese correo no está habilitado para usar UyMargin.
            </>
          ) : (
            "Tu correo no está habilitado para usar UyMargin."
          )}{" "}
          Pedile al administrador que lo habilite.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="mt-5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          Salir y usar otro correo
        </button>
      </AccessScreen>
    );
  }

  if (state.status === "signedOut") return <LoginScreen notice={state.notice} />;

  return <AuthContext.Provider value={{ email: state.email, signOut }}>{children}</AuthContext.Provider>;
}
