import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/translation.json";
import zh from "@/locales/zh/translation.json";
import { resolveInitialLanguage, SUPPORTED_LANGUAGES } from "@/lib/language-preference";

i18next.use(initReactI18next).init({
  lng: resolveInitialLanguage(),
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGUAGES,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18next;
