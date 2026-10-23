export type JsonRecord = Record<string, unknown>;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * Convert an application payload into strict JSON before handing it to fetch.
 * This prevents BigInt / NaN / Infinity / undefined values from turning an
 * otherwise valid Shadow/Execution entry into an opaque JSON serialization error.
 */
export function stringifyJsonBody(value: unknown): string {
  const seen = new WeakSet<object>();
  const safe = toJsonValue(value, seen, "$root");
  return JSON.stringify(safe);
}

/**
 * Parse an API response without assuming Vercel/Next always returned JSON.
 * When the route returns HTML/plain text (proxy error, deployment error, etc.),
 * callers get the real HTTP status/body preview instead of "Unexpected token <".
 */
export async function readJsonResponse<T extends JsonRecord = JsonRecord>(
  response: Response,
  fallbackLabel: string,
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) {
      throw new Error(`${fallbackLabel} failed (${response.status} ${response.statusText || "HTTP error"}) with an empty response.`);
    }
    throw new Error(`${fallbackLabel} returned an empty response.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = compactPreview(text);
    throw new Error(
      `${fallbackLabel} returned a non-JSON response (${response.status} ${response.statusText || "HTTP"})${preview ? `: ${preview}` : "."}`,
    );
  }
}

function toJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
): JsonValue {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value as string | boolean;
  if (kind === "number") return Number.isFinite(value as number) ? (value as number) : null;
  if (kind === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : String(value);
  }
  if (kind === "undefined" || kind === "function" || kind === "symbol") return null;

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`Cannot serialize JSON request: circular reference at ${path}.`);
    seen.add(value);
    const output = value.map((item, index) => toJsonValue(item, seen, `${path}[${index}]`));
    seen.delete(value);
    return output;
  }

  if (kind === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error(`Cannot serialize JSON request: circular reference at ${path}.`);
    seen.add(object);
    const output: { [key: string]: JsonValue } = {};
    for (const [key, child] of Object.entries(object)) {
      const childKind = typeof child;
      if (childKind === "undefined" || childKind === "function" || childKind === "symbol") continue;
      output[key] = toJsonValue(child, seen, `${path}.${key}`);
    }
    seen.delete(object);
    return output;
  }

  return null;
}

function compactPreview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 220 ? `${compact.slice(0, 220)}…` : compact;
}
