// Close.io OAuth refresher — D-03 reference implementation.
//
// Why Close as the reference: it's the doctrine's CRM substrate (main §2) and
// its OAuth surface matches RFC 6749 §6 exactly — POST grant_type=refresh_token
// with client credentials, receive { access_token, refresh_token?, expires_in }.
// Once Meta + Stripe ship real refreshers (./stubs.ts), they follow this shape.
//
// Returns null on non-200 so rotateCredential records a 'rotation' high finding
// rather than throwing — operators get a structured signal, not a stack trace.

import type { Refresher } from "@agent-os/vault";

const CLOSE_TOKEN_URL = "https://api.close.com/oauth2/token";

interface CloseTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export const closeRefresher: Refresher = async (refreshToken) => {
  const clientId = process.env.CLOSE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.CLOSE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(CLOSE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const json = (await res.json().catch(() => null)) as CloseTokenResponse | null;
  if (!json?.access_token) return null;

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
};
