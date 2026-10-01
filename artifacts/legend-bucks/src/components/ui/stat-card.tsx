import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type Tint = "blue" | "green" | "amber" | "rose" | "slate";

const accentMap: Record<Tint, string> = {
  blue: "bg-primary",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

const tintMap: Record<Tint, string> = {
  blue: "bg-primary/10 text-primary",
  green: "bg-emerald-500/10 text-emerald-700",
  amber: "bg-amber-500/10 text-amber-700",
  rose: "bg-rose-500/10 text-rose-600",
  slate: "bg-slate-500/10 text-slate-600",
};

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tint?: Tint;
  /** Optional small breakdown rows shown under the value */
  rows?: { label: string; value: React.ReactNode }[];
  footer?: React.ReactNode;
}

/**
 * Events HQ summary card: a label, a large value, optional breakdown rows,
 * and a small tinted circular icon anchored in the top-right corner.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tint = "blue",
  rows,
  footer,
  className,
  ...props
}: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden p-6 sm:p-7", className)} {...props}>
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", accentMap[tint])} />
      {Icon && (
        <div
          className={cn(
            "absolute top-6 right-6 flex h-11 w-11 items-center justify-center rounded-2xl",
            tintMap[tint],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="eyebrow pr-14">{label}</p>
      <div className="mt-3 text-3xl sm:text-4xl font-display break-words font-bold text-foreground leading-none">
        {value}
      </div>
      {rows && rows.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="mt-3 text-sm">{footer}</div>}
    </Card>
  );
}
