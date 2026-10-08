import { Monitor, Moon, Sun } from "lucide-react";
import { nextThemeChoice, useTheme, type ThemeChoice } from "@/lib/theme";

const LABEL: Record<ThemeChoice, string> = {
  light: "claro",
  dark: "oscuro",
  auto: "automático",
};

const ICON: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  auto: Monitor,
};

/** Rota entre claro, oscuro y automático. El ícono muestra el modo elegido. */
export function ThemeToggle() {
  const { choice, resolved, cycle } = useTheme();
  const Icon = ICON[choice];
  const detail = choice === "auto" ? ` (ahora ${LABEL[resolved]}, según el sistema)` : "";
  const label = `Tema: ${LABEL[choice]}${detail}. Cambiar a ${LABEL[nextThemeChoice(choice)]}`;

  return (
    <button
      type="button"
      id="theme-toggle"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="size-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-800 dark:text-zinc-200 hover:border-black dark:hover:border-white transition-colors cursor-pointer shadow-sm"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
