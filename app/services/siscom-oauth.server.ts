/**
 * OAuth2 client_credentials (Syscom) con caché en memoria.
 * Sin secretos en código: SISCOM_CLIENT_ID y SISCOM_CLIENT_SECRET vía entorno.
 */

const DEFAULT_OAUTH_URL = "https://developers.syscom.mx/oauth/token";
/** Margen de seguridad antes de exp (seg) */
const EXPIRY_BUFFER_MS = 120_000;

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let cache: TokenCache | null = null;

export function isSiscomTokenConfigured(): boolean {
  const id = process.env.SISCOM_CLIENT_ID;
  const secret = process.env.SISCOM_CLIENT_SECRET;
  return Boolean(id && secret);
}

export function invalidateTokenCache(): void {
  cache = null;
}

/**
 * Resuelve la URL de token. Si pones SISCOM_OAUTH_TOKEN_URL completo con
 * ?client_id=..., se usa tal cual; si no, solo POST con JSON.
 */
function tokenEndpointUrl(): string {
  return process.env.SISCOM_OAUTH_TOKEN_URL?.trim() || DEFAULT_OAUTH_URL;
}

type OAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

export async function getSiscomBearer(): Promise<string> {
  if (!isSiscomTokenConfigured()) {
    throw new Error("SISCOM_CLIENT_ID o SISCOM_CLIENT_SECRET faltan");
  }

  const now = Date.now();
  if (
    cache &&
    cache.expiresAtMs - EXPIRY_BUFFER_MS > now
  ) {
    return cache.accessToken;
  }

  const clientId = process.env.SISCOM_CLIENT_ID as string;
  const clientSecret = process.env.SISCOM_CLIENT_SECRET as string;

  const res = await fetch(tokenEndpointUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const raw = await res.text();
  let json: OAuthTokenResponse;
  try {
    json = JSON.parse(raw) as OAuthTokenResponse;
  } catch {
    throw new Error(
      `Token Syscom: respuesta no JSON (${res.status}): ${raw.slice(0, 200)}`,
    );
  }

  if (!res.ok || !json.access_token) {
    throw new Error(
      `Token Syscom: ${res.status} — ${(json as { error?: string; error_description?: string }).error ?? raw.slice(0, 300)}`,
    );
  }

  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const expiresAtMs = now + expiresInSec * 1000;

  cache = {
    accessToken: json.access_token,
    expiresAtMs,
  };
  return cache.accessToken;
}
