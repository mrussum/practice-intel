/** Joins class names, skipping falsy values (a tiny stand-in for clsx). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
