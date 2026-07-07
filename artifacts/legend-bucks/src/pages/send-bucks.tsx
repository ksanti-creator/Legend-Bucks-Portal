import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useListEmployees, useGetMe, useSendBucks, useGetEmployeeAwardCap, getGetEmployeeAwardCapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, Coins, Loader2 } from "lucide-react";

const sendSchema = z.object({
  toEmployeeId: z.coerce.number().min(1, "Please select an employee"),
  amount: z.coerce.number().min(1, "Amount must be at least 1"),
  note: z.string().min(10, "Please provide a descriptive note (min 10 chars) for the recognition"),
});

export default function SendBucks() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe();
  
  // Quick pre-select from URL if coming from employee profile
  const searchParams = new URLSearchParams(window.location.search);
  const defaultToId = searchParams.get("to") || "";

  const { data: employees } = useListEmployees({ status: "active" });
  
  // Filter out the current user
  const eligibleEmployees = employees?.filter(e => e.id !== user?.id) || [];

  const sendMut = useSendBucks();

  const form = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: {
      toEmployeeId: defaultToId ? parseInt(defaultToId) : undefined,
      amount: 50,
      note: "",
    },
  });

  // Show the awarding manager's remaining yearly cap for the selected recipient.
  // Admins are never capped, so this is only fetched for managers.
  const watchedTo = form.watch("toEmployeeId");
  const recipientId = watchedTo ? Number(watchedTo) : 0;
  const isManager = user?.role === "manager";
  const { data: capInfo } = useGetEmployeeAwardCap(recipientId, {
    query: { queryKey: getGetEmployeeAwardCapQueryKey(recipientId), enabled: isManager && recipientId > 0, retry: false },
  });

  if (user?.role !== "admin" && user?.role !== "manager") {
    return <div className="p-8 text-center text-destructive">Unauthorized. Managers only.</div>;
  }

  const onSubmit = (data: z.infer<typeof sendSchema>) => {
    sendMut.mutate(
      { data },
      {
        onSuccess: () => {
          toast({
            title: "Bucks Sent!",
            description: `Successfully sent ${data.amount} LB to recognize great work.`,
          });
          setLocation("/dashboard");
        },
        onError: (err: any) => {
          toast({
            title: "Failed to send bucks",
            description: err?.message || "Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-in fade-in duration-500 py-8">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-4 bg-primary/10 text-primary rounded-full mb-4">
          <Send className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Recognize Great Work</h1>
        <p className="text-muted-foreground mt-2">Send Legend Bucks to a team member to show your appreciation.</p>
      </div>

      <Card className="border-none shadow-lg">
        <CardContent className="p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="toEmployeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Member</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      defaultValue={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger className="h-12 text-base">
                          <SelectValue placeholder="Select someone to recognize" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[300px]">
                        {eligibleEmployees.map(emp => (
                          <SelectItem key={emp.id} value={emp.id.toString()}>
                            {emp.firstName} {emp.lastName} {emp.department ? `(${emp.department})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isManager && capInfo?.cap != null && (
                <div className="rounded-md bg-muted/50 border border-border px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Your yearly award cap for this person: </span>
                  <strong className="text-foreground">{capInfo.remaining?.toLocaleString()} LB</strong>
                  <span className="text-muted-foreground"> remaining of {capInfo.cap.toLocaleString()} LB.</span>
                </div>
              )}

              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (Legend Bucks)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Coins className="absolute left-3 top-3.5 h-5 w-5 text-accent" />
                        <Input 
                          type="number" 
                          min="1" 
                          className="pl-11 h-12 text-lg font-bold" 
                          {...field} 
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recognition Note</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Tell them why they are receiving this award. Be specific about their great work..." 
                        className="min-h-[120px] text-base resize-none"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      This message will be visible to the employee and appear in the activity feed.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4">
                <Button 
                  type="submit" 
                  size="lg"
                  className="w-full text-lg font-semibold bg-primary hover:bg-primary/90"
                  disabled={sendMut.isPending}
                >
                  {sendMut.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Send className="h-5 w-5 mr-2" />}
                  Send Award
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
