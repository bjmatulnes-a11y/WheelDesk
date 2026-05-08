import { InstrumentType } from "./portfolio-types";

export function makeOptionQuoteKey(
  symbol: string,
  expiration: string | undefined,
  type: InstrumentType,
  strike: number | undefined
): string {
  if (type !== "call" && type !== "put") return "";
  if (!symbol || !expiration || typeof strike !== "number") return "";

  return [
    symbol.toUpperCase(),
    expiration,
    type,
    strike.toFixed(2)
  ].join("__");
}