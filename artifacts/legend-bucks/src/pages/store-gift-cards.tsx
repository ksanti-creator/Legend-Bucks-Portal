import { useEffect, useRef, useState } from "react";
import { useListMyStores, useLookupStoreGiftCard, useSpendStoreGiftCard } from "@workspace/api-client-react";
import type { StoreCardSpend } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ScanLine, CreditCard, CheckCircle2, AlertTriangle, RotateCcw, Store as StoreIcon } from "lucide-react";
import { StoreModeBanner } from "@/components/store-card/StoreModeBanner";
import { AbandonDraftDialog } from "@/components/store-card/AbandonDraftDialog";
import {
  apiErrorInfo, clearPendingSpend, dollarsToCents, formatCad, isUncertain,
  loadPendingSpend, savePendingSpend, type PendingSpend,
} from "@/lib/store-card";

type Card = { cardId: number; lookupToken: string; maskedCode: string; status: string; balanceCents: number };

function spendErrorText(err: unknown): string {
  const { status, message } = apiErrorInfo(err);
  if (status === 409) return message || "Declined: insufficient balance, receipt already used, or conflicting request.";
  if (status === 403) return "Not permitted. Your store access may have been revoked or store use is disabled.";
  if (status === 404) return "Card is no longer available for spending.";
  if (status === 400) return message || "The spend details were rejected. Check amount and receipt.";
  return "Could not record spend.";
}

