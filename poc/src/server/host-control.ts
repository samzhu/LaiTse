import { createHash, timingSafeEqual } from "node:crypto";

export const HOST_CONTROL_TOKEN_MIN_BYTES = 32;
export const HOST_CONTROL_TOKEN_MAX_BYTES = 256;
export const MAX_HOST_CLAIMS_PER_WINDOW = 5;
export const HOST_CLAIM_WINDOW_MS = 60_000;

type ClaimDenial = "host_token_invalid" | "host_claim_rate_limited";

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function createHostControlPolicy(hostControlToken?: string) {
  const enabled = Boolean(hostControlToken);
  if (enabled) {
    const byteLength = Buffer.byteLength(hostControlToken!, "utf8");
    if (byteLength < HOST_CONTROL_TOKEN_MIN_BYTES || byteLength > HOST_CONTROL_TOKEN_MAX_BYTES) {
      throw new Error(`HOST_CONTROL_TOKEN must be ${HOST_CONTROL_TOKEN_MIN_BYTES} to ${HOST_CONTROL_TOKEN_MAX_BYTES} UTF-8 bytes.`);
    }
  }

  const expectedDigest = enabled ? tokenDigest(hostControlToken!) : null;
  const claimsByConnection = new WeakMap<object, number[]>();

  return {
    enabled,

    claim(token: unknown, connection: object): ClaimDenial | null {
      if (!enabled || !expectedDigest) return "host_token_invalid";
      const now = Date.now();
      const recentClaims = (claimsByConnection.get(connection) ?? []).filter((claimAt) => now - claimAt < HOST_CLAIM_WINDOW_MS);
      if (recentClaims.length >= MAX_HOST_CLAIMS_PER_WINDOW) {
        claimsByConnection.set(connection, recentClaims);
        return "host_claim_rate_limited";
      }
      recentClaims.push(now);
      claimsByConnection.set(connection, recentClaims);

      if (typeof token !== "string" || Buffer.byteLength(token, "utf8") > HOST_CONTROL_TOKEN_MAX_BYTES) {
        return "host_token_invalid";
      }
      const candidateDigest = tokenDigest(token);
      return timingSafeEqual(candidateDigest, expectedDigest) ? null : "host_token_invalid";
    },
  };
}
