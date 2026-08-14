import { describe, expect, it } from "vitest";
import {
  authResponseDestination,
  oauthAuthorizeUrl,
  signedOAuthQuery,
  withOAuthQuery,
} from "./oauthFlow";

const signedQuery =
  "client_id=agent-client&redirect_uri=https%3A%2F%2Fagent.example%2Fcallback&state=state-123&exp=1234&sig=signed-value";

describe("OAuth authentication flow", () => {
  it("preserves the signed authorization query for Google sign-in", () => {
    expect(
      withOAuthQuery(
        { provider: "google", callbackURL: "https://libretto.sh/signin" },
        `?${signedQuery}`,
      ),
    ).toEqual({
      provider: "google",
      callbackURL: "https://libretto.sh/signin",
      oauth_query: signedQuery,
    });
  });

  it("preserves the signed authorization query for GitHub sign-in", () => {
    expect(
      withOAuthQuery(
        { provider: "github", callbackURL: "https://libretto.sh/signin" },
        `?${signedQuery}`,
      ),
    ).toEqual({
      provider: "github",
      callbackURL: "https://libretto.sh/signin",
      oauth_query: signedQuery,
    });
  });

  it("preserves the same query for email sign-in", () => {
    expect(
      withOAuthQuery(
        { email: "user@example.com", password: "secret" },
        `?${signedQuery}`,
      ),
    ).toMatchObject({ oauth_query: signedQuery });
  });

  it("does not forward unsigned parameters after the signature", () => {
    expect(signedOAuthQuery(`?${signedQuery}&admin=true`)).toBe(signedQuery);
  });

  it("resumes authorization for an existing session without signature fields", () => {
    expect(oauthAuthorizeUrl("https://api.libretto.sh/", signedQuery)).toBe(
      "https://api.libretto.sh/api/auth/oauth2/authorize?client_id=agent-client&redirect_uri=https%3A%2F%2Fagent.example%2Fcallback&state=state-123",
    );
  });

  it("accepts either Better Auth redirect response field", () => {
    expect(authResponseDestination({ url: "https://accounts.google.com" })).toBe(
      "https://accounts.google.com",
    );
    expect(authResponseDestination({ uri: "https://github.com/login" })).toBe(
      "https://github.com/login",
    );
  });
});
