import { useCallback, useEffect, useState } from "react";
import type { ThemePreference } from "@agentos/shared";

const STORAGE_KEY = "color-scheme";

function readSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyThemeToDocument(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "color-scheme");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", pref === "system" ? "light dark" : pref);
}

export function useTheme(initialPreference: ThemePreference = "system"): {
  preference: ThemePreference;
  systemMode: "light" | "dark";
  resolvedMode: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        return stored;
      }
    } catch {
      // Ignore storage access errors.
    }
    return initialPreference;
  });

  const [systemDark, setSystemDark] = useState<boolean>(readSystemDark);

  useEffect(() => {
    applyThemeToDocument(preference);
  }, [preference]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mq.addEventListener("change", listener);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === "light" || event.newValue === "dark") {
        setPreferenceState(event.newValue);
      } else {
        setPreferenceState("system");
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", listener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyThemeToDocument(next);
    try {
      if (next === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // Theme still applies in memory even if localStorage is unavailable.
    }
  }, []);

  const systemMode: "light" | "dark" = systemDark ? "dark" : "light";
  const resolvedMode: "light" | "dark" = preference === "system" ? systemMode : preference;

  return { preference, systemMode, resolvedMode, setPreference };
}
