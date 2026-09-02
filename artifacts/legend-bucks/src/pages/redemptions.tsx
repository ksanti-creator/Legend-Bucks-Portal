import { useState } from "react";
import { useListRedemptions, useApproveRedemption, useRejectRedemption, useFulfillRedemption, usePayrollApproveRedemption, usePayrollRejectRedemption, useIssueGiftCard, useReissueGiftCard, useVoidGiftCard, useGetMe, getListRedemptionsQueryKey, exportRedemptions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import { Ship, Check, X, Box, Loader2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Redemptions() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager";
  // accounting_admin can view all redemptions (for cost reconciliation) but
  // cannot process them. Managers see their reports' requests (the API scopes
  // the list to their reporting subtree plus their own).
  const canViewQueue = isAdmin || isManager || user?.role === "accounting_admin";
  // Admins can decide anything; a manager can decide their reports' requests
  // but never their own. Fulfillment is admin-only.
  const canDecide = (item: { employeeId?: number }) =>
    isAdmin || (isManager && item.employeeId !== user?.id);
  // Payroll sign-off on Time Off redemptions: accounting admins and admins only.
  const canPayroll = isAdmin || user?.role === "accounting_admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusTab, setStatusTab] = useState("requested");
  const [exporting, setExporting] = useState(false);

  // Privileged roles see all, users see their own
  const { data: redemptions, isLoading } = useListRedemptions({ 
    status: canViewQueue && statusTab !== "all" ? statusTab : undefined,
    employeeId: !canViewQueue ? user?.id : undefined
  });

  const approveMut = useApproveRedemption();
  const rejectMut = useRejectRedemption();
  const fulfillMut = useFulfillRedemption();
  const payrollApproveMut = usePayrollApproveRedemption();
  const payrollRejectMut = usePayrollRejectRedemption();
  const issueGiftCardMut = useIssueGiftCard();
  const reissueGiftCardMut = useReissueGiftCard();
  const voidGiftCardMut = useVoidGiftCard();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListRedemptionsQueryKey() });
  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportRedemptions();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "redemptions.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", description: "Could not download redemptions. Try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };
  const handleGiftCard = (item: NonNullable<typeof redemptions>[number], action: "issue" | "reissue" | "void") => {
    const callbacks = {
      onSuccess: (issue: any) => {
        toast({
          title: issue.status === "email_failed" ? "Gift card created, but email failed" : action === "void" ? "Gift card voided" : "Gift card emailed",
          description: issue.status === "email_failed" ? "Delivery failed. Use Reissue Card to generate and email a replacement." : issue.maskedCode,
          variant: issue.status === "email_failed" ? "destructive" as const : "default" as const,
        });
        refresh();
      },
      onError: (err: any) => toast({ title: `Failed to ${action} gift card`, description: err?.response?.data?.error, variant: "destructive" as const }),
    };
    if (action === "issue") issueGiftCardMut.mutate({ id: item.id }, callbacks);
    else if (action === "reissue") {
      if (confirm("Reissue this card? The old code will be permanently voided.")) reissueGiftCardMut.mutate({ id: item.id }, callbacks);
    } else {
      const reason = prompt("Reason for voiding this card:");
      if (reason?.trim()) voidGiftCardMut.mutate({ id: item.id, data: { reason: reason.trim() } }, callbacks);
    }
  };

  const handleAction = (id: number, action: 'approve' | 'reject' | 'fulfill' | 'payroll-approve' | 'payroll-reject') => {
    const callbacks = {
      onSuccess: () => {
        toast({ title: `Redemption ${action}ed` });
        queryClient.invalidateQueries({ queryKey: getListRedemptionsQueryKey() });
      },
      onError: () => {
        toast({ title: `Failed to ${action}`, variant: "destructive" });
      },
    };
    if (action === 'approve') approveMut.mutate({ id }, callbacks);
    else if (action === 'reject') rejectMut.mutate({ id, data: {} }, callbacks);
    else if (action === 'payroll-approve') payrollApproveMut.mutate({ id }, callbacks);
    else if (action === 'payroll-reject') payrollRejectMut.mutate({ id, data: {} }, callbacks);
    else fulfillMut.mutate({ id }, callbacks);
  };

  if (!canViewQueue && user) {
    // If regular user, just show simple list
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-display font-bold">My Redemptions</h1>
        <Card>
          <CardContent className="p-0">
             {isLoading ? <div className="p-6 text-muted-foreground">Loading...</div> :
               redemptions?.length ? <div className="divide-y">
                 {redemptions.map((item) => (
                   <div key={item.id} className="p-5 flex items-center justify-between gap-4">
                     <div><div className="font-semibold">{item.rewardName}</div><div className="text-sm text-muted-foreground">{formatDate(item.createdAt)} · {item.status}</div></div>
                     <div className="font-bold text-primary">{(item.giftCardLbAmount ?? item.buckCost).toLocaleString()} LB</div>
                   </div>
                 ))}
               </div> : <div className="p-6 text-muted-foreground">You have no redemptions yet.</div>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Fulfillment Center</h1>
          <p className="text-muted-foreground mt-1">Manage reward requests and fulfillments.</p>
        </div>
        {isAdmin && (
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export CSV
          </Button>
        )}
      </div>

      <Tabs value={statusTab} onValueChange={setStatusTab}>
        <TabsList className="grid grid-cols-6 w-full max-w-4xl mb-6">
          <TabsTrigger value="requested">Pending Approval</TabsTrigger>
          <TabsTrigger value="pending_payroll">Payroll</TabsTrigger>
          <TabsTrigger value="approved">To Fulfill</TabsTrigger>
          <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : redemptions?.length === 0 ? (
          <div className="text-center py-20 bg-muted/20 rounded-xl border border-dashed">
            <Ship className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-1">No requests found</h3>
            <p className="text-muted-foreground">No redemptions matching this status.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {redemptions?.map((item) => (
              <Card key={item.id} className="border-none shadow-sm overflow-hidden">
                <div className="flex flex-col md:flex-row border-l-4 border-l-primary">
                  <div className="p-6 flex-1 flex flex-col md:flex-row gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant={
                          item.status === 'requested' ? 'warning' :
                          item.status === 'pending_payroll' ? 'warning' :
                          item.status === 'approved' ? 'default' :
                          item.status === 'fulfilled' ? 'success' : 'secondary'
                        } className="uppercase tracking-wider text-[10px]">
                          {item.status === 'pending_payroll' ? 'Awaiting Payroll' : item.status}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</span>
                      </div>
                      
                      <h3 className="font-display font-semibold text-lg">
                        {item.rewardName}
                        {item.sizeLabel && (
                          <Badge variant="outline" className="ml-2 align-middle text-xs">
                            Size: {item.sizeLabel}
                          </Badge>
                        )}
                      </h3>
                      <p className="text-sm text-foreground mt-1">
                        Requested by <span className="font-medium">{item.employeeName}</span>
                      </p>
                      
                      {item.note && (
                        <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm italic text-muted-foreground">
                          "{item.note}"
                        </div>
                      )}
                      {item.giftCardLbAmount != null && (
                        <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                          <div className="font-semibold">Gift Card to issue: ${((item.giftCardCadValueCents ?? 0) / 100).toFixed(2)} / {item.giftCardLbAmount.toLocaleString()} LB</div>
                          <div className="text-muted-foreground">{item.giftCardRecipientName} · {item.giftCardRecipientEmail}</div>
                          {item.giftCardMessage && <div className="mt-1 italic">“{item.giftCardMessage}”</div>}
                          {item.giftCardIssue && <div className="mt-2">Card {item.giftCardIssue.maskedCode} · <Badge variant={item.giftCardIssue.status === "emailed" ? "success" : item.giftCardIssue.status === "email_failed" ? "destructive" : "secondary"}>{item.giftCardIssue.status.replace("_", " ")}</Badge></div>}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col justify-center items-start md:items-end min-w-[120px] pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-border md:pl-6">
                      <div className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Cost</div>
                      <div className="text-2xl font-bold font-display text-primary">{item.buckCost} LB</div>
                      {item.cadValueCents != null && (
                        <div className="mt-2 text-xs text-muted-foreground uppercase tracking-wider" title="Real dollar value — accounting only">
                          CAD Value
                          <span className="block text-base font-semibold text-foreground normal-case tracking-normal">
                            ${(item.cadValueCents / 100).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Action Area based on status */}
                  <div className="bg-muted/30 p-6 flex items-center justify-end md:justify-center md:w-[200px] border-t md:border-t-0 md:border-l border-border">
                    {!canDecide(item) && !isAdmin && !(canPayroll && item.status === 'pending_payroll') && (
                      <span className="text-sm text-muted-foreground font-medium capitalize flex items-center">
                        {item.status === 'fulfilled' && <Check className="h-4 w-4 mr-2 text-green-600" />}
                        {item.status === 'rejected' && <X className="h-4 w-4 mr-2 text-destructive" />}
                        {item.status === 'pending_payroll' ? 'Awaiting Payroll' : item.status}
                      </span>
                    )}
                    {canDecide(item) && item.status === 'requested' && (
                      <div className="flex gap-2 w-full">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => handleAction(item.id, 'reject')}
                          disabled={rejectMut.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={approveMut.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    
                    {canPayroll && item.status === 'pending_payroll' && (
                      <div className="flex gap-2 w-full">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => handleAction(item.id, 'payroll-reject')}
                          disabled={payrollRejectMut.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          onClick={() => handleAction(item.id, 'payroll-approve')}
                          disabled={payrollApproveMut.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {!canPayroll && item.status === 'pending_payroll' && (canDecide(item) || isManager) && (
                      <span className="text-sm text-muted-foreground font-medium flex items-center text-center">
                        Awaiting payroll sign-off
                      </span>
                    )}

                     {isAdmin && item.status === 'approved' && item.giftCardLbAmount == null && (
                      <Button 
                        className="w-full bg-primary hover:bg-primary/90"
                        onClick={() => handleAction(item.id, 'fulfill')}
                        disabled={fulfillMut.isPending}
                      >
                        <Box className="h-4 w-4 mr-2" />
                        Mark Fulfilled
                      </Button>
                    )}
                     {isAdmin && item.status === "approved" && item.giftCardLbAmount != null && !item.giftCardIssue && (
                       <Button className="w-full" onClick={() => handleGiftCard(item, "issue")} disabled={issueGiftCardMut.isPending}>
                         <Box className="h-4 w-4 mr-2" />Issue &amp; Email
                       </Button>
                     )}
                     {isAdmin && item.giftCardIssue && !["voided", "reissued"].includes(item.giftCardIssue.status) && (
                       <div className="w-full space-y-2">
                         <Button className="w-full" variant="outline" onClick={() => handleGiftCard(item, "reissue")} disabled={reissueGiftCardMut.isPending}>Reissue Card</Button>
                         <Button className="w-full" variant="destructive" onClick={() => handleGiftCard(item, "void")} disabled={voidGiftCardMut.isPending}>Void Card</Button>
                       </div>
                     )}

                    {canDecide(item) && item.status !== 'requested' && item.status !== 'approved' && item.status !== 'pending_payroll' && (
                      <span className="text-sm text-muted-foreground font-medium flex items-center">
                        {item.status === 'fulfilled' && <Check className="h-4 w-4 mr-2 text-green-600" />}
                        {item.status === 'rejected' && <X className="h-4 w-4 mr-2 text-destructive" />}
                        {item.status === 'cancelled' && <X className="h-4 w-4 mr-2" />}
                        Resolved
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Tabs>
    </div>
  );
}
