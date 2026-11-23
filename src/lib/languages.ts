import US from "country-flag-icons/react/3x2/US";
import CN from "country-flag-icons/react/3x2/CN";

import type { Language } from "@/lib/language-preference";

type FlagComponent = typeof US;

export type LanguageOption = {
  value: Language;
  labelKey: string;
  Flag: FlagComponent;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "en", labelKey: "languageEn", Flag: US },
  { value: "zh", labelKey: "languageZh", Flag: CN },
];
