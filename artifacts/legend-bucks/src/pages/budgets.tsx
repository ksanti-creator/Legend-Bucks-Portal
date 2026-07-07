import { useEffect, useState } from "react";
import { useListTeamBudgets, useSetTeamBudget, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Loader2 } from "lucide-react";

function BudgetAmountEditor({
  departmentId,
  amount,
}: {
  departmentId: number;
  amount: number;
}) {
  const [value, setValue] = useState<string>(String(amount));
  const setMut = useSetTeamBudget();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setValue(String(amount));
  }, [amount]);

  const dirty = value.trim() !== "" && Number(value) !== amount && Number(value) >= 0;

  const save = () => {
    const amountNum = Number(value);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setMut.mutate(
      { departmentId, data: { amount: amountNum } },
      {
        onSuccess: () => {
          toast({ title: "Budget updated" });
          queryClient.invalidateQueries({ queryKey: ["/api/team-budgets"] });
        },
        onError: (err: any) => {
          toast({ title: "Failed to update budget", description: err?.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-2 justify-end">
      <Input
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32 text-right"
      />
      <Button size="sm" onClick={save} disabled={!dirty || setMut.isPending}>
        {setMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}

export default function Budgets() {
  const { data: user, isLoading: userLoading } = useGetMe();
  const [, setLocation] = useLocation();
  const { data: budgets, isLoading } = useListTeamBudgets();

  // Admin-only surface. Non-admins are bounced to the dashboard.
  useEffect(() => {
    if (!userLoading && user && user.role !== "admin") {
      setLocation("/dashboard");
    }
  }, [userLoading, user, setLocation]);

  const year = budgets?.[0]?.year ?? new Date().getUTCFullYear();

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Team Budgets</h1>
        <p className="text-muted-foreground mt-1">
          Set each department's Legend Bucks pool for {year}. Managers award from this pool toward
          their team's goals — it never credits anyone's personal balance.
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Wallet className="h-5 w-5 text-primary" />
            Department pools ({year})
          </CardTitle>
          <CardDescription>Used is drawn from awards managers have made toward team goals this year.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : budgets?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No departments yet. Create departments first to set their budgets.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="w-[220px]">Usage</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right w-[200px]">Budget (LB)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets?.map((b) => {
                  const pct = b.amount > 0 ? Math.min(100, Math.round((b.used / b.amount) * 100)) : 0;
                  return (
                    <TableRow key={b.departmentId}>
                      <TableCell className="font-medium">{b.departmentName}</TableCell>
                      <TableCell>
                        <Progress value={pct} className="h-2" />
                      </TableCell>
                      <TableCell className="text-right">{b.used.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium text-primary">
                        {b.remaining.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <BudgetAmountEditor departmentId={b.departmentId} amount={b.amount} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
