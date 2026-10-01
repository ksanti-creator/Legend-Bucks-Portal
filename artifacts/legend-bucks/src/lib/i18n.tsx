import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, useGetMe, useUpdateLanguagePreferences } from "@workspace/api-client-react";
import { getSessionToken } from "@/lib/auth-token";
import { setFormattingLanguage, type Language } from "@/lib/locale";
import common from "@/lib/locales/common";
import errors from "@/lib/locales/errors";
import consumer from "@/lib/locales/consumer";
import admin from "@/lib/locales/admin";
import checkout from "@/lib/locales/checkout";

export type { Language } from "@/lib/locale";
export type TranslationParams = Record<string, string | number>;
const french: Record<string, string> = { ...consumer, ...admin, ...checkout, ...common, ...errors };
const englishByFrench = new Map(Object.entries(french).map(([en, fr]) => [fr, en]));
const STORAGE_KEY = "legend_bucks_language";
const LOGIN_CHOICE_KEY = "legend_bucks_login_language_choice";
const labels: Record<string, string> = {
  admin: "Administrator", manager: "Manager", team_member: "Team Member", accounting_admin: "Accounting Admin",
  active: "Active", inactive: "Inactive", invited: "Invited", pending: "Pending", approved: "Approved",
  requested: "Requested", pending_issue: "Awaiting issue", emailed: "Emailed", email_failed: "Email failed",
  voided: "Voided", reissued: "Reissued",
  rejected: "Rejected", cancelled: "Cancelled", fulfilled: "Fulfilled", payroll_pending: "Awaiting payroll",
  pending_payroll: "Awaiting payroll", awaiting_payroll: "Awaiting payroll",
  merchandise: "Merchandise", gift_card: "Gift Card", time_off: "Time Off", experience: "Experience",
  Merch: "Merchandise", "Gift Card": "Gift Card", "Time Off": "Time Off", Experience: "Experience",
  award: "Award", redemption: "Redemption", refund: "Refund", adjustment: "Adjustment",
  redemption_debit: "Redemption", contribution: "Contribution", goal_contribution: "Goal contribution",
  new_employee: "New employee",
  starting_balance: "Starting Balance", transfer: "Transfer", bonus: "Bonus",
  spend: "Spend", reversal: "Reversal", issue: "Issued", void: "Voided",
};

function storedLanguage(): Language {
  try { return localStorage.getItem(STORAGE_KEY) === "fr-CA" ? "fr-CA" : "en"; }
  catch { return "en"; }
}
function remember(language: Language) {
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Preference still works for this visit. */ }
}
function storedLoginChoice(): Language | undefined {
  if (getSessionToken()) return undefined;
  try {
    const choice = localStorage.getItem(LOGIN_CHOICE_KEY);
    return choice === "en" || choice === "fr-CA" ? choice : undefined;
  } catch { return undefined; }
}
export function translate(language: Language, source: string, params?: TranslationParams): string {
  const text = language === "fr-CA" ? french[source] ?? source : source;
  return params ? text.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match)) : text;
}

