import { useState } from "react";
import { useListTransactions, useGetMe, exportTransactions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";
import { ArrowRightLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function Transactions() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  // Full admins and the read-only accounting_admin role can see the whole
  // organization's ledger and export it; everyone else sees only their own.
  const canViewAll = user?.role === "admin" || user?.role === "accounting_admin";
  const [exporting, setExporting] = useState(false);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewFilter, setViewFilter] = useState<string>("my"); // 'all' or 'my'

  // Privileged roles can see all, regular users only their own
  const effectiveEmployeeId = (canViewAll && viewFilter === "all") ? undefined : user?.id;

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportTransactions();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "transactions.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", description: "Could not download the ledger. Try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const { data: txPage, isLoading } = useListTransactions({
    employeeId: effectiveEmployeeId,
    type: typeFilter !== "all" ? typeFilter : undefined,
    limit: 50
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Ledger</h1>
          <p className="text-muted-foreground mt-1">Record of all Legend Bucks transactions.</p>
        </div>
        
        {canViewAll && (
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Export CSV
            </Button>
          </div>
        )}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Transactions
            </CardTitle>
            
            <div className="flex flex-1 justify-end gap-4 w-full sm:w-auto">
              {canViewAll && (
                <Select value={viewFilter} onValueChange={setViewFilter}>
                  <SelectTrigger className="w-[150px] bg-background">
                    <SelectValue placeholder="View" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="my">My Transactions</SelectItem>
                    <SelectItem value="all">All Organization</SelectItem>
                  </SelectContent>
                </Select>
              )}
              
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px] bg-background">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="award">Awards</SelectItem>
                  <SelectItem value="redemption_debit">Redemptions</SelectItem>
                  <SelectItem value="adjustment">Adjustments</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From / To</TableHead>
                <TableHead>Note</TableHead>
                {canViewAll && <TableHead className="text-right">CAD Value</TableHead>}
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canViewAll ? 6 : 5} className="text-center py-8 text-muted-foreground">Loading transactions...</TableCell>
                </TableRow>
              ) : !txPage?.items || txPage.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canViewAll ? 6 : 5} className="text-center py-8 text-muted-foreground">No transactions found.</TableCell>
                </TableRow>
              ) : (
                txPage.items.map((tx) => {
                  // Determine visual treatment based on perspective
                  // If viewing 'all', it's neutral. If viewing 'my', incoming is green, outgoing is default.
                  const isViewerRecipient = tx.toEmployeeId === user?.id;
                  const isViewerSender = tx.fromEmployeeId === user?.id;
                  
                  let amtClass = "text-foreground";
                  let amtPrefix = "";
                  
                  if (viewFilter === "my") {
                    if (isViewerRecipient && tx.amount > 0) { amtClass = "text-green-600 font-medium"; amtPrefix = "+"; }
                    if (isViewerSender || (tx.type === "redemption_debit" && isViewerRecipient)) { amtClass = "text-foreground font-medium"; amtPrefix = "-"; }
                  }

                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                        {formatDateTime(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize bg-background text-xs font-normal">
                          {tx.type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {tx.fromEmployeeName && <span className="text-muted-foreground mr-1">From</span>}
                          {tx.fromEmployeeName}
                          {tx.toEmployeeName && tx.fromEmployeeName && <span className="mx-2 text-muted-foreground">→</span>}
                          {tx.toEmployeeName && !tx.fromEmployeeName && <span className="text-muted-foreground mr-1">To</span>}
                          {tx.toEmployeeName}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm">
                        {tx.note}
                        {tx.type === "adjustment" && tx.createdByName && (
                          <span className="text-muted-foreground"> · Recorded by {tx.createdByName}</span>
                        )}
                      </TableCell>
                      {canViewAll && (
                        <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                          {tx.cadValueCents != null ? `${(tx.cadValueCents / 100).toFixed(2)}` : '—'}
                        </TableCell>
                      )}
                      <TableCell className={`text-right ${amtClass}`}>
                        {amtPrefix}{Math.abs(tx.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
