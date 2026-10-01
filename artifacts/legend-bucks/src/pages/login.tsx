import { useState, useEffect, useRef } from "react";
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
    email: "preview.admin@example.test",
    name: "Alex Preview",
    role: "Admin",
    icon: ShieldCheck,
    color: "text-primary",
  },
  {
    email: "aipulse@legendboats.com",
    name: "AI Pulse",
    role: "Manager",
    icon: Users,
    color: "text-emerald-700",
  },
  {
    email: "preview.employee@example.test",
    name: "Sam Preview",
    role: "Team Member",
    icon: User,
    color: "text-muted-foreground",
  },
  {
    email: "preview.payroll@example.test",
    name: "Pat Preview",
    role: "Accounting Admin",
    icon: Calculator,
    color: "text-amber-700",
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

  /**
   * When the user arrives via a magic-link email (`/login?token=...`),
   * pick up the token from the URL and verify it automatically so they
   * don't have to copy/paste anything.
   */
  const autoVerifiedRef = useRef(false);
  useEffect(() => {
    if (autoVerifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (!urlToken) return;
    autoVerifiedRef.current = true;
    // Strip the token from the URL so it doesn't linger in browser history.
    window.history.replaceState({}, "", window.location.pathname);
    setStep("token");
    tokenForm.setValue("token", urlToken);
    verifyMagicLink.mutate(
      { data: { token: urlToken } },
      {
        onSuccess: ({ token, ...user }) => {
          setSessionToken(token);
          queryClient.setQueryData(getGetMeQueryKey(), user);
          toast({ title: "Welcome back!" });
          setLocation("/dashboard");
        },
        onError: () => {
          toast({
            title: "Invalid or expired link",
            description: "Enter your email below to get a fresh sign-in link.",
            variant: "destructive",
          });
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="relative min-h-[100dvh] overflow-hidden text-foreground" style={{ background: "linear-gradient(180deg, #DCEFFB 0%, #EAF6FD 42%, #F4FAFD 100%)" }}>
      <LakesideScene />

      <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/logos/legend-boats-logo.png" alt="Legend Boats" className="h-8 w-auto sm:h-9" />
        </div>

        <div className="w-full max-w-md space-y-5 rounded-[2rem] border border-white/70 bg-white/85 p-6 card-lift backdrop-blur-md sm:p-8">
          <img src="/logos/legend-bucks-rewards.png" alt="Legend Bucks" className="mx-auto h-14 w-auto sm:h-16" />
          <p className="text-center text-sm text-muted-foreground leading-relaxed">
            Recognise great work. Reward your crew. Built for the Legend Boats team.
          </p>
          {/* ── Dev Quick Login (development only) ───────────────── */}
          {import.meta.env.DEV && import.meta.env.VITE_LEGEND_BUCKS_SANDBOX === "true" && (
            <>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
                  <FlaskConical className="h-3.5 w-3.5 text-amber-800 shrink-0" />
                  <span className="text-amber-800 text-xs font-semibold uppercase tracking-wider">Sandbox preview — simulated data, no emails or awards to real employees</span>
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
                        className="w-full min-h-11 flex items-center gap-3 px-3 py-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
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
              <h1 className="text-2xl font-bold text-foreground mb-1 text-center">
                {step === "email" ? "Sign In" : "Check Your Email"}
              </h1>
              <p className="text-muted-foreground text-sm text-center">
                {step === "email"
                  ? "Enter your company email to receive a magic login link."
                  : `We sent a code to ${email}`}
              </p>
            </div>

            <Card className="shadow-none border-border/70 bg-white/70">
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
                        className="w-full font-semibold "
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
                          className="w-full font-semibold "
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
        <p className="mt-6 text-xs text-[#16242A]/70">© {new Date().getFullYear()} Legend Boats Inc.</p>
      </div>
    </div>
  );
}

function Cloud({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 120 50" className={className} aria-hidden="true">
      <path d="M20 44h82a16 16 0 0 0 0-32 22 22 0 0 0-40-6 18 18 0 0 0-30 12A14 14 0 0 0 20 44z" fill="#fff" />
    </svg>
  );
}

function LakesideScene() {
  return (
    <div className="pointer-events-none absolute inset-0 select-none" aria-hidden="true">
      <div className="cloud-drift absolute left-[6%] top-[9%]"><Cloud className="w-24 sm:w-32 opacity-95" /></div>
      <div className="cloud-drift-slow absolute right-[8%] top-[15%]"><Cloud className="w-20 sm:w-28 opacity-90" /></div>
      <div className="cloud-drift absolute left-[58%] top-[5%] hidden sm:block"><Cloud className="w-16 opacity-80" /></div>
      <svg className="absolute inset-x-0 top-[44%] w-full h-[56%]" viewBox="0 0 1440 600" preserveAspectRatio="none">
        <path d="M0 70 C200 30 360 50 520 40 S880 20 1040 45 1320 30 1440 50 V110 H0Z" fill="#CFE5EA" />
        <path d="M0 110 L40 70 L70 105 L110 60 L150 104 L190 72 L230 106 L280 58 L320 104 L370 76 L410 106 L460 62 L500 104 L560 74 L600 106 L660 60 L700 104 L760 78 L800 106 L860 64 L900 104 L960 72 L1000 106 L1060 62 L1100 104 L1160 76 L1200 106 L1260 60 L1300 104 L1360 74 L1400 106 L1440 70 V112 H0Z" fill="#AFCFC9" />
        <rect x="0" y="110" width="1440" height="490" fill="#BEE5F3" />
        <rect className="water-shimmer" x="0" y="110" width="1440" height="3" fill="#F6EFE2" />
        <path className="water-shimmer" d="M160 170h120M900 210h160M420 260h90M1180 300h110M260 360h140" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      </svg>
    </div>
  );
}
