// Compatibility shim for the v3.2 API-seed patch packaging error.
// The real Schwab client lives in ./schwab/client.
// This file can be deleted once all deployments are clean.
export * from "./schwab/client";
