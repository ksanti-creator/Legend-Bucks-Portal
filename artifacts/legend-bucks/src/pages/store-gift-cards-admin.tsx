import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe, useListStores, useCreateStore, useListStoreAccess, useGrantStoreAccess, useRevokeStoreAccess,
  useReverseStoreGiftCardSpend, useListLocations, useListEmployees, useListStoreGiftCardTransactions,
  getListStoresQueryKey, getListStoreAccessQueryKey, getListStoreGiftCardTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { StoreCardSpend } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Undo2, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { StoreModeBanner } from "@/components/store-card/StoreModeBanner";
import { AbandonDraftDialog } from "@/components/store-card/AbandonDraftDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  apiErrorInfo, clearPendingReversal, formatCad, isUncertain, loadPendingReversal, savePendingReversal,
  type PendingReversal,
} from "@/lib/store-card";

type Reversal = StoreCardSpend & { reversalRef: string; reversedAt: string };

function StoresSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: stores, isLoading, isError, refetch } = useListStores();
  const { data: locations } = useListLocations();
  const create = useCreateStore();
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const locName = (id: number) => locations?.find((l) => l.id === id)?.name ?? `Location #${id}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !locationId) return;
    create.mutate({ data: { name: name.trim(), locationId: Number(locationId) } }, {
      onSuccess: () => { setName(""); setLocationId(""); toast({ title: "Store created" }); qc.invalidateQueries({ queryKey: getListStoresQueryKey() }); },
      onError: (err) => toast({ title: "Could not create store", description: apiErrorInfo(err).message || undefined, variant: "destructive" }),
    });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Stores</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={submit} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5"><Label htmlFor="store-name">Store name</Label><Input id="store-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-store-name" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="store-location">Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="store-location" data-testid="select-store-location"><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>{locations?.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim() || !locationId} data-testid="button-create-store">
            {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}Add store
          </Button>
        </form>
        {isLoading ? <div className="h-16 rounded-lg bg-muted animate-pulse" />
          : isError ? <div className="flex items-center justify-between text-sm">Could not load stores.<Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
          : !stores?.length ? <p className="text-sm text-muted-foreground">No stores yet. Add one to start granting access.</p>
          : <ul className="divide-y rounded-lg border">{stores.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-3 text-sm" data-testid={`row-store-${s.id}`}>
                <div><div className="font-medium">{s.name}</div><div className="text-muted-foreground">{locName(s.locationId)}</div></div>
                <Badge variant={s.active ? "success" : "secondary"}>{s.active ? "Active" : "Inactive"}</Badge>
              </li>))}</ul>}
      </CardContent>
    </Card>
  );
}

function AccessSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: stores } = useListStores();
  const { data: access, isLoading, isError, refetch } = useListStoreAccess();
  const { data: employees } = useListEmployees();
  const grant = useGrantStoreAccess();
  const revoke = useRevokeStoreAccess();
  const [storeId, setStoreId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [revoking, setRevoking] = useState<{ storeId: number; employeeId: number } | null>(null);

  const store = stores?.find((s) => String(s.id) === storeId);
  // Only employees assigned to the store's location are eligible.
  const eligible = useMemo(() => (employees ?? []).filter((e) => store && e.locationId === store.locationId), [employees, store]);
  const empName = (id: number) => { const e = employees?.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : `Employee #${id}`; };
  const storeName = (id: number) => stores?.find((s) => s.id === id)?.name ?? `Store #${id}`;
  const invalidate = () => qc.invalidateQueries({ queryKey: getListStoreAccessQueryKey() });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !employeeId) return;
    grant.mutate({ data: { storeId: Number(storeId), employeeId: Number(employeeId) } }, {
      onSuccess: () => { setEmployeeId(""); toast({ title: "Access granted" }); invalidate(); },
      onError: (err) => toast({ title: "Could not grant access", description: apiErrorInfo(err).message || undefined, variant: "destructive" }),
    });
  };

  const doRevoke = () => {
    if (!revoking) return;
    revoke.mutate(revoking, {
      onSuccess: () => { toast({ title: "Access revoked" }); invalidate(); setRevoking(null); },
      onError: () => { toast({ title: "Could not revoke access", variant: "destructive" }); setRevoking(null); },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Store verification access</CardTitle>
        <p className="text-sm text-muted-foreground">Access is granted per employee and store. Portal role, including manager and admin, does not grant it.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={submit} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="grant-store">Store</Label>
            <Select value={storeId} onValueChange={(v) => { setStoreId(v); setEmployeeId(""); }}>
              <SelectTrigger id="grant-store" data-testid="select-grant-store"><SelectValue placeholder="Select store" /></SelectTrigger>
              <SelectContent>{stores?.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-employee">Employee at store location</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={!store}>
              <SelectTrigger id="grant-employee" data-testid="select-grant-employee"><SelectValue placeholder={store && !eligible.length ? "No employees at this location" : "Select employee"} /></SelectTrigger>
              <SelectContent>{eligible.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={grant.isPending || !storeId || !employeeId} data-testid="button-grant-access">
            {grant.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Grant
          </Button>
        </form>
        {isLoading ? <div className="h-16 rounded-lg bg-muted animate-pulse" />
          : isError ? <div className="flex items-center justify-between text-sm">Could not load access grants.<Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
          : !access?.length ? <p className="text-sm text-muted-foreground">No one has store access.</p>
          : <ul className="divide-y rounded-lg border">{access.map((a) => (
              <li key={`${a.storeId}-${a.employeeId}`} className="flex items-center justify-between gap-3 p-3 text-sm" data-testid={`row-access-${a.storeId}-${a.employeeId}`}>
                <div><div className="font-medium">{empName(a.employeeId)}</div><div className="text-muted-foreground">{storeName(a.storeId)}</div></div>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30" onClick={() => setRevoking(a)} aria-label={`Revoke ${empName(a.employeeId)} at ${storeName(a.storeId)}`} data-testid={`button-revoke-${a.storeId}-${a.employeeId}`}>
                  <Trash2 className="h-4 w-4 mr-1.5" />Revoke
                </Button>
              </li>))}</ul>}
      </CardContent>
      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke store access?</AlertDialogTitle>
            <AlertDialogDescription>{revoking && `${empName(revoking.employeeId)} will no longer be able to verify or spend cards at ${storeName(revoking.storeId)}.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRevoke} data-testid="button-confirm-revoke">Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ReversalSection({ selectedRef }: { selectedRef: { ref: string; n: number } | null }) {
  const qc = useQueryClient();
  const reverse = useReverseStoreGiftCardSpend();
  const [pending, setPending] = useState<PendingReversal | null>(() => loadPendingReversal());
  const [ref, setRef] = useState(pending?.transactionRef ?? "");
  const [reason, setReason] = useState(pending?.reason ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Reversal | null>(null);
  const locked = !!pending;
  const [abandonOpen, setAbandonOpen] = useState(false);
  useEffect(() => {
    if (selectedRef && !pending) { setRef(selectedRef.ref); setDone(null); setError(null); }
  }, [selectedRef, pending]);

  const submit = (p: PendingReversal) => {
    setError(null);
    reverse.mutate({ data: { transactionRef: p.transactionRef, reason: p.reason, idempotencyKey: p.idempotencyKey } }, {
      onSuccess: (r) => {
        clearPendingReversal(); setPending(null); setDone(r as Reversal); setRef(""); setReason("");
        qc.invalidateQueries({ queryKey: getListStoreGiftCardTransactionsQueryKey() });
      },
      onError: (err) => {
        if (isUncertain(err)) {
          const next = { ...p, uncertain: true }; savePendingReversal(next); setPending(next);
          setError("No confirmation from the server. Retry sends the identical reversal and cannot apply it twice.");
        } else {
          clearPendingReversal(); setPending(null);
          const { status, message } = apiErrorInfo(err);
          setError(status === 404 ? "Transaction not found." : status === 409 ? message || "Already reversed or conflicting request." : message || "Reversal failed.");
        }
      },
    });
  };

  const start = () => {
    const p: PendingReversal = { transactionRef: ref.trim(), reason: reason.trim(), idempotencyKey: crypto.randomUUID(), uncertain: false };
    savePendingReversal(p); setPending(p); setConfirmOpen(false); setDone(null); submit(p);
  };

  return (
    <Card id="reverse-spend">
      {pending && (
        <AbandonDraftDialog
          open={abandonOpen} onOpenChange={setAbandonOpen} expected={pending.transactionRef} refLabel="Transaction ref"
          checkText={`I refreshed the reconciliation list below and there is no reversal row with original ref ${pending.transactionRef}.`}
          onConfirm={() => { clearPendingReversal(); setPending(null); setError(null); }}
        />
      )}
      <CardHeader>
        <CardTitle className="text-lg">Reverse a store spend</CardTitle>
        <p className="text-sm text-muted-foreground">Restores the card balance only. Legend Bucks are never credited back.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {done && (
          <div role="status" className="rounded-lg border border-green-600/40 bg-green-50/60 p-4 text-sm grid grid-cols-2 gap-2" data-testid="card-reversal-result">
            <div><span className="text-muted-foreground">Reversal ref</span><div className="font-mono font-semibold">{done.reversalRef}</div></div>
            <div><span className="text-muted-foreground">Original ref</span><div className="font-mono">{done.transactionRef}</div></div>
            <div><span className="text-muted-foreground">Card</span><div className="font-mono">{done.maskedCode}</div></div>
            <div><span className="text-muted-foreground">Amount restored</span><div>{formatCad(done.amountCents)}</div></div>
          </div>
        )}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ref.trim() && reason.trim()) setConfirmOpen(true); }}>
          <div className="space-y-1.5"><Label htmlFor="rev-ref">Original transaction ref</Label><Input id="rev-ref" className="font-mono" value={ref} onChange={(e) => setRef(e.target.value)} disabled={locked} data-testid="input-reversal-ref" /></div>
          <div className="space-y-1.5"><Label htmlFor="rev-reason">Reason</Label><Textarea id="rev-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={locked} data-testid="input-reversal-reason" /></div>
          {error && <p role="alert" className="text-sm text-destructive flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />{error}</p>}
          {locked ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => submit(pending)} disabled={reverse.isPending} data-testid="button-retry-reversal">
                {reverse.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Retry same reversal
              </Button>
              {!reverse.isPending && pending.uncertain && (
                <Button type="button" variant="ghost" onClick={() => setAbandonOpen(true)} data-testid="button-abandon-reversal">Abandon</Button>
              )}
            </div>
          ) : (
            <Button type="submit" variant="destructive" disabled={!ref.trim() || !reason.trim()} data-testid="button-review-reversal"><Undo2 className="h-4 w-4 mr-2" />Review reversal</Button>
          )}
        </form>
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm reversal</AlertDialogTitle>
            <AlertDialogDescription>Reverse transaction <span className="font-mono">{ref.trim()}</span>. Reason: {reason.trim()}. This is audited.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={start} data-testid="button-confirm-reversal">Reverse spend</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const PAGE = 50;

function TransactionsSection({ onSelect }: { onSelect: (ref: string) => void }) {
  const [page, setPage] = useState(0);
  const params = { limit: PAGE, offset: page * PAGE };
  const { data: rows, isLoading, isError, refetch, isFetching } = useListStoreGiftCardTransactions(params, {
    query: { queryKey: getListStoreGiftCardTransactionsQueryKey(params) },
  });
  const reversed = useMemo(() => new Set((rows ?? []).filter((r) => r.kind === "reversal" && r.originalTransactionRef).map((r) => r.originalTransactionRef as string)), [rows]);
  const fmt = (d: string) => new Date(d).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-lg">Reconciliation</CardTitle>
          <p className="text-sm text-muted-foreground">Audited spends and reversals, newest first.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-transactions">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}</div>
        ) : isError ? (
          <div className="flex items-center justify-between text-sm">Could not load transactions.<Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
        ) : !rows?.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{page === 0 ? "No store transactions recorded yet." : "No more transactions."}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead><TableHead>Ref</TableHead><TableHead>Type</TableHead><TableHead>Card</TableHead>
                  <TableHead>Store</TableHead><TableHead>Employee</TableHead><TableHead>Receipt / reason</TableHead>
                  <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.transactionRef} data-testid={`row-transaction-${r.transactionRef}`}>
                    <TableCell className="whitespace-nowrap text-xs">{fmt(r.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.transactionRef}</TableCell>
                    <TableCell>
                      {r.kind === "reversal" ? (
                        <div><Badge variant="secondary">Reversal</Badge><div className="font-mono text-[11px] text-muted-foreground mt-1">of {r.originalTransactionRef}</div></div>
                      ) : reversed.has(r.transactionRef) ? <Badge variant="outline">Spend (reversed)</Badge> : <Badge>Spend</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.maskedCode}</TableCell>
                    <TableCell className="text-sm">{r.storeName}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{r.employeeName}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate" title={r.kind === "reversal" ? r.reason ?? "" : r.receiptRef ?? ""}>
                      {r.kind === "reversal" ? r.reason : r.receiptRef}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums whitespace-nowrap ${r.kind === "reversal" ? "text-green-700" : ""}`}>{r.kind === "reversal" ? "+" : "-"}{formatCad(r.amountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatCad(r.previousBalanceCents)}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap font-medium">{formatCad(r.newBalanceCents)}</TableCell>
                    <TableCell>
                      {r.kind === "spend" && !reversed.has(r.transactionRef) && (
                        <Button variant="ghost" size="sm" onClick={() => onSelect(r.transactionRef)} aria-label={`Reverse ${r.transactionRef}`} data-testid={`button-select-reverse-${r.transactionRef}`}>
                          <Undo2 className="h-4 w-4 mr-1" />Reverse
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page + 1}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page"><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button variant="outline" size="sm" disabled={(rows?.length ?? 0) < PAGE || isFetching} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StoreGiftCardsAdmin() {
  const [selectedRef, setSelectedRef] = useState<{ ref: string; n: number } | null>(null);
  const { data: user } = useGetMe();
  if (user && user.role !== "admin") {
    return <div className="max-w-xl mx-auto text-center py-20"><h1 className="text-2xl font-display font-bold">Admins only</h1><p className="text-muted-foreground mt-2">You do not have access to store gift card administration.</p></div>;
  }
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Store Gift Card Admin</h1>
        <p className="text-muted-foreground mt-1">Stores, verification access and corrections. Admin role does not include spend access.</p>
      </div>
      <StoreModeBanner />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <StoresSection />
        <AccessSection />
      </div>
      <ReversalSection selectedRef={selectedRef} />
      <TransactionsSection onSelect={(ref) => {
        setSelectedRef((prev) => ({ ref, n: (prev?.n ?? 0) + 1 }));
        document.getElementById("reverse-spend")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }} />
    </div>
  );
}
