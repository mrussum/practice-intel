import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const variants = {
  default: "bg-muted text-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
  met: "bg-met/10 text-met border-met/30",
  partial: "bg-partial/10 text-partial border-partial/30",
  missing: "bg-missing/10 text-missing border-missing/30",
} as const;

export type BadgeVariant = keyof typeof variants;

export function Badge({ className, variant = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", variants[variant], className)}
      {...props}
    />
  );
}
