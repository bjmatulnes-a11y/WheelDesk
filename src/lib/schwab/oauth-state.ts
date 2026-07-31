import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MAX_STATE_AGE_MS = 15 * 60 * 1000;

function secret() {
  const value = process.env.SCHWAB_CLIENT_SECRET?.trim();
  if (!value) throw new Error("Missing SCHWAB_CLIENT_SECRET");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSchwabOAuthState() {
  const payload = `${Date.now()}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload)}`;
}

export function verifySchwabOAuthState(state: string | null) {
  if (!state) return false;

  const parts = state.split(".");
  if (parts.length !== 3) return false;

  const [timestampText, nonce, receivedSignature] = parts;
  if (!timestampText || !nonce || !receivedSignature) return false;

  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) return false;

  const age = Date.now() - timestamp;
  if (age < -60_000 || age > MAX_STATE_AGE_MS) return false;

  const payload = `${timestampText}.${nonce}`;
  const expectedSignature = signature(payload);

  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);

  return received.length === expected.length && timingSafeEqual(received, expected);
}
