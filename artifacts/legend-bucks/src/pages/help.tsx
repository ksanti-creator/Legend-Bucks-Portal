import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle,
  Loader2,
  User,
  ShieldCheck,
  Briefcase,
  Calculator,
} from "lucide-react";

type Role = "team_member" | "manager" | "admin" | "accounting_admin";

type Flow = {
  title: string;
  summary: string;
  steps: string[];
};

/**
 * Help content is scoped per role. A viewer only ever sees the flows for their
 * own role — in particular, team-member flows are visible to team members only.
 */
const FLOWS: Record<Role, Flow[]> = {
  team_member: [
    {
      title: "Check your balance",
      summary: "See how many Legend Bucks you currently have.",
      steps: [
        "Your current balance is always shown in the top-right of every page.",
        "Open the Dashboard for a fuller picture, including recent activity.",
      ],
    },
    {
      title: "Browse and redeem rewards",
      summary: "Spend your bucks on rewards from the catalog.",
      steps: [
        "Go to Rewards in the sidebar to see everything available.",
        "Open a reward to view its cost and details.",
        "Click Redeem — the buck cost is deducted from your balance right away.",
        "Your request is sent to an admin for approval and fulfilment.",
      ],
    },
    {
      title: "Track a redemption",
      summary: "Follow a reward request from approval to delivery.",
      steps: [
        "Open the reward you redeemed, or check your Ledger for the entry.",
        "A redemption moves through pending → approved → fulfilled (or rejected).",
        "If enabled, you'll get an email at each status change.",
      ],
    },
    {
      title: "Contribute to a team goal",
      summary: "Chip in bucks toward a shared team goal.",
      steps: [
        "Go to Goals to see active team goals and their progress.",
        "Open a goal and enter the amount of bucks you want to contribute.",
        "Your contribution is deducted from your balance and added to the goal.",
      ],
    },
    {
      title: "Review your ledger",
      summary: "See every buck you've received or spent.",
      steps: [
        "Open Ledger in the sidebar.",
        "You'll see bucks received, redemptions, and goal contributions tied to you.",
      ],
    },
    {
      title: "Manage email notifications",
      summary: "Turn off emails you don't want.",
      steps: [
        "Go to Settings → Email Notifications.",
        "Toggle off any notification you'd rather not receive.",
        "Critical emails like login links are always sent.",
      ],
    },
  ],
  manager: [
    {
      title: "Send bucks to recognize someone",
      summary: "Reward a team member for great work.",
      steps: [
        "Open Send Bucks in the sidebar.",
        "Pick a team member (you can't send bucks to yourself), enter an amount, and add a note.",
        "Send — the recipient is recognized right away.",
      ],
    },
    {
      title: "Per-person yearly award caps",
      summary: "Some team members have a yearly limit on what you can award them.",
      steps: [
        "An admin may set a yearly cap on how much you can award a specific person.",
        "If a person has a cap, Send Bucks shows how much you have left for them this year.",
        "Awards are blocked once you'd exceed their remaining cap. Caps reset each calendar year.",
        "People without a cap have no limit.",
      ],
    },
    {
      title: "Browse the team directory",
      summary: "Look up people and their departments.",
      steps: [
        "Open Team Directory to search employees.",
        "Open a person to see their profile and recent activity.",
      ],
    },
    {
      title: "Support team goals",
      summary: "Track and contribute to shared goals.",
      steps: [
        "Open Goals to view progress on active team goals.",
        "Contribute bucks from your own balance to any goal.",
      ],
    },
    {
      title: "Review the ledger",
      summary: "Audit awards and activity.",
      steps: [
        "Open Ledger to see transactions across the team.",
        "Filter by person or type to find a specific award.",
      ],
    },
  ],
  admin: [
    {
      title: "Invite a new employee",
      summary: "Add someone to Legend Bucks.",
      steps: [
        "Open Team Directory → Invite (or Employees → New).",
        "Enter their details and assign a role, department, and location.",
        "They receive an email invite and become active on first login.",
      ],
    },
    {
      title: "Manage departments and locations",
      summary: "Keep the org structure tidy.",
      steps: [
        "Open Departments to add, rename, or remove departments and locations.",
        "You can't delete one that still has employees assigned — reassign them first.",
      ],
    },
    {
      title: "Manage the rewards catalog",
      summary: "Control what people can redeem.",
      steps: [
        "Open Rewards → Manage.",
        "Create or edit rewards, set their buck cost, and enable or disable them.",
      ],
    },
    {
      title: "Set a per-person award cap",
      summary: "Limit how much a person's manager can award them each year.",
      steps: [
        "Open a team member's profile (or the invite form) and set their Yearly Award Cap.",
        "Their manager can then award them up to that amount per calendar year.",
        "Leave it blank for no limit. Caps reset at the start of each calendar year.",
      ],
    },
    {
      title: "Review and fulfil redemptions",
      summary: "Process reward requests from employees.",
      steps: [
        "Open Redemptions to see pending requests.",
        "Approve or reject each one, then mark approved rewards as fulfilled.",
        "Employees are emailed at each step (if they haven't opted out).",
      ],
    },
    {
      title: "Send bucks",
      summary: "Award bucks directly, with no cap.",
      steps: [
        "Open Send Bucks, pick a recipient (not yourself), and enter an amount.",
        "Admin awards are not limited by per-person caps.",
      ],
    },
    {
      title: "Export transactions",
      summary: "Pull the ledger for accounting.",
      steps: [
        "Open Ledger and use the export option to download a CSV.",
        "Accounting-only values (like CAD cost) are visible to admins only.",
      ],
    },
  ],
  accounting_admin: [
    {
      title: "Review the full ledger",
      summary: "See every transaction across the organization.",
      steps: [
        "Open Ledger in the sidebar.",
        "Switch the view to All Organization to see everyone's transactions.",
        "Filter by type to focus on awards, redemptions, or refunds.",
      ],
    },
    {
      title: "Export the ledger for accounting",
      summary: "Download a CSV of transactions for reconciliation.",
      steps: [
        "Open Ledger and click Export CSV.",
        "The file downloads with all transaction detail for the period.",
      ],
    },
    {
      title: "See dollar (CAD) cost values",
      summary: "View the real-money cost behind bucks activity.",
      steps: [
        "CAD values appear on the Ledger and on Redemptions.",
        "Use these accounting-only figures to reconcile program spend.",
      ],
    },
    {
      title: "Review redemptions (read-only)",
      summary: "See reward requests and their cost, without processing them.",
      steps: [
        "Open Redemptions to view all reward requests and their status.",
        "Approving, rejecting, and fulfilling are handled by admins — you have view-only access.",
      ],
    },
  ],
};

