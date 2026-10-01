import { useId } from "react";
import { useI18n, type Language } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Globe, Loader2 } from "lucide-react";

/** Both labels stay in their native language so the control is always discoverable. */
export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const { t, language, chooseLanguage, pending, saving, saveLanguage, cancelLanguage, saveError, saveSuccess } = useI18n();
  return (
    <div className={compact ? "max-w-[230px] space-y-1" : "space-y-2"}>
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={id} className={compact ? "sr-only" : "text-sm font-medium"}>{t("Language")}</label>
        <select id={id} aria-label={t("Language")} value={language} disabled={saving}
          onChange={(event) => chooseLanguage(event.target.value as Language)}
          className="min-h-9 min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="en" lang="en">English</option>
          <option value="fr-CA" lang="fr-CA">Français (Canada)</option>
        </select>
      </div>
      {pending && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t("Language change not saved.")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveLanguage()} disabled={saving} className="h-8 text-xs">
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t("Save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelLanguage} disabled={saving} className="h-8 text-xs">{t("Cancel")}</Button>
          </div>
        </div>
      )}
      {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
      {saveSuccess && !pending && <p role="status" className="text-xs text-muted-foreground">{t("Language preference saved.")}</p>}
    </div>
  );
}