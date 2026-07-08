import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRequestMagicLink, useVerifyMagicLink, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Mail, KeyRound, Loader2, FlaskConical, ShieldCheck, Users, User, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { setSessionToken } from "@/lib/auth-token";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const tokenSchema = z.object({
  token: z.string().min(6, "Token must be at least 6 characters"),
});

const DEV_ACCOUNTS = [
  {
    email: "sarah.mitchell@legendboats.com",
    name: "Sarah Mitchell",
    role: "Admin",
    icon: ShieldCheck,
    color: "text-[#00afed]",
  },
  {
    email: "james.kowalski@legendboats.com",
    name: "James Kowalski",
    role: "Manager",
    icon: Users,
    color: "text-[#35b729]",
  },
  {
    email: "mike.henderson@legendboats.com",
    name: "Mike Henderson",
    role: "Team Member",
    icon: User,
    color: "text-sidebar-foreground/60",
  },
  {
    email: "fiona.chen@legendboats.com",
    name: "Fiona Chen",
    role: "Accounting Admin",
    icon: Calculator,
    color: "text-amber-400",
  },
] as const;

export default function Login() {
  const [step, setStep] = useState<"email" | "token">("email");
  const [email, setEmail] = useState("");
  const [quickLoggingIn, setQuickLoggingIn] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const requestMagicLink = useRequestMagicLink();
  const verifyMagicLink = useVerifyMagicLink();

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const tokenForm = useForm<z.infer<typeof tokenSchema>>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { token: "" },
  });

  const onEmailSubmit = (data: z.infer<typeof emailSchema>) => {
    setEmail(data.email);
    requestMagicLink.mutate(
      { data: { email: data.email } },
      {
        onSuccess: (res) => {
          setStep("token");
          toast({ title: "Magic link sent!", description: "Check your email for the login token." });
          if (res.token) tokenForm.setValue("token", res.token);
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to send magic link. Check your email and try again.", variant: "destructive" });
        },
      }
    );
  };

  const onTokenSubmit = (data: z.infer<typeof tokenSchema>) => {
    verifyMagicLink.mutate(
      { data: { token: data.token } },
      {
        onSuccess: ({ token, ...user }) => {
          setSessionToken(token);
          queryClient.setQueryData(getGetMeQueryKey(), user);
          toast({ title: "Welcome back!" });
          setLocation("/dashboard");
        },
        onError: () => {
          toast({ title: "Invalid token", description: "The token is invalid or has expired.", variant: "destructive" });
        },
      }
    );
  };

  /** One-click dev login: request token then immediately verify it */
  const quickLogin = async (accountEmail: string) => {
    setQuickLoggingIn(accountEmail);
    try {
      await new Promise<void>((resolve, reject) => {
        requestMagicLink.mutate(
          { data: { email: accountEmail } },
          {
            onSuccess: (res) => {
              if (!res.token) {
                reject(new Error("No token returned — quick login only works in development mode."));
                return;
              }
              verifyMagicLink.mutate(
                { data: { token: res.token } },
                {
                  onSuccess: ({ token, ...user }) => {
                    setSessionToken(token);
                    queryClient.setQueryData(getGetMeQueryKey(), user);
                    resolve();
                    setLocation("/dashboard");
                  },
                  onError: (e) => reject(e),
                }
              );
            },
            onError: (e) => reject(e),
          }
        );
      });
    } catch {
      toast({ title: "Quick login failed", description: "Make sure the API server is running.", variant: "destructive" });
    } finally {
      setQuickLoggingIn(null);
    }
  };

  return (
    <div className="min-h-screen flex bg-sidebar text-sidebar-foreground overflow-hidden">
      {/* Left panel — brand splash */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] relative p-12 overflow-hidden">
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #00afed 0%, #0090cc 60%, #4f4f51 100%)" }} />
        <div className="absolute bottom-0 right-0 w-[140%] h-[140%] opacity-10 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 80% 110%, #35b729 0%, transparent 60%)" }} />

        <div className="relative z-10">
          <img src="/logos/legend-boats-logo.png" alt="Legend Boats" className="h-12 brightness-0 invert" />
        </div>

        <div className="relative z-10 flex flex-col gap-6">
          <img src="/logos/legend-bucks-rewards-white.png" alt="Legend Bucks Rewards Program" className="w-72 drop-shadow-xl" />
          <p className="text-white/80 text-sm max-w-xs leading-relaxed">
            Recognise great work. Reward your crew. Built for the Legend Boats team.
          </p>
        </div>

        <p className="relative z-10 text-white/40 text-xs">© {new Date().getFullYear()} Legend Boats Inc.</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 app-gradient-bg text-foreground min-h-screen">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <img src="/logos/legend-bucks-rewards.png" alt="Legend Bucks" className="h-16 mx-auto mb-2" />
        </div>

        <div className="w-full max-w-sm space-y-5">
          {/* ── Dev Quick Login (development only) ───────────────── */}
          {import.meta.env.DEV && (
            <>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
                  <FlaskConical className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">Dev — Quick Login</span>
                </div>
                <div className="p-3 space-y-2">
                  {DEV_ACCOUNTS.map((account) => {
                    const Icon = account.icon;
                    const isLoading = quickLoggingIn === account.email;
                    return (
                      <button
                        key={account.email}
                        onClick={() => quickLogin(account.email)}
                        disabled={quickLoggingIn !== null}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading
                          ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                          : <Icon className={`h-4 w-4 shrink-0 ${account.color}`} />
                        }
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{account.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{account.role}</p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">→</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">or sign in with email</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </>
          )}

          {/* ── Sign-in form ────────────────────────────────────── */}
          <div>
            <div className="mb-5">
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {step === "email" ? "Sign In" : "Check Your Email"}
              </h1>
              <p className="text-muted-foreground text-sm">
                {step === "email"
                  ? "Enter your company email to receive a magic login link."
                  : `We sent a code to ${email}`}
              </p>
            </div>

            <Card className="shadow-lg">
              <CardContent className="pt-6">
                {step === "email" ? (
                  <Form {...emailForm}>
                    <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                      <FormField
                        control={emailForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-muted-foreground text-xs uppercase tracking-wider">Email Address</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                  placeholder="name@legendboats.com"
                                  className="pl-10"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type="submit"
                        className="w-full font-semibold bg-primary hover:bg-primary/90 text-white"
                        disabled={requestMagicLink.isPending}
                      >
                        {requestMagicLink.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Send Magic Link
                      </Button>
                    </form>
                  </Form>
                ) : (
                  <Form {...tokenForm}>
                    <form onSubmit={tokenForm.handleSubmit(onTokenSubmit)} className="space-y-4">
                      <FormField
                        control={tokenForm.control}
                        name="token"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-muted-foreground text-xs uppercase tracking-wider">Login Token</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                  placeholder="Paste your token here"
                                  className="pl-10 font-mono tracking-wider"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex flex-col gap-2">
                        <Button
                          type="submit"
                          className="w-full font-semibold bg-primary hover:bg-primary/90 text-white"
                          disabled={verifyMagicLink.isPending}
                        >
                          {verifyMagicLink.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          Verify &amp; Log In
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground text-sm"
                          onClick={() => setStep("email")}
                        >
                          ← Back to email
                        </Button>
                      </div>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-muted-foreground text-xs">
            No account? Ask your manager to invite you.
          </p>
        </div>
      </div>
    </div>
  );
}
