import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "violet" | "teal" | "amber" | "rose" | "slate";

type ThemeState = {
  theme: ThemeMode;
  accent: Accent;
  setTheme: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

function initialTheme(): ThemeMode {
  const saved = localStorage.getItem("tokero.theme");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "light";
}

function initialAccent(): Accent {
  const saved = localStorage.getItem("tokero.accent");
  return ["violet", "teal", "amber", "rose", "slate"].includes(saved ?? "") ? (saved as Accent) : "violet";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);
  const [accent, setAccentState] = useState<Accent>(initialAccent);

  useEffect(() => {
    localStorage.setItem("tokero.theme", theme);
    localStorage.setItem("tokero.accent", accent);
    const root = document.documentElement;
    root.dataset.accent = accent;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, accent]);

  const value = useMemo(
    () => ({
      theme,
      accent,
      setTheme: setThemeState,
      setAccent: setAccentState,
    }),
    [theme, accent],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("ThemeProvider missing");
  return ctx;
}
