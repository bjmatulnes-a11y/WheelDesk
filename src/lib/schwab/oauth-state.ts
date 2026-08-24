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

export function createSchwabOAuthState(userId: string) {
  if (!userId) throw new Error("Missing WheelDesk user id for Schwab OAuth state.");
  const encodedUser = Buffer.from(userId, "utf8").toString("base64url");
  const payload = `${Date.now()}.${randomBytes(24).toString("base64url")}.${encodedUser}`;
  return `${payload}.${signature(payload)}`;
}

export function verifySchwabOAuthState(state: string | null): { userId: string } | null {
  if (!state) return null;

  const parts = state.split(".");
  if (parts.length !== 4) return null;

  const [timestampText, nonce, encodedUser, receivedSignature] = parts;
  if (!timestampText || !nonce || !encodedUser || !receivedSignature) return null;

  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) return null;

  const age = Date.now() - timestamp;
  if (age < -60_000 || age > MAX_STATE_AGE_MS) return null;

  const payload = `${timestampText}.${nonce}.${encodedUser}`;
  const expectedSignature = signature(payload);

  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  try {
    const userId = Buffer.from(encodedUser, "base64url").toString("utf8").trim();
    return userId ? { userId } : null;
  } catch {
    return null;
  }
}
