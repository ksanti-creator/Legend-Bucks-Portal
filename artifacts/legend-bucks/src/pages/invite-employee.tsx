import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useInviteEmployee, useGetMe, useListEmployees, useListDepartments, useListLocations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowLeft, Loader2, Upload, UserPlus } from "lucide-react";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BulkInviteUpload from "@/components/bulk-invite-upload";
import { useI18n } from "@/lib/i18n";

const createInviteSchema = (t: (source: string) => string) => z.object({
  email: z.string().email(t("Valid email required")),
  firstName: z.string().min(2, t("First name required")),
  lastName: z.string().min(2, t("Last name required")),
  role: z.enum(["admin", "manager", "team_member"], { errorMap: () => ({ message: t("Select a valid role") }) }),
  departmentId: z.coerce.number().optional().nullable(),
  locationId: z.coerce.number().optional().nullable(),
  managerId: z.coerce.number().optional().nullable(),
  awardBudgetYearly: z.number({ invalid_type_error: t("Enter a valid number") }).min(1, t("Amount must be at least 1")).optional().nullable(),
  startingBalance: z.number({ invalid_type_error: t("Enter a valid number") }).int(t("Enter a whole number")).min(1, t("Amount must be at least 1")).optional().nullable(),
});
type InviteValues = z.infer<ReturnType<typeof createInviteSchema>>;

export default function InviteEmployee() {
  const { t } = useI18n();
  const inviteSchema = createInviteSchema(t);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user } = useGetMe();
  
  // Need managers for the select dropdown
  const { data: employees } = useListEmployees();
  const managers = employees?.filter(e => e.role === "manager" || e.role === "admin") || [];

  const inviteMut = useInviteEmployee();

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      role: "team_member",
      departmentId: null,
      locationId: null,
      managerId: null,
      awardBudgetYearly: null,
      startingBalance: null,
    },
  });

  const { data: departments } = useListDepartments();
  const { data: locations } = useListLocations();

  // Only admins and managers can award, so they get a sending budget. Pre-fill a
  // sensible default the inviter can adjust; clear it for team members (who can't
  // award). We only auto-fill when the field is empty so a manual edit sticks.
  const DEFAULT_AWARD_BUDGET = 50000;
  const selectedRole = form.watch("role");
  const canAward = selectedRole === "admin" || selectedRole === "manager";
  useEffect(() => {
    if (canAward) {
      if (form.getValues("awardBudgetYearly") == null) {
        form.setValue("awardBudgetYearly", DEFAULT_AWARD_BUDGET, { shouldDirty: false });
      }
    } else {
      form.setValue("awardBudgetYearly", null, { shouldDirty: false });
    }
  }, [canAward]);

  if (user?.role !== "admin" && user?.role !== "manager") {
    return <div className="p-8 text-center text-destructive">{t("Unauthorized. Admins and managers only.")}</div>;
  }

  const onSubmit = (data: InviteValues) => {
    inviteMut.mutate(
      { data },
      {
        onSuccess: () => {
          toast({
            title: t("Employee invited"),
            description: t("An invitation has been sent to {email}.", { email: data.email }),
          });
          setLocation("/employees");
        },
        onError: () => {
          toast({
            title: t("Failed to invite employee"),
            description: t("There was an error creating the invitation."),
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t("Back to Directory")}
        </Link>
      </Button>

      <Tabs defaultValue="single">
        {user?.role === "admin" && (
          <TabsList className="mb-4">
            <TabsTrigger value="single">
              <UserPlus className="h-4 w-4 mr-2" />
              {t("Single Invite")}
            </TabsTrigger>
            <TabsTrigger value="bulk">
              <Upload className="h-4 w-4 mr-2" />
              {t("Bulk Upload")}
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="single">
      <Card className="border-none shadow-md">
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="text-2xl font-display">{t("Invite New Employee")}</CardTitle>
          <CardDescription>
            {t("Add a new team member to Legend Bucks. They will receive an email to log in.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("First Name")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("John")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Last Name")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("Doe")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("Email Address")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="john.doe@legendboats.com" className="pl-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Role")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Select a role")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="team_member">{t("Team Member")}</SelectItem>
                          <SelectItem value="manager">{t("Manager")}</SelectItem>
                          {user?.role === "admin" && (
                            <SelectItem value="admin">{t("Administrator")}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="managerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Manager (Optional)")}</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val))} 
                        defaultValue={field.value?.toString() || "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Select a manager")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("None")}</SelectItem>
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Department (Optional)")}</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val))}
                        value={field.value ? field.value.toString() : "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Select a department")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("None")}</SelectItem>
                          {departments?.map((dept) => (
                            <SelectItem key={dept.id} value={dept.id.toString()}>
                              {dept.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="locationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Location (Optional)")}</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val === "none" ? null : parseInt(val))}
                        value={field.value ? field.value.toString() : "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("Select a location")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("None")}</SelectItem>
                          {locations?.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id.toString()}>
                              {loc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {user?.role === "admin" && (
                <FormField
                  control={form.control}
                  name="startingBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Starting Balance (Optional)")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="0"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Legend Bucks to credit right away — for example, physical bucks they turned in. Recorded in the ledger as "Starting balance – turned in physical bucks". Leave empty for none.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {canAward && (
                <FormField
                  control={form.control}
                  name="awardBudgetYearly"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("Yearly Award Budget")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder={t("No budget")}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t("The total Legend Bucks this person can award to others per calendar year. Pre-filled with a default for admins and managers — adjust it as needed, or clear it so they can't award until you set a budget.")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="flex justify-end pt-4 border-t border-border">
                <Button type="button" variant="outline" className="mr-3" onClick={() => setLocation("/employees")}>
                  {t("Cancel")}
                </Button>
                <Button type="submit" disabled={inviteMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]">
                  {inviteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                  {t("Send Invite")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="bulk">
          <BulkInviteUpload />
        </TabsContent>
      </Tabs>
    </div>
  );
}
