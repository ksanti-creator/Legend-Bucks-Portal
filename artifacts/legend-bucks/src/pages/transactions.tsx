import { useState } from "react";
import { useListTransactions, useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";
import { ArrowRightLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Transactions() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewFilter, setViewFilter] = useState<string>("my"); // 'all' or 'my'

  // Admin can see all, regular users only their own
  const effectiveEmployeeId = (isAdmin && viewFilter === "all") ? undefined : user?.id;

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
        
        <div className="flex items-center gap-3">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Transactions
            </CardTitle>
            
            <div className="flex flex-1 justify-end gap-4 w-full sm:w-auto">
              {isAdmin && (
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
                {isAdmin && <TableHead className="text-right">CAD Value</TableHead>}
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-8 text-muted-foreground">Loading transactions...</TableCell>
                </TableRow>
              ) : !txPage?.items || txPage.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5} className="text-center py-8 text-muted-foreground">No transactions found.</TableCell>
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
                      </TableCell>
                      {isAdmin && (
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
