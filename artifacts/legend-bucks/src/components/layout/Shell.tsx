import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { 
  LayoutDashboard, 
  Users, 
  Gift, 
  ArrowRightLeft, 
  Target, 
  PieChart, 
  LogOut,
  Settings,
  Send,
  Loader2,
  Ship
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

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/rewards", label: "Rewards", icon: Gift },
    { href: "/employees", label: "Team Directory", icon: Users },
    { href: "/transactions", label: "Ledger", icon: ArrowRightLeft },
    { href: "/goals", label: "Goals", icon: Target },
  ];

  if (user.role === "admin" || user.role === "manager") {
    navItems.splice(1, 0, { href: "/send", label: "Send Bucks", icon: Send });
    navItems.push({ href: "/budgets", label: "Budgets", icon: PieChart });
  }

  if (user.role === "admin") {
    navItems.push({ href: "/redemptions", label: "Redemptions", icon: Ship });
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col z-40">
        <div className="p-5 pb-4 border-b border-sidebar-border">
          <img
            src="/logos/legend-bucks-rewards.png"
            alt="Legend Bucks Rewards"
            className="h-10 w-auto brightness-0 invert"
          />
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-4 px-2">
            <Avatar className="h-9 w-9 border-sidebar-accent border-2">
              <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
                {getInitials(user.firstName, user.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="w-full bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="w-full bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 pl-64 flex flex-col min-h-screen">
        <header className="h-16 border-b border-border bg-background flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="font-medium text-muted-foreground flex items-center">
            {navItems.find(item => location.startsWith(item.href))?.label || "Legend Bucks"}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">My Balance</p>
              <p className="font-display font-bold text-lg leading-none text-primary">
                LB {user.balance?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </header>
        <div className="flex-1 p-8 overflow-y-auto relative">
          <div className="fixed inset-0 pointer-events-none opacity-[0.03] mix-blend-multiply bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNmZmYiLz48cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSIjMDAwIi8+PC9zdmc+')] z-[-1]" />
          {children}
        </div>
      </main>
    </div>
  );
}
