import { PortfolioProfile } from "./portfolio-types";

const STORAGE_KEY = "wheeldesk_portfolio_profiles_v1";

const starterProfile: PortfolioProfile = {
  id: "profile-default",
  name: "Default Profile",
  positions: [],
  slices: [],
  updatedAt: new Date().toISOString()
};

function readProfiles(): PortfolioProfile[] {
  if (typeof window === "undefined") return [starterProfile];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [starterProfile];
    const parsed = JSON.parse(raw) as PortfolioProfile[];
    return parsed.length ? parsed : [starterProfile];
  } catch {
    return [starterProfile];
  }
}

function writeProfiles(profiles: PortfolioProfile[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function listPortfolioProfiles(): PortfolioProfile[] {
  return readProfiles();
}

export function upsertPortfolioProfile(profile: PortfolioProfile): PortfolioProfile[] {
  const existing = readProfiles().filter((p) => p.id !== profile.id);
  const next = [...existing, { ...profile, updatedAt: new Date().toISOString() }].sort((a, b) => a.name.localeCompare(b.name));
  writeProfiles(next);
  return next;
}

export function deletePortfolioProfile(profileId: string): PortfolioProfile[] {
  const next = readProfiles().filter((p) => p.id !== profileId);
  const safe = next.length ? next : [starterProfile];
  writeProfiles(safe);
  return safe;
}

