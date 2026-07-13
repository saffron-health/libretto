import { expect, test } from "vitest";
import {
	DomainPolicyRestricted,
	isUrlAllowed,
} from "./domain-policy.js";

test("domain policy allows every URL when no lists are configured", () => {
	expect(isUrlAllowed("https://example.com/path", {})).toBe(true);
	expect(isUrlAllowed("data:text/html,hello", {})).toBe(true);
});

test("allowed domains deny hosts that are not listed", () => {
	const options = {
		allowedDomains: ["example.com"],
	};

	expect(isUrlAllowed("https://example.com/path", options)).toBe(true);
	expect(isUrlAllowed("https://other.example/path", options)).toBe(false);
});

test("wildcard domains match subdomains but not the apex domain", () => {
	const options = {
		allowedDomains: ["*.example.com"],
	};

	expect(isUrlAllowed("https://docs.example.com", options)).toBe(true);
	expect(isUrlAllowed("https://nested.docs.example.com", options)).toBe(true);
	expect(isUrlAllowed("https://example.com", options)).toBe(false);
});

test("blocked domains take precedence over allowed domains", () => {
	const options = {
		allowedDomains: ["*.example.com"],
		blockedDomains: ["private.example.com"],
	};

	expect(isUrlAllowed("https://public.example.com", options)).toBe(true);
	expect(isUrlAllowed("https://private.example.com", options)).toBe(false);
});

test("domain matching ignores hostname case and URL ports", () => {
	const options = {
		allowedDomains: [" EXAMPLE.COM "],
	};

	expect(isUrlAllowed("https://Example.Com:8443/path", options)).toBe(true);
});

test("DomainPolicyRestricted retains the policy and attempted navigation URL", () => {
	const domainPolicy = {
		allowedDomains: ["example.com"],
		blockedDomains: ["private.example.com"],
	};
	const error = new DomainPolicyRestricted(
		domainPolicy,
		"https://private.example.com/account",
	);

	expect(error).toBeInstanceOf(Error);
	expect(error.name).toBe("DomainPolicyRestricted");
	expect(error.domainPolicy).toEqual(domainPolicy);
	expect(error.attemptedNavigationUrl).toBe(
		"https://private.example.com/account",
	);
});
