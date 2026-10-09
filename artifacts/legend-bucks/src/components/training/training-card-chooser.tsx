import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trainingPortalApi } from "@/lib/training";

/** Lets a trainee pick a dummy card by safe alias instead of typing a code. Training only. */
export function TrainingCardChooser({ onChoose, disabled }: { onChoose: (alias: string) => void; disabled?: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["training", "cards"], queryFn: trainingPortalApi.cards });
  const cards = data?.cards ?? [];
  return (
    <div className="mt-4 rounded-xl border border-dashed border-amber-500/70 bg-amber-50/70 p-3" data-testid="panel-training-cards">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-900">
        <FlaskConical className="h-4 w-4" aria-hidden /> Training cards — dummy references, no codes
      </p>
      {isLoading ? (
        <div className="mt-2 flex gap-2"><div className="h-8 w-36 animate-pulse rounded-md bg-amber-200/70" /><div className="h-8 w-36 animate-pulse rounded-md bg-amber-200/70" /></div>
      ) : isError ? (
        <div className="mt-2 flex items-center justify-between text-sm text-amber-950">Could not load training cards.<Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>
      ) : cards.length === 0 ? (
        <p className="mt-2 text-sm text-amber-950">No training cards yet. Issue a gift card from Redemptions as the admin or accounting persona.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {cards.map((c) => (
            <Button key={c.id} type="button" size="sm" variant="outline" disabled={disabled || c.status !== "active"} onClick={() => onChoose(c.alias)}
              className="h-auto flex-col items-start border-amber-400 bg-card py-1.5 font-mono text-xs" data-testid={`button-training-card-${c.id}`}>
              <span className="font-semibold">{c.alias}</span>
              <span className="text-muted-foreground">{c.status} · ${(c.cadValueCents / 100).toFixed(2)} CAD</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
