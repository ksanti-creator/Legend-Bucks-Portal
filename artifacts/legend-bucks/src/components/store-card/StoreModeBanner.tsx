import { useGetStoreGiftCardStatus } from "@workspace/api-client-react";
import { ShieldAlert, FlaskConical } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function StoreModeBanner() {
  const { t } = useI18n();
  const { data: status, isLoading, isError } = useGetStoreGiftCardStatus();
  if (isLoading) return <div className="h-14 rounded-xl bg-muted animate-pulse" />;
  if (isError || !status) {
    return (
      <div role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="status-store-mode">
        {t("Could not read store gift card status. Monetary actions will be refused by the server until status is available.")}
      </div>
    );
  }
  return (
    <div className="flex flex-col sm:flex-row gap-2" data-testid="status-store-mode">
      {status.sandbox && (
        <div role="status" className="flex-1 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <FlaskConical className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
          <div><span className="font-semibold">{t("Sandbox mode.")}</span>{" "}{t("Use dummy cards only. Nothing here affects real customers.")}</div>
        </div>
      )}
      {!status.enabled && (
        <div role="status" className="flex-1 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-destructive" aria-hidden />
          <div><span className="font-semibold">{t("Real store use is disabled.")}</span>{" "}{t("Lookups and spends are blocked until rollout is approved on the server. This cannot be enabled from the portal.")}</div>
        </div>
      )}
      {status.enabled && !status.sandbox && (
        <div role="status" className="flex-1 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <span className="font-semibold">{t("Live.")}</span>{" "}{t("Spends deduct real card balances.")}
        </div>
      )}
    </div>
  );
}
