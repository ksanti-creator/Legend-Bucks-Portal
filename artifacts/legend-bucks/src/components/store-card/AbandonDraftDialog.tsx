import { useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/lib/i18n";

/**
 * Abandoning an uncertain request risks a duplicate charge if the original went through.
 * Require an explicit reconciliation check and re-typing of the identifying reference.
 */
export function AbandonDraftDialog({
  open, onOpenChange, expected, refLabel, checkText, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expected: string;
  refLabel: string;
  checkText: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === expected.trim().toLowerCase() && expected.trim() !== "";
  const close = (o: boolean) => { if (!o) { setChecked(false); setTyped(""); } onOpenChange(o); };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Abandon uncertain request?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("The server may already have recorded this. Retrying is always safe and cannot charge twice. Abandon only after the admin reconciliation list confirms no transaction exists for this {reference}. Starting over creates a new request that could charge again.", { reference: t(refLabel).toLowerCase() })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} data-testid="checkbox-abandon-verified" />
            <span>{t(checkText)}</span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="abandon-ref">{t("Type the {reference} to confirm:", { reference: t(refLabel).toLowerCase() })} <span className="font-mono">{expected}</span></Label>
            <Input id="abandon-ref" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="input-abandon-ref" />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Keep draft")}</AlertDialogCancel>
          <Button variant="destructive" disabled={!checked || !matches} onClick={() => { onConfirm(); close(false); }} data-testid="button-confirm-abandon">
            {t("Abandon draft")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
