import { useState } from "react";
import { 
  useListGoals, 
  useCreateGoal, 
  useUpdateGoal, 
  useContributeToGoal, 
  useListGoalContributions,
  useGetMe
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Target, Plus, Coins, CalendarDays, Loader2, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const createGoalSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  description: z.string().optional(),
  department: z.string().optional(),
  targetAmount: z.coerce.number().min(100, "Target must be at least 100"),
  endsAt: z.string().optional().nullable(),
});

export default function Goals() {
  const { data: user } = useGetMe();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [openCreate, setOpenCreate] = useState(false);
  const [contributeGoalId, setContributeGoalId] = useState<number | null>(null);
  const [contributionAmount, setContributionAmount] = useState<number>(50);

  const { data: goals, isLoading } = useListGoals();

  const createMut = useCreateGoal();
  const contributeMut = useContributeToGoal();

  const form = useForm<z.infer<typeof createGoalSchema>>({
    resolver: zodResolver(createGoalSchema),
    defaultValues: {
      name: "",
      description: "",
      department: "",
      targetAmount: 5000,
      endsAt: null,
    },
  });

  const onSubmitCreate = (data: z.infer<typeof createGoalSchema>) => {
    createMut.mutate(
      { data },
      {
        onSuccess: () => {
          setOpenCreate(false);
          toast({ title: "Goal created successfully" });
          queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
          form.reset();
        },
        onError: () => {
          toast({ title: "Failed to create goal", variant: "destructive" });
        }
      }
    );
  };

  const handleContribute = () => {
    if (!contributeGoalId) return;
    
    if (contributionAmount <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }

    if (contributionAmount > (user?.balance || 0)) {
      toast({ title: "Insufficient balance", variant: "destructive" });
      return;
    }

    contributeMut.mutate(
      { id: contributeGoalId, data: { amount: contributionAmount } },
      {
        onSuccess: () => {
          setContributeGoalId(null);
          toast({ title: "Contribution successful", description: `You contributed ${contributionAmount} LB to the goal.` });
          queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        },
        onError: (err: any) => {
          toast({ title: "Failed to contribute", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Team Goals</h1>
          <p className="text-muted-foreground mt-1">Pool your Legend Bucks together for collective rewards.</p>
        </div>
        
        {isAdmin && (
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                Create Goal
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Team Goal</DialogTitle>
                <DialogDescription>
                  Set up a collective goal that employees can contribute their bucks towards.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitCreate)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Goal Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Pizza Party for Production Team" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="What are we working towards?" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Department</FormLabel>
                          <FormControl>
                            <Input placeholder="Leave blank for all" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="targetAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target Amount (LB)</FormLabel>
                          <FormControl>
                            <Input type="number" min="100" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="endsAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Date (Optional)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <DialogFooter className="pt-4">
                    <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
                    <Button type="submit" disabled={createMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                      {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Goal
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3].map(i => (
            <Card key={i} className="animate-pulse h-64 border-none" />
          ))}
        </div>
      ) : goals?.length === 0 ? (
        <div className="text-center py-20 bg-muted/20 rounded-xl border border-dashed">
          <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground mb-1">No active goals</h3>
          <p className="text-muted-foreground">Check back later for new team goals.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {goals?.map((goal) => (
            <Card key={goal.id} className="border-none shadow-sm flex flex-col h-full hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start mb-2">
                  {goal.department ? (
                    <Badge variant="outline" className="text-xs">{goal.department}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Company-wide</Badge>
                  )}
                  {goal.endsAt && (
                    <span className="text-xs text-muted-foreground flex items-center">
                      <CalendarDays className="h-3 w-3 mr-1" />
                      {new Date(goal.endsAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <CardTitle className="text-xl leading-tight">{goal.name}</CardTitle>
                <CardDescription className="line-clamp-2 min-h-[40px]">{goal.description}</CardDescription>
              </CardHeader>
              
              <CardContent className="pb-4 flex-1">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-primary">{goal.currentAmount.toLocaleString()} LB</span>
                    <span className="text-muted-foreground">Target: {goal.targetAmount.toLocaleString()} LB</span>
                  </div>
                  <Progress value={goal.progressPercent || 0} className="h-3" />
                  <p className="text-right text-xs text-muted-foreground">{goal.progressPercent}% Complete</p>
                </div>
              </CardContent>
              
              <CardFooter className="pt-0 border-t border-border/50 mt-auto px-6 py-4">
                <Dialog open={contributeGoalId === goal.id} onOpenChange={(open) => !open && setContributeGoalId(null)}>
                  <DialogTrigger asChild>
                    <Button 
                      className="w-full" 
                      variant={goal.progressPercent! >= 100 ? "outline" : "default"}
                      disabled={goal.progressPercent! >= 100 || !goal.active}
                      onClick={() => setContributeGoalId(goal.id)}
                    >
                      {goal.progressPercent! >= 100 ? "Goal Met!" : !goal.active ? "Closed" : "Contribute Bucks"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Contribute to {goal.name}</DialogTitle>
                      <DialogDescription>
                        Help your team reach their goal! Your current balance is <strong>{user?.balance?.toLocaleString()} LB</strong>.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-6 space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Contribution Amount (LB)</label>
                        <div className="relative">
                          <Coins className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input 
                            type="number" 
                            min="1" 
                            max={user?.balance || 0}
                            value={contributionAmount}
                            onChange={(e) => setContributionAmount(parseInt(e.target.value) || 0)}
                            className="pl-9"
                          />
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        {[10, 50, 100, 500].map(amt => (
                          <Button 
                            key={amt} 
                            type="button" 
                            variant="outline" 
                            size="sm"
                            className="flex-1"
                            onClick={() => setContributionAmount(amt)}
                            disabled={(user?.balance || 0) < amt}
                          >
                            +{amt}
                          </Button>
                        ))}
                      </div>
                    </div>
                    
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setContributeGoalId(null)}>Cancel</Button>
                      <Button 
                        onClick={handleContribute} 
                        disabled={contributeMut.isPending || contributionAmount <= 0 || contributionAmount > (user?.balance || 0)}
                      >
                        {contributeMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Confirm Contribution
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
