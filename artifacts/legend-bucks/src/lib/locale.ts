export type Language = "en" | "fr-CA";

// Non-React formatting helpers share the locale selected by the provider.
let formattingLanguage: Language = "en";
export function setFormattingLanguage(language: Language) {
  formattingLanguage = language;
}
export function getLocale() {
  return formattingLanguage === "fr-CA" ? "fr-CA" : "en-CA";
}