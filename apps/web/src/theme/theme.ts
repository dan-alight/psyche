export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const themeStorageKey = "psyche.theme";

const themePreferences = new Set<ThemePreference>(["system", "light", "dark"]);

export function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && themePreferences.has(value as ThemePreference);
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference, systemTheme = getSystemTheme()): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const storedPreference = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(storedPreference) ? storedPreference : "system";
  } catch {
    return "system";
  }
}

export function writeStoredThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Storage can fail in privacy modes. The in-memory preference still applies.
  }
}

export function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

export function applyInitialTheme() {
  applyResolvedTheme(resolveTheme(readStoredThemePreference()));
}
