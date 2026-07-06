import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRequestMagicLink, useVerifyMagicLink } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Mail, KeyRound, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const tokenSchema = z.object({
  token: z.string().min(6, "Token must be at least 6 characters"),
});

export default function Login() {
  const [step, setStep] = useState<"email" | "token">("email");
  const [email, setEmail] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

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
          toast({
            title: "Magic link sent!",
            description: "Check your email for the login token.",
          });
          // In dev mode, the token is returned in the response
          if (res.token) {
            tokenForm.setValue("token", res.token);
          }
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to send magic link. Please check your email and try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const onTokenSubmit = (data: z.infer<typeof tokenSchema>) => {
    verifyMagicLink.mutate(
      { data: { token: data.token } },
      {
        onSuccess: () => {
          toast({
            title: "Welcome back!",
            description: "You have successfully logged in.",
          });
          setLocation("/dashboard");
        },
        onError: () => {
          toast({
            title: "Invalid token",
            description: "The token you entered is invalid or has expired.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex bg-sidebar text-sidebar-foreground overflow-hidden">
      {/* Left panel — brand splash */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] relative p-12 overflow-hidden">
        {/* Diagonal colour block */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(135deg, #00afed 0%, #0090cc 60%, #4f4f51 100%)",
          }}
        />
        {/* Subtle wave overlay */}
        <div className="absolute bottom-0 right-0 w-[140%] h-[140%] opacity-10 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 80% 110%, #35b729 0%, transparent 60%)",
          }}
        />

        {/* Legend Boats wordmark */}
        <div className="relative z-10">
          <img
            src="/logos/legend-boats-logo.png"
            alt="Legend Boats"
            className="h-12 brightness-0 invert"
          />
        </div>

        {/* Legend Bucks badge */}
        <div className="relative z-10 flex flex-col gap-6">
          <img
            src="/logos/legend-bucks-rewards.png"
            alt="Legend Bucks Rewards Program"
            className="w-72 brightness-0 invert drop-shadow-xl"
          />
          <p className="text-white/80 text-sm max-w-xs leading-relaxed">
            Recognise great work. Reward your crew. Built for the Legend Boats team.
          </p>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-white/40 text-xs">
          © {new Date().getFullYear()} Legend Boats Inc.
        </p>
      </div>

      {/* Right panel — sign-in form */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 bg-sidebar min-h-screen">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <img
            src="/logos/legend-bucks-rewards.png"
            alt="Legend Bucks"
            className="h-16 mx-auto brightness-0 invert mb-2"
          />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-1">
              {step === "email" ? "Sign In" : "Check Your Email"}
            </h1>
            <p className="text-sidebar-foreground/60 text-sm">
              {step === "email"
                ? "Enter your company email to receive a magic login link."
                : `We sent a code to ${email}`}
            </p>
          </div>

          <Card className="border-sidebar-border bg-sidebar-accent/30 backdrop-blur-md shadow-2xl">
            <CardContent className="pt-6">
              {step === "email" ? (
                <Form {...emailForm}>
                  <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                    <FormField
                      control={emailForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sidebar-foreground/80 text-xs uppercase tracking-wider">
                            Email Address
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground/40" />
                              <Input
                                placeholder="name@legendboats.com"
                                className="pl-10 bg-sidebar/60 border-sidebar-border text-white placeholder:text-sidebar-foreground/25 focus-visible:ring-primary focus-visible:border-primary"
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
                      {requestMagicLink.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
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
                          <FormLabel className="text-sidebar-foreground/80 text-xs uppercase tracking-wider">
                            Login Token
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-sidebar-foreground/40" />
                              <Input
                                placeholder="Paste your token here"
                                className="pl-10 bg-sidebar/60 border-sidebar-border text-white placeholder:text-sidebar-foreground/25 focus-visible:ring-primary focus-visible:border-primary font-mono tracking-wider"
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
                        {verifyMagicLink.isPending && (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        )}
                        Verify &amp; Log In
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-sidebar-foreground/50 hover:text-white hover:bg-sidebar-accent text-sm"
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

          <p className="text-center text-sidebar-foreground/30 text-xs mt-6">
            No account? Ask your manager to invite you.
          </p>
        </div>
      </div>
    </div>
  );
}
