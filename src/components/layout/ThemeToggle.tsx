import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "uymargin:theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as "light" | "dark" | null;
    const initialTheme = saved || "light";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  const applyTheme = (t: "light" | "dark") => {
    const root = document.documentElement;
    if (t === "dark") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    }
    localStorage.setItem(THEME_STORAGE_KEY, t);
  };

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      id="theme-toggle"
      onClick={toggle}
      aria-label="Cambiar tema claro / oscuro"
      className="size-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-800 dark:text-zinc-200 hover:border-black dark:hover:border-white transition-colors cursor-pointer shadow-sm"
    >
      {theme === "dark" ? (
        <Sun className="size-4 text-white" aria-hidden />
      ) : (
        <Moon className="size-4 text-black" aria-hidden />
      )}
    </button>
  );
}
