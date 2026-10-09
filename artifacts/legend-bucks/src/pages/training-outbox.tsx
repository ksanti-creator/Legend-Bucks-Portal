import { useQuery } from "@tanstack/react-query";
import { Inbox, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trainingPortalApi } from "@/lib/training";

/** Captured emails from the training sandbox. Nothing is ever sent. */
export default function TrainingOutbox() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({ queryKey: ["training", "outbox"], queryFn: trainingPortalApi.outbox });
  const messages = data?.messages ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Badge className="mb-2 bg-amber-400 text-amber-950 hover:bg-amber-400">Training only</Badge>
          <h1 className="font-display text-3xl font-bold tracking-tight">Training Outbox</h1>
          <p className="mt-1 text-muted-foreground">Emails the portal would have sent. They are captured here and never delivered.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-outbox">
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : isError ? (
        <Card><CardContent className="flex items-center justify-between p-5 text-sm">Could not load the training outbox.<Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>
      ) : messages.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center p-10 text-center">
          <Inbox className="h-10 w-10 text-primary" aria-hidden />
          <p className="mt-3 font-semibold">Outbox is empty</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Approve a redemption or issue a gift card, and the notice it would send appears here.</p>
        </CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id}><Card data-testid={`card-outbox-${m.id}`}><CardContent className="flex gap-4 p-5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Mail className="h-5 w-5" aria-hidden /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{m.subject}</p>
                  <time className="text-xs text-muted-foreground" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
                </div>
                <p className="text-sm text-muted-foreground">To {m.recipient}</p>
                <p className="mt-2 text-sm">{m.summary}</p>
                {m.giftCardIssueId != null && <p className="mt-2 font-mono text-xs text-amber-800">Card reference: TRAINING-CARD-{m.giftCardIssueId}</p>}
              </div>
            </CardContent></Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}
