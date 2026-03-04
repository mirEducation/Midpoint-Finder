/**
 * Lightweight class name utility. Filters falsy values and joins the rest.
 * Sufficient for components that don't generate conflicting Tailwind classes.
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}
