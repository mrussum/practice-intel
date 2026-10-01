import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const variants = {
  default: "bg-muted text-foreground border-border",
  primary: "bg-indigo-50 text-indigo-700 border-indigo-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  // For badges on the dark brand header.
  onBrand: "bg-white/15 text-white border-white/25",
  met: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-800 border-amber-200",
  missing: "bg-rose-50 text-rose-700 border-rose-200",
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
