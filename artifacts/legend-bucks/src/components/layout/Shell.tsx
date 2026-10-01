import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout, useListMyStores, getListMyStoresQueryKey } from "@workspace/api-client-react";
import { 
  LayoutDashboard, 
  Users, 
  Gift, 
  ArrowRightLeft, 
  Target, 
  LogOut,
  Settings,
  Send,
  Loader2,
  Ship,
  Building2,
  HelpCircle,
  Coins,
  Menu,
  CreditCard,
  ShieldCheck
} from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import { clearSessionToken } from "@/lib/auth-token";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

function SidebarContent({
  navItems,
  location,
  user,
  onNavigate,
  onLogout,
}: {
  navItems: NavItem[];
  location: string;
  user: { firstName: string; lastName: string; role: string };
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar/95 text-sidebar-foreground">
      <div className="px-5 py-6">
        <img
          src="/logos/legend-bucks-rewards.png"
          alt="Legend Bucks Rewards"
          className="h-10 w-auto"
        />
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Main">
        {navItems.map((item, idx) => {
          const prev = navItems[idx - 1];
          const groupOf = (h: string) => h.startsWith("/store-gift-cards") ? 2 : h === "/help" ? 3 : ["/dashboard", "/send", "/rewards"].includes(h) ? 0 : 1;
          const newGroup = !!prev && groupOf(prev.href) !== groupOf(item.href);
          const isActive = location.startsWith(item.href) && !navItems.some((o) => o.href.length > item.href.length && o.href.startsWith(item.href) && location.startsWith(o.href));
          return (
            <div key={item.href}>
            {newGroup && <div aria-hidden="true" className="mx-3 my-3 border-t border-sidebar-border" />}
            <Link 
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive 
                  ? "bg-primary text-primary-foreground font-semibold shadow-[0_6px_16px_-8px_hsl(196_100%_40%/0.6)]" 
                  : "text-sidebar-foreground/85 hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-primary-foreground" : "text-slate-500")} />
              {item.label}
            </Link>
            </div>
          );
        })}
      </nav>

      <div className="p-3 mt-2">
        <div className="rounded-2xl border border-sidebar-border panel-sand p-3">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10 border border-sidebar-border">
              <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                {getInitials(user.firstName, user.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate text-foreground">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-muted-foreground truncate capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="w-full bg-muted/70 border-transparent hover:bg-muted" asChild>
              <Link href="/settings" onClick={onNavigate}>
                <Settings className="h-4 w-4 mr-1.5" />
                Settings
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="w-full bg-card text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={onLogout}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const logout = useLogout();
  // Store checkout link is driven by explicit server-side store grants, not by role.
  const { data: myStores } = useListMyStores({ query: { enabled: !!user, queryKey: getListMyStoresQueryKey() } });
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        clearSessionToken();
        setLocation("/login");
      },
    });
  };

  // The read-only accounting_admin role only sees finance surfaces — the ledger
  // and redemptions (read-only) — never the action-oriented pages.
  let navItems: NavItem[];

  if (user.role === "accounting_admin") {
    navItems = [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/transactions", label: "Ledger", icon: ArrowRightLeft },
      { href: "/redemptions", label: "Redemptions", icon: Ship },
    ];
  } else {
    navItems = [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/rewards", label: "Rewards", icon: Gift },
      { href: "/employees", label: "Team Directory", icon: Users },
      { href: "/transactions", label: "Ledger", icon: ArrowRightLeft },
      { href: "/goals", label: "Goals", icon: Target },
    ];

    if (user.role === "admin" || user.role === "manager") {
      navItems.splice(1, 0, { href: "/send", label: "Send Bucks", icon: Send });
      navItems.push({ href: "/redemptions", label: "Redemptions", icon: Ship });
    }

    if (user.role === "admin") {
      navItems.push({ href: "/employees/manage", label: "Departments", icon: Building2 });
    }
  }

  if (myStores && myStores.length > 0) {
    navItems.push({ href: "/store-gift-cards", label: "Store Gift Cards", icon: CreditCard });
  }
  if (user.role === "admin") {
    navItems.push({ href: "/store-gift-cards/admin", label: "Store Card Admin", icon: ShieldCheck });
  }

  navItems.push({ href: "/help", label: "Help", icon: HelpCircle });

  return (
    <div className="flex min-h-screen app-gradient-bg text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 border-r border-sidebar-border/80 flex-col bg-sidebar/90 backdrop-blur z-40">
        <SidebarContent
          navItems={navItems}
          location={location}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      {/* Main Content */}
      <main className="shell-main relative isolate flex-1 min-w-0 lg:pl-64 flex flex-col min-h-[100dvh]">
        <ShellScenery />
        {import.meta.env.DEV && import.meta.env.VITE_LEGEND_BUCKS_SANDBOX === "true" && (
          <div className="bg-amber-400 px-4 py-2 text-center text-sm font-bold text-amber-950">
            SANDBOX PREVIEW — Dummy data only. Emails and real storage are disabled.
          </div>
        )}
        <header className="h-16 border-b border-border/60 bg-background/75 backdrop-blur-md flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 sticky top-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile nav trigger */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden -ml-1 shrink-0 rounded-xl bg-muted/70 hover:bg-muted"
                  aria-label="Open navigation menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 max-w-[85vw] p-0 border-sidebar-border">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SidebarContent
                  navItems={navItems}
                  location={location}
                  user={user}
                  onNavigate={() => setMobileNavOpen(false)}
                  onLogout={() => {
                    setMobileNavOpen(false);
                    handleLogout();
                  }}
                />
              </SheetContent>
            </Sheet>
            <div className="font-semibold text-foreground truncate">
              {navItems.find(item => location.startsWith(item.href))?.label || "Legend Bucks"}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5 rounded-full border border-primary/25 bg-card/90 card-lift pl-3 pr-4 py-1.5">
              <Coins className="h-4 w-4 text-primary" />
              <div className="leading-tight">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">My Balance</p>
                <p className="font-display font-bold text-sm leading-none text-primary">
                  {user.balance?.toLocaleString() || 0} LB
                </p>
              </div>
            </div>
          </div>
        </header>
        <div className="relative z-10 flex-1 w-full max-w-[1400px] mx-auto p-4 sm:p-6 lg:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}

/** Decorative lakeside edge details for the authenticated canvas. */
function ShellScenery() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none" aria-hidden="true">
      <svg className="cloud-drift-slow absolute right-[6%] top-24 w-28 opacity-80" viewBox="0 0 120 50">
        <path d="M20 44h82a16 16 0 0 0 0-32 22 22 0 0 0-40-6 18 18 0 0 0-30 12A14 14 0 0 0 20 44z" fill="#fff" />
      </svg>
      <svg className="absolute right-[18%] top-40 hidden w-8 opacity-50 md:block" viewBox="0 0 40 16">
        <path d="M2 10 Q10 2 20 10 Q30 2 38 10" fill="none" stroke="#5B7480" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <svg className="fixed bottom-0 right-0 hidden h-24 w-[min(46rem,60vw)] opacity-40 md:block" viewBox="0 0 720 100" preserveAspectRatio="none">
        <path d="M0 100 L0 80 L30 50 L55 78 L90 36 L125 78 L160 54 L195 80 L240 30 L280 78 L320 56 L360 82 L410 40 L450 80 L500 58 L540 82 L590 34 L630 80 L680 52 L720 72 V100Z" fill="#AFCFC9" />
        <rect y="92" width="720" height="8" fill="#BEE5F3" />
      </svg>
    </div>
  );
}
