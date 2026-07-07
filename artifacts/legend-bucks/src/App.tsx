import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/layout/Shell';

import Home from '@/pages/index';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Employees from '@/pages/employees';
import EmployeeDetail from '@/pages/employee-detail';
import InviteEmployee from '@/pages/invite-employee';
import Rewards from '@/pages/rewards';
import RewardDetail from '@/pages/reward-detail';
import ManageRewards from '@/pages/manage-rewards';
import ManageOrg from '@/pages/manage-org';
import SendBucks from '@/pages/send-bucks';
import Transactions from '@/pages/transactions';
import Redemptions from '@/pages/redemptions';
import Goals from '@/pages/goals';
import Budgets from '@/pages/budgets';
import Settings from '@/pages/settings';
import Help from '@/pages/help';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-4xl font-display font-bold text-foreground">404</h1>
      <p className="mt-2 text-muted-foreground">Page not found</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      <Route path="/" nest>
        <Shell>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/employees/manage" component={ManageOrg} />
            <Route path="/employees/new" component={InviteEmployee} />
            <Route path="/employees/:id" component={EmployeeDetail} />
            <Route path="/employees" component={Employees} />
            <Route path="/rewards/manage" component={ManageRewards} />
            <Route path="/rewards/:id" component={RewardDetail} />
            <Route path="/rewards" component={Rewards} />
            <Route path="/send" component={SendBucks} />
            <Route path="/transactions" component={Transactions} />
            <Route path="/redemptions" component={Redemptions} />
            <Route path="/goals" component={Goals} />
            <Route path="/budgets" component={Budgets} />
            <Route path="/settings" component={Settings} />
            <Route path="/help" component={Help} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
