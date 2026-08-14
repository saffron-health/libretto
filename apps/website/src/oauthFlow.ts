export type OAuthAuthResponse = {
  redirect?: boolean;
  url?: string;
  uri?: string;
};

/**
 * Return only the signed portion of a Better Auth OAuth-provider query.
 * Parameters after `sig` are not covered by the signature and must not be
 * forwarded as part of the authorization request.
 */
export function signedOAuthQuery(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("client_id") || !params.has("sig")) return null;

  const signed = new URLSearchParams();
  for (const [key, value] of params) {
    signed.append(key, value);
    if (key === "sig") break;
  }
  return signed.toString();
}

export function withOAuthQuery<T extends Record<string, unknown>>(
  input: T,
  search: string,
): T & { oauth_query?: string } {
  const oauthQuery = signedOAuthQuery(search);
  return oauthQuery ? { ...input, oauth_query: oauthQuery } : input;
}

export function oauthAuthorizeUrl(apiUrl: string, oauthQuery: string): string {
  const params = new URLSearchParams(oauthQuery);
  params.delete("exp");
  params.delete("sig");
  return `${apiUrl.replace(/\/+$/, "")}/api/auth/oauth2/authorize?${params}`;
}

export function authResponseDestination(
  response: OAuthAuthResponse,
  apiUrl: string,
): string | null {
  const destination = response.url ?? response.uri ?? null;
  return destination ? new URL(destination, apiUrl).toString() : null;
}
