import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2, PlayCircle, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getNormalSessionToken } from "@/lib/auth-token";
import { TrainingApiError, trainingLaunchApi } from "@/lib/training";

const CONFIRM = "RESET TRAINING DATA";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PERSONA_HELP: Record<string, string> = {
  admin: "Full admin: rewards, people, store card admin, approvals.",
  manager: "Sends bucks and approves their team's redemptions.",
  employee: "Earns, browses rewards and requests redemptions.",
  accounting: "Read-only finance: ledger, redemptions, exports, payroll.",
  operator: "Store till: looks up and spends training gift cards.",
};

function errText(e: unknown) {
  if (e instanceof TrainingApiError) {
    if (e.status === 503) return "Training is not available right now.";
    if (e.status === 401 || e.status === 403) return "Only an active admin signed in to the live portal can manage training.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export default function TrainingLaunch() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hasToken = !!getNormalSessionToken();
  const [confirm, setConfirm] = useState("");
  const [starting, setStarting] = useState<string | null>(null);

  const status = useQuery({ queryKey: ["training-launch", "status"], queryFn: trainingLaunchApi.status });
  const ready = !!status.data?.enabled && !!status.data?.available;
  const personas = useQuery({ queryKey: ["training-launch", "personas"], queryFn: trainingLaunchApi.personas, enabled: ready && hasToken });
  const reset = useMutation({
    mutationFn: trainingLaunchApi.reset,
    onSuccess: () => { setConfirm(""); toast({ title: "Training data reset", description: "Fresh dummy records are loaded." }); qc.invalidateQueries({ queryKey: ["training-launch"] }); },
    onError: (e) => toast({ title: "Reset failed", description: errText(e), variant: "destructive" }),
  });
  const start = async (key: string) => {
    setStarting(key);
    try { await trainingLaunchApi.startSession(key); }
    catch (e) { setStarting(null); toast({ title: "Could not start session", description: errText(e), variant: "destructive" }); }
  };
  const seeded = personas.data?.seeded ?? status.data?.seeded ?? false;
  const controlsDisabled = !ready || !hasToken;

  return (
    <div className="min-h-[100dvh] app-gradient-bg pt-12 text-foreground">
      <div className="fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-center gap-2 border-b-2 border-amber-950/30 px-4 text-sm font-black uppercase tracking-[0.14em] text-amber-950"
        style={{ background: "repeating-linear-gradient(135deg, hsl(43 96% 56%) 0 18px, hsl(40 96% 50%) 18px 36px)" }} data-testid="banner-training-launch">
        <AlertTriangle className="h-5 w-5" aria-hidden /> Training — Dummy data
      </div>
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <img src="/logos/legend-bucks-rewards.png" alt="Legend Bucks Rewards" className="h-10 w-auto" />
          <Button variant="outline" size="sm" onClick={() => window.location.assign(`${BASE}/dashboard`)} data-testid="button-back-live">
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />Back to portal
          </Button>
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Training sandbox</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Practise the real Legend Bucks workflows as any role. Every person, balance, email and gift card here is dummy data, kept apart from the live portal. Emails land in a training outbox and are never sent.
          </p>
        </div>

        <Card data-testid="card-training-status">
          <CardHeader className="pb-2"><CardTitle className="text-lg">Status</CardTitle></CardHeader>
          <CardContent>
            {status.isLoading ? <div className="h-6 w-64 animate-pulse rounded bg-muted" />
              : status.isError ? <div className="flex items-center justify-between text-sm">Could not check training status.<Button size="sm" variant="outline" onClick={() => status.refetch()}>Retry</Button></div>
              : (
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  {([["Enabled", status.data!.enabled], ["Available", status.data!.available], ["Dummy data loaded", seeded]] as const).map(([k, v]) => (
                    <div key={k} className="rounded-xl border bg-card/60 p-3"><dt className="text-muted-foreground">{k}</dt><dd className={`font-semibold ${v ? "text-emerald-700" : "text-destructive"}`} data-testid={`status-${k.toLowerCase().replace(/ /g, "-")}`}>{v ? "Yes" : "No"}</dd></div>
                  ))}
                  {!ready && status.data!.reason && <p className="sm:col-span-3 text-muted-foreground" data-testid="text-training-reason">{status.data!.reason}</p>}
                </dl>
              )}
            {ready && !hasToken && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950" role="alert">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Sign in to the live portal as an admin first, then return here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-lg">Choose a persona</CardTitle></CardHeader>
          <CardContent>
            {controlsDisabled ? <p className="text-sm text-muted-foreground">Persona sessions open once training is available and you are signed in as an admin.</p>
              : personas.isLoading ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>
              : personas.isError ? <div className="flex items-center justify-between text-sm text-destructive">{errText(personas.error)}<Button size="sm" variant="outline" onClick={() => personas.refetch()}>Retry</Button></div>
              : !seeded ? <p className="text-sm text-muted-foreground">Dummy data is not loaded yet. Reset training data below to load it.</p>
              : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {personas.data!.personas.map((p) => (
                    <button key={p.key} type="button" disabled={!!starting} onClick={() => start(p.key)}
                      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      data-testid={`button-persona-${p.key}`}>
                      {starting === p.key ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" aria-hidden /> : <PlayCircle className="mt-0.5 h-5 w-5 text-primary" aria-hidden />}
                      <span><span className="block font-semibold">{p.label}</span><span className="block text-sm text-muted-foreground">{PERSONA_HELP[p.key] ?? p.role}</span></span>
                    </button>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader className="pb-2"><CardTitle className="text-lg">Reset training data</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Wipes and reloads only the training dummy records. Live data is never touched. Open persona sessions will end.</p>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (confirm === CONFIRM) reset.mutate(); }}>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="reset-confirm">Type {CONFIRM} to confirm</Label>
                <Input id="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={controlsDisabled} data-testid="input-reset-confirm" />
              </div>
              <Button type="submit" variant="destructive" disabled={controlsDisabled || confirm !== CONFIRM || reset.isPending} data-testid="button-reset-training">
                {reset.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Reset
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