type I18nValue = {
  language: Language;
  locale: string;
  authenticated: boolean;
  pending: boolean;
  saving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  chooseLanguage: (language: Language) => void;
  saveLanguage: () => Promise<void>;
  cancelLanguage: () => void;
  loginPreference: { preferredLanguage?: Language };
  t: (source: string, params?: TranslationParams) => string;
  label: (identifier: string | null | undefined) => string;
  error: (message: unknown) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  currency: (dollars: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
};
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { enabled: !!getSessionToken(), queryKey: getGetMeQueryKey() } });
  const mutation = useUpdateLanguagePreferences();
  const [guestLanguage, setGuestLanguage] = useState<Language>(storedLanguage);
  const [guestChoice, setGuestChoice] = useState<Language | undefined>(storedLoginChoice);
  const [draft, setDraft] = useState<{ userId: number; language: Language } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const savedLanguage = user?.preferredLanguage === "fr-CA" ? "fr-CA" : "en";
  const language = user ? (draft?.userId === user.id ? draft.language : savedLanguage) : guestLanguage;
  const pending = !!user && language !== savedLanguage;
  const locale = language === "fr-CA" ? "fr-CA" : "en-CA";
  // Set before rendering children so legacy formatting utilities use the same locale.
  setFormattingLanguage(language);
  const t = (source: string, params?: TranslationParams) => translate(language, source, params);
  const error = (message: unknown): string => {
    const candidate = message as { data?: { error?: unknown }; message?: unknown } | null;
    const raw = typeof message === "string" ? message
      : typeof candidate?.data?.error === "string" ? candidate.data.error
      : typeof candidate?.message === "string" ? candidate.message : "";
    if (!raw) return t("An unexpected error occurred. Please try again.");
    // Known API errors are localized. Preserve unknown technical details rather than hiding them.
    if (french[raw]) return t(raw);
    if (language === "en" && englishByFrench.has(raw)) return englishByFrench.get(raw)!;
    const upload = /^Upload failed \((\d+)\)$/.exec(raw);
    if (upload) return t("Upload failed ({status})", { status: upload[1] });
    return raw;
  };
  useEffect(() => {
    document.documentElement.lang = language;
    remember(language);
  }, [language]);
  useEffect(() => {
    setDraft(null);
    setSaveError(null);
    setSaveSuccess(false);
    if (user) {
      setGuestChoice(undefined);
      try { localStorage.removeItem(LOGIN_CHOICE_KEY); } catch { /* Storage may be unavailable. */ }
      setGuestLanguage(savedLanguage);
    }
  }, [user?.id]);
  useEffect(() => {
    if (user) setGuestLanguage(savedLanguage);
  }, [user?.id, savedLanguage]);

  const chooseLanguage = (next: Language) => {
    if (mutation.isPending) return;
    setSaveError(null);
    setSaveSuccess(false);
    if (user) setDraft({ userId: user.id, language: next });
    else {
      setGuestLanguage(next);
      setGuestChoice(next);
      remember(next);
      try { localStorage.setItem(LOGIN_CHOICE_KEY, next); } catch { /* Keep the in-memory choice. */ }
    }
  };
  const saveLanguage = async () => {
    if (!user || !pending || mutation.isPending) return;
    const userId = user.id;
    const requested = language;
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const preferences = await mutation.mutateAsync({ data: { preferredLanguage: requested } });
      queryClient.setQueryData(getGetMeQueryKey(), (current: typeof user | undefined) =>
        current?.id === userId ? { ...current, preferredLanguage: preferences.preferredLanguage } : current);
      setDraft(null);
      setSaveSuccess(true);
      // Server-authored activity descriptions use the saved account language.
      await queryClient.invalidateQueries();
    } catch (err) {
      setSaveError(t("Could not save your language preference. Your choice has not been saved. Please try again.") + " " + error(err));
    }
  };
  return (
    <I18nContext.Provider value={{
      language, locale, authenticated: !!user, pending, saving: mutation.isPending, saveError, saveSuccess,
      chooseLanguage, saveLanguage,
      cancelLanguage: () => { setDraft(null); setSaveError(null); setSaveSuccess(false); },
      loginPreference: guestChoice ? { preferredLanguage: guestChoice } : {},
      t, error,
      label: (identifier) => identifier ? t(labels[identifier] ?? identifier) : t("None"),
      number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
      currency: (dollars, options) => new Intl.NumberFormat(locale, { style: "currency", currency: "CAD", ...options }).format(dollars),
      date: (value, options) => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? t("Invalid date")
          : new Intl.DateTimeFormat(locale, options ?? { year: "numeric", month: "short", day: "numeric" }).format(parsed);
      },
    }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export function I18nText({ text, params }: { text: string; params?: TranslationParams }) {
  return <>{useI18n().t(text, params)}</>;
}