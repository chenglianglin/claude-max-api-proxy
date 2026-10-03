/** True only for explicit on-values. "0" and "false" stay off. */
export function isDebugEnabled(
  value: string | undefined = process.env.DEBUG
): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}
