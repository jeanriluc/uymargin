import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { getSupabaseClient } from "@/lib/supabase";

/** Marco de las pantallas de acceso: mismo fondo y bloque de marca que la app. */
export function AccessScreen({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f6] dark:bg-[#0c0c0e] text-[#121212] dark:text-[#f2f2f3] flex flex-col font-sans transition-colors bg-editorial-dots">
      <div className="flex justify-end px-4 py-3 sm:px-6">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-surface p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div role="img" aria-label="UyMargin" className="flex size-10 shrink-0 items-center justify-center bg-black text-white dark:bg-white dark:text-black font-black text-base tracking-tighter shadow-sm">
              UY
            </div>
            <div className="min-w-0">
              <p className="heading-grotesk text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">UyMargin</p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Rentabilidad mayorista
              </p>
            </div>
          </div>
          {title && <h1 className="mb-3 text-base font-black text-zinc-900 dark:text-zinc-100">{title}</h1>}
          {children}
        </div>
      </main>
    </div>
  );
}

type SendState = { status: "idle" } | { status: "sending" } | { status: "sent"; email: string } | { status: "error"; message: string };

export function LoginScreen({ notice }: { notice?: string }) {
  const [email, setEmail] = useState("");
  const [send, setSend] = useState<SendState>({ status: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address || send.status === "sending") return;
    setSend({ status: "sending" });

    const client = await getSupabaseClient();
    if (!client) {
      setSend({ status: "error", message: "No se pudo iniciar el acceso. Recargá la página y probá de nuevo." });
      return;
    }
    const { error } = await client.auth.signInWithOtp({
      email: address,
      // Los registros están cerrados: solo entran los correos invitados desde el panel de Supabase.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });

    if (!error) return setSend({ status: "sent", email: address });
    // Un correo sin invitación recibe la misma pantalla que uno invitado: no se revela quién tiene cuenta.
    if (error.code === "otp_disabled" || error.code === "signup_disabled" || /signups? not allowed/i.test(error.message)) {
      return setSend({ status: "sent", email: address });
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return setSend({ status: "error", message: "Ya pediste un enlace hace muy poco. Esperá un minuto y probá de nuevo." });
    }
    if (error.code === "validation_failed" || error.code === "email_address_invalid") {
      return setSend({ status: "error", message: "Ese correo no parece válido. Revisalo y probá de nuevo." });
    }
    setSend({ status: "error", message: "No se pudo enviar el enlace. Probá de nuevo en un rato." });
  }

  if (send.status === "sent") {
    return (
      <AccessScreen title="Revisá tu correo">
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-sm leading-relaxed text-emerald-800 dark:text-emerald-300">
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p role="status">
            Si <b className="break-all">{send.email}</b> está invitado, te mandamos un enlace para entrar. Abrilo en este mismo dispositivo.
          </p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Puede tardar un par de minutos. Si no aparece, mirá en correo no deseado.
        </p>
        <button
          type="button"
          onClick={() => setSend({ status: "idle" })}
          className="mt-5 w-full rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          Usar otro correo
        </button>
      </AccessScreen>
    );
  }

  const message = send.status === "error" ? send.message : notice;

  return (
    <AccessScreen title="Ingresá a UyMargin">
      <p className="mb-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        Te mandamos un enlace a tu correo para entrar, sin contraseña. Solo funciona con correos invitados.
      </p>
      {message && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          {message}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="login-email" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          Correo
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-400" aria-hidden />
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            placeholder="nombre@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 py-2.5 pl-9 pr-3 text-base sm:text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-black dark:focus:border-white transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={!email.trim() || send.status === "sending"}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-black transition-opacity cursor-pointer disabled:cursor-not-allowed"
        >
          {send.status === "sending" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {send.status === "sending" ? "Enviando…" : "Enviarme el enlace"}
        </button>
      </form>
    </AccessScreen>
  );
}
