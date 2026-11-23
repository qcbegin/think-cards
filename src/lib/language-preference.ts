// This instance only ships Chinese and English (other locale files are kept
// in src/locales to stay mergeable with upstream, but are not loaded).
export type Language = "en" | "zh";

export const SUPPORTED_LANGUAGES: Language[] = ["en", "zh"];

export const LANGUAGE_STORAGE_KEY = "think-cards-language";

export const isLanguage = (value: string): value is Language =>
  (SUPPORTED_LANGUAGES as string[]).includes(value);

export const getDefaultLanguage = (): Language => {
  if (typeof navigator === "undefined") return "en";

  const lang = navigator.language?.toLowerCase() ?? "";

  if (lang.startsWith("zh")) return "zh";

  return "en";
};

export const readPersistedLanguage = (): Language | null => {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { state?: { language?: unknown } };
    const lang = parsed.state?.language;
    if (typeof lang === "string" && isLanguage(lang)) return lang;

    return null;
  } catch {
    return null;
  }
};

export const resolveInitialLanguage = (): Language => {
  return readPersistedLanguage() ?? getDefaultLanguage();
};
