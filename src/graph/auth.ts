/**
 * Auth Microsoft Graph — OAuth client_credentials (app daemon).
 * Token mis en cache jusqu'à ~1 min avant expiration. Pas de MSAL : fetch direct.
 */
import { graphConfig } from "../config.js";

let token: { value: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;

  const cfg = graphConfig();
  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

/** Helper fetch authentifié vers Graph (chemin relatif à /v1.0 ou URL absolue). */
export async function graphFetch(
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  const t = await getGraphToken();
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${t}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
