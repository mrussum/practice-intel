import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Alert({ className, variant = "default", ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }) {
  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        variant === "destructive" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
