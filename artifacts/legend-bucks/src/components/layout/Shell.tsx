import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
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
  Coins
} from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import { clearSessionToken } from "@/lib/auth-token";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Shell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const logout = useLogout();
  const [location, setLocation] = useLocation();

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
  let navItems: { href: string; label: string; icon: typeof LayoutDashboard }[];

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
    }

    if (user.role === "admin") {
      navItems.push({ href: "/redemptions", label: "Redemptions", icon: Ship });
      navItems.push({ href: "/employees/manage", label: "Departments", icon: Building2 });
    }
  }

  navItems.push({ href: "/help", label: "Help", icon: HelpCircle });

  return (
    <div className="flex min-h-screen app-gradient-bg text-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col z-40">
        <div className="px-5 py-6">
          <img
            src="/logos/legend-bucks-rewards.png"
            alt="Legend Bucks Rewards"
            className="h-10 w-auto"
          />
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm font-medium",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-sidebar-primary")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 mt-2">
          <div className="rounded-2xl border border-sidebar-border bg-secondary/50 p-3">
            <div className="flex items-center gap-3 mb-3">
              <Avatar className="h-10 w-10 border border-sidebar-border">
                <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                  {getInitials(user.firstName, user.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-muted-foreground truncate capitalize">{user.role.replace('_', ' ')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="w-full bg-card" asChild>
                <Link href="/settings">
                  <Settings className="h-4 w-4 mr-1.5" />
                  Settings
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full bg-card text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-1.5" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pl-64 flex flex-col min-h-screen">
        <header className="h-16 border-b border-border/70 bg-background/70 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-20">
          <div className="font-semibold text-foreground flex items-center">
            {navItems.find(item => location.startsWith(item.href))?.label || "Legend Bucks"}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 rounded-full bg-primary/10 pl-3 pr-4 py-1.5">
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
        <div className="flex-1 p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
