import { 
  useGetMe, 
  useLogout, 
  useUpdateEmployee,
  useUpdateNotificationPreferences,
  useGetSettings,
  useUpdateSettings,
  getGetMeQueryKey,
  getGetSettingsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { clearSessionToken } from "@/lib/auth-token";
import { LogOut, Loader2, Save, Bell, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";

export default function Settings() {
  const { t, label } = useI18n();
  const profileSchema = z.object({
    firstName: z.string().min(2, t("First name required")),
    lastName: z.string().min(2, t("Last name required")),
  });
  const { data: user } = useGetMe();
  const logout = useLogout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMut = useUpdateEmployee();
  const notifyMut = useUpdateNotificationPreferences();

  const isAdmin = user?.role === "admin";
  // Global "maximum single award" setting is admin-only. Any authed user can
  // read it (for client validation), but only admins can change it here.
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), enabled: !!user } });
  const settingsMut = useUpdateSettings();
  const [maxAward, setMaxAward] = useState<string>("");

  useEffect(() => {
    setMaxAward(settings?.maxSingleAward != null ? String(settings.maxSingleAward) : "");
  }, [settings?.maxSingleAward]);

  const saveMaxAward = () => {
    const value = maxAward.trim() === "" ? null : parseInt(maxAward, 10);
    if (value != null && (Number.isNaN(value) || value < 1)) {
      toast({ title: t("Enter a positive number or leave blank"), variant: "destructive" });
      return;
    }
    settingsMut.mutate(
      { data: { maxSingleAward: value } },
      {
        onSuccess: () => {
          toast({ title: t("Award limit saved") });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: () => toast({ title: t("Failed to save award limit"), variant: "destructive" }),
      },
    );
  };

  // Local mirror of the user's notification toggles, seeded from the server.
  const [prefs, setPrefs] = useState({
    notifyBucksReceived: true,
    notifyRedemptionUpdates: true,
    notifyNewRedemptionRequests: true,
  });

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
    },
  });

  // Reset profile only when its actual server fields change. Preference saves
  // replace the user cache object but must not discard unsaved name edits.
  useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.firstName,
        lastName: user.lastName,
      });
    }
  }, [user?.id, user?.firstName, user?.lastName, form]);

  useEffect(() => {
    if (user) {
      setPrefs({
        notifyBucksReceived: user.notifyBucksReceived,
        notifyRedemptionUpdates: user.notifyRedemptionUpdates,
        notifyNewRedemptionRequests: user.notifyNewRedemptionRequests,
      });
    }
  }, [user?.id, user?.notifyBucksReceived, user?.notifyRedemptionUpdates, user?.notifyNewRedemptionRequests]);

  // Toggle a single preference and persist the whole set immediately.
  const togglePref = (key: keyof typeof prefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    notifyMut.mutate(
      { data: next },
      {
        onSuccess: () => {
          toast({ title: t("Notification preferences saved") });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => {
          setPrefs(prefs); // revert on failure
          toast({ title: t("Failed to save preferences"), variant: "destructive" });
        },
      },
    );
  };

  const onSubmit = (data: z.infer<typeof profileSchema>) => {
    if (!user) return;
    
    updateMut.mutate(
      { id: user.id, data },
      {
        onSuccess: () => {
          toast({ title: t("Profile updated successfully") });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        },
        onError: () => {
          toast({ title: t("Failed to update profile"), variant: "destructive" });
        }
      }
    );
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        clearSessionToken();
        queryClient.clear();
        window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/login`;
      },
    });
  };

  if (!user) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">{t("Account Settings")}</h1>
        <p className="text-muted-foreground mt-1">{t("Manage your personal profile and preferences.")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card className="border-none shadow-sm text-center">
            <CardContent className="pt-6">
              <Avatar className="h-24 w-24 mx-auto mb-4 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/5 text-primary text-2xl font-display">
                  {getInitials(user.firstName, user.lastName)}
                </AvatarFallback>
              </Avatar>
              <h2 className="font-semibold text-lg">{user.firstName} {user.lastName}</h2>
              <p className="text-muted-foreground text-sm">{user.email}</p>
              <p className="text-xs font-medium uppercase tracking-wider mt-2 px-2 py-1 bg-muted rounded-full inline-block">
                {label(user.role)}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle>{t("Language")}</CardTitle>
              <CardDescription>{t("Choose your portal language. Save your choice to use it on your next visit.")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6"><LanguageSelector /></CardContent>
          </Card>
          <Card className="border-none shadow-sm">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle>{t("Personal Information")}</CardTitle>
              <CardDescription>{t("Update your display name.")}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("First Name")}</FormLabel>
                          <FormControl>
                            <Input {...field} />
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
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="settings-email">{t("Email Address")}</Label>
                    <Input id="settings-email" value={user.email} disabled className="bg-muted/50" />
                    <p className="text-xs text-muted-foreground">{t("Contact IT to change your email address.")}</p>
                  </div>
                  
                  <div className="pt-4 flex justify-end">
                    <Button type="submit" disabled={updateMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                      {updateMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {t("Save Changes")}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                {t("Email Notifications")}
              </CardTitle>
              <CardDescription>
                {t("Choose which emails you'd like to receive. Sign-in links are always sent.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 divide-y divide-border/60">
              {[
                {
                  key: "notifyBucksReceived" as const,
                  title: "Legend Bucks received",
                  desc: "When a colleague or manager awards you Legend Bucks.",
                },
                {
                  key: "notifyRedemptionUpdates" as const,
                  title: "Redemption updates",
                  desc: "Receipts and status changes for rewards you redeem.",
                },
                // Approver-only email: only admins and managers ever receive it.
                ...(user.role === "admin" || user.role === "manager"
                  ? [
                      {
                        key: "notifyNewRedemptionRequests" as const,
                        title: "New redemption requests",
                        desc: "When an employee you can approve for redeems a reward.",
                      },
                    ]
                  : []),
              ].map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t(row.title)}</p>
                    <p className="text-xs text-muted-foreground">{t(row.desc)}</p>
                  </div>
                  <Switch
                    checked={prefs[row.key]}
                    aria-label={t(row.title)}
                    disabled={notifyMut.isPending}
                    onCheckedChange={(v) => togglePref(row.key, v)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card className="border-none shadow-sm">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {t("Award Limits")}
                </CardTitle>
                <CardDescription>
                  {t("Set the maximum Legend Bucks allowed in a single award, across the whole company. Leave blank for no limit.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="settings-max-award">{t("Maximum single award (LB)")}</Label>
                  <Input
                    id="settings-max-award"
                    type="number"
                    min="1"
                    placeholder={t("No limit")}
                    value={maxAward}
                    onChange={(e) => setMaxAward(e.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveMaxAward} disabled={settingsMut.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    {settingsMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {t("Save Limit")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-destructive/30 shadow-sm">
            <CardHeader className="border-b border-destructive/10 bg-destructive/5">
              <CardTitle className="text-destructive">{t("Session")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                {t("Sign out of your account on this device.")}
              </p>
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                {t("Sign Out")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
