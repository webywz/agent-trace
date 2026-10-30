/**
 * Parse a duration budget: plain number = milliseconds; optional `ms` / `s` / `m` suffix.
 * Examples: `5000`, `30s`, `2m`, `1.5s`.
 */
export function parseDurationMs(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("expected a duration (e.g. 5000, 30s, 2m)");
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`invalid duration '${raw}' (expected ms number, or 30s / 2m)`);
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid duration '${raw}'`);
  }
  const unit = (match[2] ?? "ms").toLowerCase();
  let ms: number;
  if (unit === "ms") ms = n;
  else if (unit === "s") ms = n * 1000;
  else ms = n * 60_000;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("duration must be a positive number of milliseconds");
  }
  return Math.round(ms);
}
