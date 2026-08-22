export type WheelDeskRole = "user" | "admin";

export function normalizeWheelDeskRole(value: unknown): WheelDeskRole {
  return value === "admin" ? "admin" : "user";
}

export function isWheelDeskAdmin(value: unknown): boolean {
  return normalizeWheelDeskRole(value) === "admin";
}

export function wheelDeskRoleLabel(value: unknown): string {
  return isWheelDeskAdmin(value) ? "Admin" : "User";
}
