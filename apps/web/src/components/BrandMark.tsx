import { cn } from "../lib/cn";

/** The "CI" monogram used in the header and on the login screen. Decorative. */
export function BrandMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold tracking-tight shadow-sm",
        inverted ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-gradient-to-br from-indigo-600 to-sky-600 text-white",
        className,
      )}
    >
      CI
    </span>
  );
}
