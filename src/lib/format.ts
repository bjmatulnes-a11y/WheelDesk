export function safeFixed(value: unknown, digits = 2, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

export function safeInt(value: unknown, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : fallback;
}

export function safeMoney(value: unknown, digits = 2, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(digits)}` : fallback;
}

export function safePct(value: unknown, digits = 1, fallback = "N/A"): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : fallback;
}