export default function StoreGiftCards() {
  const { data: stores, isLoading: storesLoading, isError: storesError, refetch } = useListMyStores();
  const lookup = useLookupStoreGiftCard();
  const spend = useSpendStoreGiftCard();

  const [storeId, setStoreId] = useState<number | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [pending, setPending] = useState<PendingSpend | null>(() => loadPendingSpend());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [result, setResult] = useState<StoreCardSpend | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!stores?.length) return;
    if (pending) setStoreId(pending.storeId);
    else if (storeId === null || !stores.some((s) => s.id === storeId)) setStoreId(stores[0].id);
  }, [stores, pending, storeId]);

  const reset = () => {
    setCard(null); setAmount(""); setReceipt(""); setSpendError(null); setResult(null); setLookupError(null);
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  const handleLookup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = codeRef.current;
    const code = input?.value.trim() ?? "";
    // Clear the secret immediately; it lives only in this request body.
    if (input) input.value = "";
    if (!code || !storeId) return;
    setLookupError(null); setResult(null);
    lookup.mutate({ data: { storeId, code } }, {
      onSuccess: (c) => { setCard(c); setAmount(""); setReceipt(""); },
      onError: (err) => {
        const { status } = apiErrorInfo(err);
        setCard(null);
        setLookupError(
          status === 403 ? "Not permitted. Check store access or rollout status."
          : status === 404 || status === 400 || status === 409 ? "Card not found or not eligible (not issued, not emailed, or voided)."
          : "Lookup failed. Try again.",
        );
      },
    });
  };

  const amountCents = dollarsToCents(amount);
  const receiptTrim = receipt.trim();
  const draftValid = !!card && amountCents !== null && amountCents <= card.balanceCents && receiptTrim.length > 0 && receiptTrim.length <= 100;

  const submit = (p: PendingSpend) => {
    setSpendError(null);
    spend.mutate(
      { data: { storeId: p.storeId, cardId: p.cardId, lookupToken: p.lookupToken, amountCents: p.amountCents, receiptRef: p.receiptRef, idempotencyKey: p.idempotencyKey } },
      {
        onSuccess: (r) => {
          clearPendingSpend(); setPending(null); setResult(r); setCard(null); setAmount(""); setReceipt("");
        },
        onError: (err) => {
          if (isUncertain(err)) {
            // Outcome unknown: keep the same key and lock the draft so only an identical retry is possible.
            const next = { ...p, uncertain: true };
            savePendingSpend(next); setPending(next);
            setSpendError("No confirmation from the server. The spend may or may not have been recorded. Retry sends the identical request and cannot charge twice.");
          } else if (apiErrorInfo(err).status === 409 || apiErrorInfo(err).status === 400) {
            // Definitive decline: nothing was charged; release the key.
            clearPendingSpend(); setPending(null);
            setSpendError(spendErrorText(err));
          } else {
            // e.g. expired checkout token or access change: keep the key so a re-scan retries the same spend.
            const next = { ...p, uncertain: true };
            savePendingSpend(next); setPending(next);
            setSpendError(`${spendErrorText(err)} If the checkout session expired, re-scan the same card below.`);
          }
        },
      },
    );
  };

  const confirmSpend = () => {
    if (!card || !storeId || amountCents === null) return;
    const p: PendingSpend = {
      storeId, cardId: card.cardId, lookupToken: card.lookupToken, maskedCode: card.maskedCode, balanceCents: card.balanceCents,
      amountCents, receiptRef: receiptTrim, idempotencyKey: crypto.randomUUID(), uncertain: false,
    };
    savePendingSpend(p); setPending(p); setConfirmOpen(false);
    submit(p);
  };

  const refreshRef = useRef<HTMLInputElement>(null);
  const refreshToken = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = refreshRef.current;
    const code = input?.value.trim() ?? "";
    if (input) input.value = "";
    if (!code || !pending) return;
    lookup.mutate({ data: { storeId: pending.storeId, code } }, {
      onSuccess: (c) => {
        if (c.cardId !== pending.cardId) { setSpendError("That is a different card. Scan the card from this pending spend."); return; }
        // Same idempotency key, fresh capability token.
        const next = { ...pending, lookupToken: c.lookupToken };
        savePendingSpend(next); setPending(next); submit(next);
      },
      onError: () => setSpendError("Re-scan failed. Check the card and try again."),
    });
  };

  const [abandonOpen, setAbandonOpen] = useState(false);
  const abandonPending = () => { clearPendingSpend(); setPending(null); setSpendError(null); };

  const storeName = stores?.find((s) => s.id === storeId)?.name;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Store Gift Cards</h1>
        <p className="text-muted-foreground mt-1">Check a card balance and record an in-store spend.</p>
      </div>

      <StoreModeBanner />

      {storesLoading ? (
        <div className="space-y-3"><div className="h-10 rounded-lg bg-muted animate-pulse" /><div className="h-40 rounded-xl bg-muted animate-pulse" /></div>
      ) : storesError ? (
        <Card><CardContent className="p-6 flex items-center justify-between gap-4">
          <span className="text-sm">Could not load your stores.</span>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-stores">Retry</Button>
        </CardContent></Card>
      ) : !stores?.length ? (
        <div className="text-center py-16 bg-muted/20 rounded-xl border border-dashed">
          <StoreIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" aria-hidden />
          <h2 className="font-medium">No store access</h2>
          <p className="text-sm text-muted-foreground mt-1">An admin must grant you access to a store before you can verify cards.</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5 max-w-sm">
            <Label htmlFor="store-select">Store</Label>
            <Select value={storeId ? String(storeId) : ""} onValueChange={(v) => { setStoreId(Number(v)); reset(); }} disabled={!!pending || spend.isPending}>
              <SelectTrigger id="store-select" data-testid="select-store"><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {result && (
            <Card className="border-green-600/40 bg-green-50/60" role="status" aria-live="polite" data-testid="card-spend-result">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 className="h-5 w-5" aria-hidden />Spend recorded</div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div><dt className="text-muted-foreground">Card</dt><dd className="font-mono">{result.maskedCode}</dd></div>
                  <div><dt className="text-muted-foreground">Transaction ref</dt><dd className="font-mono font-semibold" data-testid="text-transaction-ref">{result.transactionRef}</dd></div>
                  <div><dt className="text-muted-foreground">Amount spent</dt><dd>{formatCad(result.amountCents)}</dd></div>
                  <div><dt className="text-muted-foreground">Receipt</dt><dd>{result.receiptRef}</dd></div>
                  <div><dt className="text-muted-foreground">Previous balance</dt><dd>{formatCad(result.previousBalanceCents)}</dd></div>
                  <div><dt className="text-muted-foreground">New balance</dt><dd className="text-xl font-display font-bold" data-testid="text-new-balance">{formatCad(result.newBalanceCents)}</dd></div>
                </dl>
                <Button onClick={reset} data-testid="button-next-card">Next card</Button>
              </CardContent>
            </Card>
          )}

          {pending ? (
            <Card className="border-amber-400" data-testid="card-pending-spend">
              <CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />Spend awaiting confirmation</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">This draft is locked. It can only be resent unchanged, using the same request key.</p>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">Card</dt><dd className="font-mono">{pending.maskedCode}</dd></div>
                  <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold">{formatCad(pending.amountCents)}</dd></div>
                  <div><dt className="text-muted-foreground">Receipt</dt><dd>{pending.receiptRef}</dd></div>
                  <div><dt className="text-muted-foreground">Store</dt><dd>{storeName ?? `#${pending.storeId}`}</dd></div>
                </dl>
                {spendError && <p role="alert" className="text-sm text-destructive">{spendError}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => submit(pending)} disabled={spend.isPending} data-testid="button-retry-spend">
                    {spend.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                    {spend.isPending ? "Sending..." : "Retry same spend"}
                  </Button>
                  {!spend.isPending && (
                    <Button variant="ghost" onClick={() => setAbandonOpen(true)} data-testid="button-abandon-spend">Abandon draft</Button>
                  )}
                </div>
                <form onSubmit={refreshToken} className="border-t pt-4 space-y-2" autoComplete="off">
                  <Label htmlFor="refresh-code" className="text-sm">Checkout session expired? Re-scan the same card, then the identical spend is resent.</Label>
                  <div className="flex gap-2">
                    <Input id="refresh-code" ref={refreshRef} type="password" autoComplete="off" spellCheck={false} maxLength={80} placeholder="Re-scan card" disabled={lookup.isPending || spend.isPending} data-testid="input-refresh-code" />
                    <Button type="submit" variant="outline" disabled={lookup.isPending || spend.isPending} data-testid="button-refresh-lookup">Re-scan</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : !result && (
            <>
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" aria-hidden />Scan or enter card</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3" autoComplete="off">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="card-code" className="sr-only">Gift card code</Label>
                      <Input
                        id="card-code" ref={codeRef} type="password" name="gc-secret" autoComplete="off"
                        autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={80} autoFocus
                        placeholder="Scan card or type code" disabled={lookup.isPending} data-testid="input-card-code"
                      />
                    </div>
                    <Button type="submit" disabled={lookup.isPending || !storeId} data-testid="button-lookup">
                      {lookup.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Look up
                    </Button>
                  </form>
                  {lookupError && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="text-lookup-error">{lookupError}</p>}
                </CardContent>
              </Card>

              {card && (
                <Card data-testid="card-lookup-result">
                  <CardContent className="p-6 space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-8 w-8 text-primary" aria-hidden />
                        <div>
                          <div className="font-mono text-lg" data-testid="text-masked-code">{card.maskedCode}</div>
                          <Badge variant="success" className="uppercase text-[10px] tracking-wider">{card.status === "emailed" ? "Active" : card.status}</Badge>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">Balance</div>
                        <div className="text-3xl font-display font-bold text-primary" data-testid="text-balance">{formatCad(card.balanceCents)}</div>
                      </div>
                    </div>

                    {card.balanceCents <= 0 ? (
                      <p className="text-sm text-muted-foreground">This card has no remaining balance.</p>
                    ) : (
                      <form className="grid sm:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); if (draftValid) setConfirmOpen(true); }}>
                        <div className="space-y-1.5">
                          <Label htmlFor="spend-amount">Amount spent (CAD)</Label>
                          <Input id="spend-amount" inputMode="decimal" placeholder="12.50" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={amount !== "" && (amountCents === null || amountCents > card.balanceCents)} aria-describedby="amount-hint" data-testid="input-amount" />
                          <p id="amount-hint" className="text-xs text-muted-foreground">
                            {amount !== "" && amountCents === null ? "Enter dollars with up to 2 decimals, e.g. 12.50."
                              : amountCents !== null && amountCents > card.balanceCents ? "Exceeds card balance."
                              : `Max ${formatCad(card.balanceCents)}`}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="receipt-ref">Store receipt number</Label>
                          <Input id="receipt-ref" maxLength={100} value={receipt} onChange={(e) => setReceipt(e.target.value)} autoComplete="off" data-testid="input-receipt" />
                          <p className="text-xs text-muted-foreground">Must be unique for this store. Do not enter the card code.</p>
                        </div>
                        {spendError && <p role="alert" className="sm:col-span-2 text-sm text-destructive" data-testid="text-spend-error">{spendError}</p>}
                        <div className="sm:col-span-2 flex gap-2">
                          <Button type="submit" disabled={!draftValid} data-testid="button-review-spend">Review spend</Button>
                          <Button type="button" variant="ghost" onClick={reset} data-testid="button-cancel-card">Cancel</Button>
                        </div>
                      </form>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {pending && (
            <AbandonDraftDialog
              open={abandonOpen} onOpenChange={setAbandonOpen} expected={pending.receiptRef} refLabel="Receipt number"
              checkText={`An admin checked Store Card Admin reconciliation and confirmed there is no spend for receipt ${pending.receiptRef} at this store.`}
              onConfirm={abandonPending}
            />
          )}

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm spend</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-1 text-sm">
                    <div>Card <span className="font-mono">{card?.maskedCode}</span> at {storeName}</div>
                    <div>Charge <span className="font-semibold text-foreground">{amountCents !== null ? formatCad(amountCents) : ""}</span>, receipt {receiptTrim}</div>
                    <div>Balance after: {card && amountCents !== null ? formatCad(card.balanceCents - amountCents) : ""}</div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-confirm">Back</AlertDialogCancel>
                <AlertDialogAction onClick={confirmSpend} data-testid="button-confirm-spend">Record spend</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
