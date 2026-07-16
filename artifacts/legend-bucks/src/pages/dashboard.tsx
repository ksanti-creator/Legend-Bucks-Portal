import { useGetMe, useGetDashboardSummary, useGetRecentActivity, useGetLeaderboard, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, getInitials } from "@/lib/utils";
import { Trophy, TrendingUp, Users, Target, Activity, ArrowUpRight, Gift, Coins, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: user } = useGetMe();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      enabled: user?.role === "admin" || user?.role === "manager"
    }
  });
  
  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity({ limit: 10 });
  const { data: leaderboard, isLoading: isLoadingLeaderboard } = useGetLeaderboard({ limit: 5 });

  const isAdminOrManager = user?.role === "admin" || user?.role === "manager";

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Welcome & Balance Hero */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Welcome back, {user?.firstName}
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's happening on the floor today.
          </p>
        </div>
        
        <Card className="bg-primary text-primary-foreground border-none shadow-lg shrink-0 w-full md:w-auto relative overflow-hidden">
          <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/4"></div>
          <CardContent className="p-6 flex flex-wrap items-center gap-x-6 gap-y-4 relative z-10">
            <div className="bg-primary-foreground/20 p-4 rounded-xl">
              <Coins className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-primary-foreground/80 font-medium text-sm uppercase tracking-wider mb-1">Your Balance</p>
              <div className="text-4xl font-display font-bold">
                {user?.balance?.toLocaleString()} <span className="text-xl text-primary-foreground/70">LB</span>
              </div>
            </div>
            <div className="sm:ml-4 sm:pl-6 sm:border-l border-primary-foreground/20">
              <Button variant="secondary" className="bg-white text-primary hover:bg-white/90 font-bold" asChild>
                <Link href="/rewards">
                  Redeem
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin/Manager Stats */}
      {isAdminOrManager && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Employees"
            icon={Users}
            tint="blue"
            value={isLoadingSummary ? <Skeleton className="h-8 w-16" /> : summary?.totalEmployees}
          />
          <StatCard
            label="Bucks Awarded (Month)"
            icon={Trophy}
            tint="green"
            value={isLoadingSummary ? <Skeleton className="h-8 w-24" /> : (summary?.thisMonthBucksAwarded?.toLocaleString() || 0)}
          />
          <StatCard
            label="Pending Approvals"
            icon={Activity}
            tint="amber"
            value={isLoadingSummary ? <Skeleton className="h-8 w-12" /> : summary?.pendingApprovals}
          />
          <StatCard
            label="Active Goals"
            icon={Target}
            tint="slate"
            value={isLoadingSummary ? <Skeleton className="h-8 w-12" /> : summary?.activeGoals}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Activity Feed */}
        <Card className="lg:col-span-2 flex flex-col h-[500px]">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-primary" />
                Recent Activity
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {isLoadingActivity ? (
              <div className="p-6 space-y-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex gap-4 items-center">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="divide-y divide-border">
                {activity.map((item) => (
                  <div key={item.id} className="p-6 flex items-start gap-4 hover:bg-muted/10 transition-colors">
                    <div className="bg-muted p-2 rounded-full shrink-0">
                      {item.type === 'award' ? <Trophy className="h-5 w-5 text-accent" /> :
                       item.type === 'redemption' ? <Gift className="h-5 w-5 text-primary" /> :
                       item.type === 'goal_contribution' ? <Target className="h-5 w-5 text-green-600" /> :
                       <Activity className="h-5 w-5 text-muted-foreground" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-relaxed">
                        {item.actorName && <span className="font-semibold">{item.actorName}</span>}
                        {item.actorName && item.targetName ? ' ' : ''}
                        {item.description}
                        {item.targetName && <span className="font-semibold"> {item.targetName}</span>}
                        {item.amount && <span className="font-bold text-accent ml-1">({item.amount} LB)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <Activity className="h-12 w-12 opacity-20 mb-4" />
                <p>No recent activity.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leaderboard */}
        <Card className="flex flex-col h-[500px]">
          <CardHeader className="border-b bg-muted/20 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="h-5 w-5 text-accent" />
              Top Earners
            </CardTitle>
            <CardDescription>This month's leaders</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-0">
            {isLoadingLeaderboard ? (
              <div className="p-6 space-y-4">
                {[1,2,3].map(i => (
                  <div key={i} className="flex gap-4 items-center">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : leaderboard && leaderboard.length > 0 ? (
              <div className="divide-y divide-border">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.employeeId} className="p-4 flex items-center gap-4 hover:bg-muted/10 transition-colors">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0
                      ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : 
                        idx === 1 ? 'bg-gray-200 text-gray-700' : 
                        idx === 2 ? 'bg-orange-100 text-orange-800' : 'bg-muted text-muted-foreground'}`}>
                      #{entry.rank}
                    </div>
                    <Avatar className="h-10 w-10 border">
                      <AvatarFallback>{getInitials(entry.employeeName.split(' ')[0], entry.employeeName.split(' ')[1] || '')}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{entry.employeeName}</p>
                      {entry.department && <p className="text-xs text-muted-foreground truncate">{entry.department}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-primary">{entry.bucksReceived}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">LB</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center h-full">
                <Trophy className="h-12 w-12 opacity-20 mb-4" />
                <p>Leaderboard is empty for this month.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
