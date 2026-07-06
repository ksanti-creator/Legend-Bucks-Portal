import { useState } from "react";
import { 
  useListBudgets, 
  useAssignBudget, 
  useGetMyBudgetRemaining, 
  useGetMe,
  useListEmployees,
  getGetMyBudgetRemainingQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { PieChart, Plus, Coins, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const assignBudgetSchema = z.object({
  managerId: z.coerce.number().min(1, "Please select a manager"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Format must be YYYY-MM"),
  totalAmount: z.coerce.number().min(1, "Amount must be greater than 0"),
});

export default function Budgets() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [open, setOpen] = useState(false);

  const { data: remaining, isLoading: isLoadingRemaining } = useGetMyBudgetRemaining({
    query: { queryKey: getGetMyBudgetRemainingQueryKey(), enabled: !isAdmin }
  });

  const { data: budgets, isLoading: isLoadingBudgets } = useListBudgets({
    month: month,
    managerId: isAdmin ? undefined : user?.id
  });

  const { data: employees } = useListEmployees();
  const managers = employees?.filter(e => e.role === "manager" || e.role === "admin") || [];

  const assignMut = useAssignBudget();

  const form = useForm<z.infer<typeof assignBudgetSchema>>({
    resolver: zodResolver(assignBudgetSchema),
    defaultValues: {
      managerId: 0,
      month: new Date().toISOString().slice(0, 7),
      totalAmount: 5000,
    },
  });

  const onSubmit = (data: z.infer<typeof assignBudgetSchema>) => {
    assignMut.mutate(
      { data },
      {
        onSuccess: () => {
          setOpen(false);
          toast({ title: "Budget assigned successfully" });
          queryClient.invalidateQueries({ queryKey: ["/api/budgets"] });
          form.reset();
        },
        onError: () => {
          toast({ title: "Failed to assign budget", variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Budgets</h1>
          <p className="text-muted-foreground mt-1">Manage monthly allowances for recognition.</p>
        </div>
        
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                Assign Budget
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Manager Budget</DialogTitle>
                <DialogDescription>
                  Allocate Legend Bucks to a manager for a specific month.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="managerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Manager</FormLabel>
                        <Select 
                          onValueChange={(v) => field.onChange(parseInt(v))} 
                          defaultValue={field.value ? field.value.toString() : ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a manager" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {managers.map(mgr => (
                              <SelectItem key={mgr.id} value={mgr.id.toString()}>
                                {mgr.firstName} {mgr.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="month"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Month (YYYY-MM)</FormLabel>
                          <FormControl>
                            <Input type="month" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="totalAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (LB)</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <DialogFooter className="pt-4">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={assignMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                      {assignMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Assign
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!isAdmin && remaining && (
        <Card className="bg-primary text-primary-foreground border-none shadow-sm overflow-hidden relative">
          <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/4"></div>
          <CardContent className="p-6 relative z-10">
            <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-primary-foreground/20 p-4 rounded-xl">
                  <PieChart className="h-8 w-8 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-primary-foreground/80 font-medium text-sm uppercase tracking-wider mb-1">
                    Remaining Budget ({remaining.month})
                  </p>
                  <div className="text-4xl font-display font-bold">
                    {remaining.remainingAmount.toLocaleString()} <span className="text-xl text-primary-foreground/70">LB</span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-8 border-l border-primary-foreground/20 pl-8">
                <div>
                  <p className="text-primary-foreground/70 text-sm">Total Allocated</p>
                  <p className="text-xl font-bold">{remaining.totalAmount.toLocaleString()} LB</p>
                </div>
                <div>
                  <p className="text-primary-foreground/70 text-sm">Used So Far</p>
                  <p className="text-xl font-bold">{remaining.usedAmount.toLocaleString()} LB</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">Monthly Budgets</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter by Month:</span>
              <Input 
                type="month" 
                value={month} 
                onChange={(e) => setMonth(e.target.value)}
                className="w-40 h-8" 
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Manager</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingBudgets ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading budgets...</TableCell>
                </TableRow>
              ) : budgets?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No budgets found for {month}.</TableCell>
                </TableRow>
              ) : (
                budgets?.map((budget) => {
                  const remaining = budget.totalAmount - budget.usedAmount;
                  const percentUsed = (budget.usedAmount / budget.totalAmount) * 100;
                  
                  return (
                    <TableRow key={budget.id}>
                      <TableCell className="font-medium">{budget.managerName || `Manager #${budget.managerId}`}</TableCell>
                      <TableCell>{budget.month}</TableCell>
                      <TableCell className="text-right">{budget.totalAmount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{budget.usedAmount.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-bold">{remaining.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className={`text-sm ${percentUsed > 90 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {percentUsed.toFixed(1)}%
                          </span>
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${percentUsed > 90 ? 'bg-destructive' : 'bg-primary'}`} 
                              style={{ width: `${Math.min(100, percentUsed)}%` }} 
                            />
                          </div>
                        </div>
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
