import { PortfolioLeg } from "./portfolio-coverage-engine";

type AnyPosition = Record<string, any>;

function normalizeTicker(ticker: unknown): string {
  return String(ticker ?? "").trim().toUpperCase();
}

function normalizeOptionType(value: unknown): "call" | "put" | null {
  const raw = String(value ?? "").toLowerCase();

  if (raw === "call" || raw === "c" || raw.includes("call")) return "call";
  if (raw === "put" || raw === "p" || raw.includes("put")) return "put";

  return null;
}

function normalizeSide(value: unknown): "long" | "short" | null {
  const raw = String(value ?? "").toLowerCase();

  if (raw === "long" || raw === "buy" || raw === "bought") return "long";
  if (raw === "short" || raw === "sell" || raw === "sold") return "short";

  return null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function positionToPortfolioLeg(position: AnyPosition): PortfolioLeg | null {
  const ticker = normalizeTicker(position.ticker ?? position.symbol ?? position.underlying);
  if (!ticker) return null;

  const rawType = String(position.type ?? position.instrumentType ?? position.assetType ?? "").toLowerCase();

  if (rawType.includes("share") || rawType.includes("stock") || rawType === "equity") {
    return {
      id: String(position.id ?? `${ticker}-shares`),
      ticker,
      type: "shares",
      quantity: toNumber(position.quantity ?? position.qty ?? position.shares)
    };
  }

  const optionType = normalizeOptionType(
    position.optionType ?? position.right ?? position.contractType ?? position.type
  );

  const side = normalizeSide(position.side ?? position.positionSide ?? position.direction);

  if (!optionType || !side) return null;

  const type =
    side === "long" && optionType === "call"
      ? "long_call"
      : side === "short" && optionType === "call"
        ? "short_call"
        : side === "long" && optionType === "put"
          ? "long_put"
          : "short_put";

  return {
    id: String(
      position.id ??
        `${ticker}-${position.expiration ?? "no-exp"}-${position.strike ?? "no-strike"}-${type}`
    ),
    ticker,
    type,
    quantity: Math.abs(toNumber(position.quantity ?? position.qty ?? position.contracts)),
    strike: position.strike != null ? toNumber(position.strike) : undefined,
    expiration: position.expiration ?? position.expiry ?? undefined,
    premium: position.premium != null ? toNumber(position.premium) : undefined,
    groupId: position.groupId ?? position.spreadId ?? undefined,
    coverageType: position.coverageType ?? undefined
  };
}

export function positionsToPortfolioLegs(positions: AnyPosition[]): PortfolioLeg[] {
  return positions
    .map(positionToPortfolioLeg)
    .filter((leg): leg is PortfolioLeg => leg != null);
}