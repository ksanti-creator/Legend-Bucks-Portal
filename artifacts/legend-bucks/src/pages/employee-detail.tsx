import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { 
  useGetEmployee, 
  useGetEmployeeBalance, 
  useListTransactions, 
  useDeactivateEmployee,
  useUpdateEmployee,
  useListEmployees,
  useListDepartments,
  useListLocations,
  useGetMe,
  useGetEmployeeAwardBudget,
  useAdjustBalance,
  getGetEmployeeQueryKey,
  getGetEmployeeBalanceQueryKey,
  getGetEmployeeAwardBudgetQueryKey,
  getListTransactionsQueryKey
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, getInitials } from "@/lib/utils";
import { 
  ArrowLeft, 
  Mail, 
  MapPin, 
  Briefcase, 
  CalendarDays, 
  Award, 
  Coins, 
  AlertTriangle,
  Send
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function EmployeeDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeactivating, setIsDeactivating] = useState(false);

  const { data: currentUser } = useGetMe();
  const { data: employee, isLoading: isLoadingEmp } = useGetEmployee(id, { query: { queryKey: getGetEmployeeQueryKey(id), enabled: !!id } });
  const { data: balance, isLoading: isLoadingBal } = useGetEmployeeBalance(id, { query: { queryKey: getGetEmployeeBalanceQueryKey(id), enabled: !!id } });
  const { data: transactions, isLoading: isLoadingTx } = useListTransactions({ employeeId: id }, { query: { queryKey: getListTransactionsQueryKey({ employeeId: id }), enabled: !!id } });
  
  const deactivateMut = useDeactivateEmployee();
  const updateMut = useUpdateEmployee();

  const { data: departments } = useListDepartments();
  const { data: locations } = useListLocations();
  const { data: allEmployees } = useListEmployees();
  const managers = allEmployees?.filter((e) => (e.role === "manager" || e.role === "admin") && e.id !== id) || [];

  const adjustMut = useAdjustBalance();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustDirection, setAdjustDirection] = useState<"credit" | "debit">("credit");
  const [adjustNote, setAdjustNote] = useState("");

  const handleAdjust = () => {
    const amount = parseInt(adjustAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a positive amount", variant: "destructive" });
      return;
    }
    if (!adjustNote.trim()) {
      toast({ title: "A note is required", description: "Explain why the balance is being adjusted.", variant: "destructive" });
      return;
    }
    adjustMut.mutate(
      { data: { employeeId: id, direction: adjustDirection, amount, note: adjustNote.trim() } },
      {
        onSuccess: () => {
          toast({ title: "Balance adjusted", description: `${adjustDirection === "credit" ? "Credited" : "Debited"} ${amount} Legend Bucks.` });
          queryClient.invalidateQueries({ queryKey: getGetEmployeeBalanceQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey({ employeeId: id }) });
          setAdjustOpen(false);
          setAdjustAmount("");
          setAdjustNote("");
          setAdjustDirection("credit");
        },
        onError: (err: any) =>
          toast({ title: "Failed to adjust balance", description: err?.message, variant: "destructive" }),
      },
    );
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editDept, setEditDept] = useState<string>("none");
  const [editLoc, setEditLoc] = useState<string>("none");
  const [editManager, setEditManager] = useState<string>("none");
  const [editBudget, setEditBudget] = useState<string>("");

  const isAdmin = currentUser?.role === "admin";
  const isAdminOrManager = currentUser?.role === "admin" || currentUser?.role === "manager";
  const canDeactivate = currentUser?.role === "admin" && employee?.status !== "inactive";
  // Only admins and managers can award, so only they have a sending budget.
  const employeeCanAward = employee?.role === "admin" || employee?.role === "manager";

  // The yearly award budget is private to the employee themselves and admins.
  // The server authorizes only self + admin; retry is disabled so an
  // unauthorized fetch quietly hides the card.
  const canViewBudget = isAdmin || currentUser?.id === id;
  const { data: budgetInfo } = useGetEmployeeAwardBudget(id, {
    query: { queryKey: getGetEmployeeAwardBudgetQueryKey(id), enabled: !!id && canViewBudget, retry: false },
  });

  const openEdit = () => {
    setEditDept(employee?.departmentId ? employee.departmentId.toString() : "none");
    setEditLoc(employee?.locationId ? employee.locationId.toString() : "none");
    setEditManager(employee?.managerId ? employee.managerId.toString() : "none");
    setEditBudget(budgetInfo?.budget != null ? budgetInfo.budget.toString() : "");
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    updateMut.mutate(
      {
        id,
        data: {
          departmentId: editDept === "none" ? null : parseInt(editDept),
          locationId: editLoc === "none" ? null : parseInt(editLoc),
          managerId: editManager === "none" ? null : parseInt(editManager),
          awardBudgetYearly: editBudget.trim() === "" ? null : parseInt(editBudget, 10),
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Employee updated" });
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetEmployeeAwardBudgetQueryKey(id) });
          setEditOpen(false);
        },
        onError: () => toast({ title: "Failed to update employee", variant: "destructive" }),
      },
    );
  };

  const handleDeactivate = () => {
    setIsDeactivating(true);
    deactivateMut.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Employee deactivated" });
        queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(id) });
        setIsDeactivating(false);
      },
      onError: () => {
        toast({ title: "Failed to deactivate", variant: "destructive" });
        setIsDeactivating(false);
      }
    });
  };

  if (isLoadingEmp || !employee) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Directory
        </Link>
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="md:col-span-1 border-none shadow-sm bg-card overflow-hidden relative">
          <div className="h-24 bg-primary/10 w-full absolute top-0 left-0" />
          <CardContent className="p-6 pt-12 relative z-10 text-center">
            <Avatar className="h-24 w-24 mx-auto border-4 border-background shadow-sm mb-4">
              <AvatarFallback className="bg-primary/5 text-primary text-2xl font-display">
                {getInitials(employee.firstName, employee.lastName)}
              </AvatarFallback>
            </Avatar>
            
            <h2 className="text-2xl font-display font-bold text-foreground">
              {employee.firstName} {employee.lastName}
            </h2>
            <p className="text-muted-foreground capitalize mb-3">
              {employee.role.replace('_', ' ')}
            </p>
            
            <Badge variant={
              employee.status === "active" ? "success" : 
              employee.status === "invited" ? "warning" : "secondary"
            } className="capitalize mb-6">
              {employee.status}
            </Badge>

            <div className="space-y-3 text-sm text-left border-t pt-6 border-border">
              <div className="flex items-center text-muted-foreground">
                <Mail className="h-4 w-4 mr-3 shrink-0" />
                <span className="truncate">{employee.email}</span>
              </div>
              {employee.department && (
                <div className="flex items-center text-muted-foreground">
                  <Briefcase className="h-4 w-4 mr-3 shrink-0" />
                  <span>{employee.department}</span>
                </div>
              )}
              {employee.location && (
                <div className="flex items-center text-muted-foreground">
                  <MapPin className="h-4 w-4 mr-3 shrink-0" />
                  <span>{employee.location}</span>
                </div>
              )}
              {employee.managerName && (
                <div className="flex items-center text-muted-foreground">
                  <Award className="h-4 w-4 mr-3 shrink-0" />
                  <span>Manager: {employee.managerName}</span>
                </div>
              )}
              <div className="flex items-center text-muted-foreground">
                <CalendarDays className="h-4 w-4 mr-3 shrink-0" />
                <span>Joined {new Date(employee.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            {isAdminOrManager && employee.status === 'active' && (
              <Button className="w-full mt-6 bg-primary hover:bg-primary/90" asChild>
                <Link href={`/send?to=${employee.id}`}>
                  <Send className="h-4 w-4 mr-2" />
                  Send Bucks
                </Link>
              </Button>
            )}

            {isAdmin && (
              <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full mt-3">
                    <Coins className="h-4 w-4 mr-2" />
                    Adjust Balance
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adjust Balance</DialogTitle>
                    <DialogDescription>
                      Credit or debit {employee.firstName}'s balance directly — for example, a starting
                      balance when they turn in physical Legend Bucks. This doesn't use your award budget.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Direction</Label>
                      <Select value={adjustDirection} onValueChange={(v) => setAdjustDirection(v as "credit" | "debit")}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit">Credit (add bucks)</SelectItem>
                          <SelectItem value="debit">Debit (remove bucks)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="e.g. 250"
                        value={adjustAmount}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Note (required)</Label>
                      <Input
                        placeholder="e.g. Starting balance – turned in physical bucks"
                        value={adjustNote}
                        onChange={(e) => setAdjustNote(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Shown in the ledger along with your name.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                    <Button onClick={handleAdjust} disabled={adjustMut.isPending} className="bg-primary hover:bg-primary/90">
                      {adjustMut.isPending
                        ? "Saving..."
                        : adjustDirection === "credit"
                          ? "Credit Bucks"
                          : "Debit Bucks"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {isAdmin && (
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full mt-3" onClick={openEdit}>
                    Edit Details
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Employee</DialogTitle>
                    <DialogDescription>
                      Update {employee.firstName}'s department, location, and manager.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Department</Label>
                      <Select value={editDept} onValueChange={setEditDept}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a department" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {departments?.map((d) => (
                            <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Select value={editLoc} onValueChange={setEditLoc}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a location" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {locations?.map((l) => (
                            <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Manager</Label>
                      <Select value={editManager} onValueChange={setEditManager}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a manager" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {managers.map((m) => (
                            <SelectItem key={m.id} value={m.id.toString()}>
                              {m.firstName} {m.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {employeeCanAward && (
                      <div className="space-y-2">
                        <Label>Yearly Award Budget</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="No budget"
                          value={editBudget}
                          onChange={(e) => setEditBudget(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Total Legend Bucks this person can award to others per year. Leave blank so they can't award until a budget is set.
                        </p>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveEdit} disabled={updateMut.isPending} className="bg-primary hover:bg-primary/90">
                      {updateMut.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {canDeactivate && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full mt-3 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
                    Deactivate Employee
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deactivate Employee</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to deactivate {employee.firstName} {employee.lastName}? 
                      They will no longer be able to log in or receive Legend Bucks.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDeactivating(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDeactivate} disabled={isDeactivating}>
                      {isDeactivating ? "Deactivating..." : "Deactivate"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="relative overflow-hidden bg-primary text-primary-foreground border-none shadow-sm p-6">
              <div className="absolute top-5 right-5 flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
                <Coins className="h-5 w-5 text-primary-foreground" />
              </div>
              <p className="text-sm font-medium text-primary-foreground/80 pr-12">Current Balance</p>
              <p className="text-3xl font-display font-bold mt-2 leading-none">
                {isLoadingBal ? "..." : balance?.balance.toLocaleString()}
              </p>
            </Card>
            <StatCard
              label="Total Received"
              icon={Award}
              tint="green"
              value={isLoadingBal ? "..." : balance?.totalReceived.toLocaleString()}
            />
            <StatCard
              label="Total Spent"
              icon={AlertTriangle}
              tint="slate"
              value={isLoadingBal ? "..." : balance?.totalSpent.toLocaleString()}
            />
          </div>

          {employeeCanAward && canViewBudget && budgetInfo?.budget != null && (
            <Card className="border-none shadow-sm bg-accent/5">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Yearly Award Budget</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Legend Bucks this person can award to others this year.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-display font-bold text-foreground">
                    {budgetInfo.remaining?.toLocaleString()} <span className="text-base text-muted-foreground">/ {budgetInfo.budget.toLocaleString()} LB</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {budgetInfo.usedThisYear.toLocaleString()} LB awarded so far this year
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-none shadow-sm h-[500px] flex flex-col">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg">Transaction History</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto">
              {isLoadingTx ? (
                <div className="p-6 text-center text-muted-foreground">Loading...</div>
              ) : transactions && transactions.items.length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur-sm">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.items.map((tx) => {
                      const isPositive = 
                        (tx.type === 'award' && tx.toEmployeeId === id) || 
                        (tx.type === 'refund' && tx.toEmployeeId === id) ||
                        (tx.type === 'adjustment' && tx.toEmployeeId === id);
                        
                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                            {formatDateTime(tx.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-xs font-normal bg-background">
                              {tx.type.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[250px] truncate">
                            {tx.type === 'award' && tx.fromEmployeeId ? `From ${tx.fromEmployeeName}` : ''}
                            {tx.type === 'award' && tx.toEmployeeId && tx.fromEmployeeId === id ? `To ${tx.toEmployeeName}` : ''}
                            {tx.type === 'adjustment' && tx.createdByName ? `Recorded by ${tx.createdByName}` : ''}
                            {tx.note ? ` - ${tx.note}` : ''}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${isPositive ? 'text-green-600' : 'text-foreground'}`}>
                            {isPositive ? '+' : '-'}{Math.abs(tx.amount)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  No transactions yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
