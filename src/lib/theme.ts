import { useEffect, useState } from "react";

/**
 * Tema de la app: claro, oscuro o automático (sigue al sistema).
 *
 * El tema efectivo se aplica como atributo en <html> (`data-theme="light" | "dark"`).
 * Toda la hoja de estilos cuelga de ese atributo: la variante `dark:` de Tailwind y los
 * tokens de color de `src/index.css`. `index.html` aplica el mismo criterio antes de que
 * cargue React, para que no haya un parpadeo al abrir.
 */

export type ThemeChoice = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

/** Misma clave que usa el script de `index.html`. */
export const THEME_STORAGE_KEY = "uymargin:theme:v2";

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function isChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "auto";
}

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

function saveThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Sin almacenamiento: la elección vale solo para esta visita.
  }
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === "auto") return systemPrefersDark ? "dark" : "light";
  return choice;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(SYSTEM_DARK).matches;
}

function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Orden en que rota el botón del encabezado. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  return choice === "light" ? "dark" : choice === "dark" ? "auto" : "light";
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemeChoice(), systemPrefersDark()));

  useEffect(() => {
    const update = () => {
      const theme = resolveTheme(choice, systemPrefersDark());
      setResolved(theme);
      applyTheme(theme);
    };
    update();
    if (choice !== "auto" || typeof window.matchMedia !== "function") return;
    // En automático, seguir los cambios del sistema mientras la app está abierta.
    const media = window.matchMedia(SYSTEM_DARK);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [choice]);

  const setTheme = (next: ThemeChoice) => {
    saveThemeChoice(next);
    setChoice(next);
  };

  return { choice, resolved, setTheme, cycle: () => setTheme(nextThemeChoice(choice)) };
}
