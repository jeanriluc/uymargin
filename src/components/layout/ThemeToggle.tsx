import { Moon, Sun } from "lucide-react";
import { otherTheme, useTheme, type Theme } from "@/lib/theme";

const LABEL: Record<Theme, string> = {
  light: "claro",
  dark: "oscuro",
};

/** Alterna entre claro y oscuro. El ícono muestra el tema al que se pasa al tocar. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const target = otherTheme(theme);
  const Icon = target === "dark" ? Moon : Sun;
  const label = `Tema: ${LABEL[theme]}. Cambiar a ${LABEL[target]}`;

  return (
    <button
      type="button"
      id="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="size-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-800 dark:text-zinc-200 hover:border-black dark:hover:border-white transition-colors cursor-pointer shadow-sm"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