const ROLE_META: Record<
  Role,
  { label: string; icon: typeof User; blurb: string }
> = {
  team_member: {
    label: "Team Member",
    icon: User,
    blurb: "Earn, spend, and track your Legend Bucks.",
  },
  manager: {
    label: "Manager",
    icon: Briefcase,
    blurb: "Recognize your team and celebrate great work.",
  },
  admin: {
    label: "Admin",
    icon: ShieldCheck,
    blurb: "Run the program end to end.",
  },
  accounting_admin: {
    label: "Accounting Admin",
    icon: Calculator,
    blurb: "View and export the ledger and cost reports — read-only.",
  },
};

export default function Help() {
  const { data: user, isLoading } = useGetMe();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const role = user.role as Role;
  const flows = FLOWS[role] ?? [];
  const meta = ROLE_META[role];
  const RoleIcon = meta?.icon ?? User;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500 py-2">
      <div className="text-center mb-2">
        <div className="inline-flex items-center justify-center p-4 bg-primary/10 text-primary rounded-full mb-4">
          <HelpCircle className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Help &amp; How-To</h1>
        <p className="text-muted-foreground mt-2">
          Step-by-step guides for the things you can do in Legend Bucks.
        </p>
      </div>

      <Card className="border-none shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-muted p-2 rounded-full">
              <RoleIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Your guides
                <Badge variant="secondary" className="capitalize">
                  {meta?.label ?? role.replace("_", " ")}
                </Badge>
              </CardTitle>
              <CardDescription>{meta?.blurb}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {flows.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              {flows.map((flow, i) => (
                <AccordionItem key={flow.title} value={`item-${i}`}>
                  <AccordionTrigger className="text-left">
                    <span className="font-semibold">{flow.title}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-muted-foreground mb-3">{flow.summary}</p>
                    <ol className="list-decimal list-inside space-y-2 text-sm">
                      {flow.steps.map((step, s) => (
                        <li key={s} className="leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <p className="text-muted-foreground text-sm">No guides available.</p>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Still stuck? Reach out to your program admin for help.
      </p>
    </div>
  );
}
