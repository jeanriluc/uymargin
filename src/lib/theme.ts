import { useEffect, useState } from "react";

/**
 * Tema de la app: claro (por defecto) u oscuro. Lo elige el usuario; el sistema no interviene.
 *
 * El tema se aplica como atributo en <html> (`data-theme="light" | "dark"`). De ese atributo
 * cuelgan la variante `dark:` de Tailwind y los tokens de color de `src/index.css`.
 * `index.html` aplica el mismo criterio antes de que cargue React, para que no haya parpadeo.
 */

export type Theme = "light" | "dark";

/** Misma clave que usa el script de `index.html`. */
export const THEME_STORAGE_KEY = "uymargin:theme:v2";

export const DEFAULT_THEME: Theme = "light";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sin almacenamiento: la elección vale solo para esta visita.
  }
}

/**
 * Tema guardado, o claro si no hay ninguno. Un valor guardado que ya no es válido
 * (por ejemplo el de una versión anterior) se trata como claro y se reescribe.
 */
export function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(saved)) return saved;
    if (saved !== null) saveTheme(DEFAULT_THEME);
  } catch {
    // Sin acceso al almacenamiento: tema por defecto.
  }
  return DEFAULT_THEME;
}

export function otherTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    saveTheme(next);
    setThemeState(next);
  };

  return { theme, setTheme, toggle: () => setTheme(otherTheme(theme)) };
}
