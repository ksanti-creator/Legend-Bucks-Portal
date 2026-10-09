import { AlertTriangle, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exitTraining, getTrainingPersona, goToTrainingLaunch } from "@/lib/training";

/** Persistent, always-visible label for every training screen. */
export function TrainingBanner() {
  const persona = getTrainingPersona();
  return (
    <div
      role="region"
      aria-label="Training mode, dummy data"
      className="fixed inset-x-0 top-0 z-[60] h-12 border-b-2 border-amber-950/30 text-amber-950"
      style={{ background: "repeating-linear-gradient(135deg, hsl(43 96% 56%) 0 18px, hsl(40 96% 50%) 18px 36px)" }}
      data-testid="banner-training"
    >
      <div className="flex h-full items-center justify-between gap-2 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span className="shrink-0 rounded bg-amber-950 px-2 py-0.5 text-xs font-black uppercase tracking-[0.14em] text-amber-300 sm:text-sm">
            Training — Dummy data
          </span>
          {persona && (
            <span className="hidden truncate text-sm font-semibold md:inline" data-testid="text-training-persona">
              Acting as {persona.label}. Nothing here is real or reaches anyone.
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 border-amber-950/40 bg-amber-50/90 px-2 text-amber-950 hover:bg-amber-50 sm:px-3" onClick={goToTrainingLaunch} data-testid="button-training-change-persona">
            <Users className="h-4 w-4 sm:mr-1.5" aria-hidden /><span className="sr-only sm:not-sr-only">Change persona</span>
          </Button>
          <Button size="sm" className="h-8 bg-amber-950 px-2 text-amber-50 hover:bg-amber-900 sm:px-3" onClick={exitTraining} data-testid="button-training-exit">
            <LogOut className="h-4 w-4 sm:mr-1.5" aria-hidden /><span className="sr-only sm:not-sr-only">Exit training</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Shown when the training session is missing, expired, or training was switched off. Never falls back to live login. */
export function TrainingSessionLost() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-12">
      <div className="max-w-md rounded-2xl border border-amber-400 bg-card p-6 text-center shadow-sm" data-testid="panel-training-session-lost">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" aria-hidden />
        <h1 className="mt-3 font-display text-xl font-bold">Training session unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The training session ended, or training is currently turned off. You were not signed in to the live portal.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={goToTrainingLaunch} data-testid="button-training-relaunch">Back to training launch</Button>
          <Button variant="outline" onClick={exitTraining} data-testid="button-training-exit-lost">Exit training</Button>
        </div>
      </div>
    </div>
  );
}

/** Training replacement for /login: returns to the launch page with a full reload. */
export function TrainingLoginRedirect() {
  if (typeof window !== "undefined") setTimeout(goToTrainingLaunch, 0);
  return <TrainingSessionLost />;
}
