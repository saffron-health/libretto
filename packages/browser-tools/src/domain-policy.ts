export interface DomainPolicyOptions {
	allowedDomains?: readonly string[];
	blockedDomains?: readonly string[];
}

export class DomainPolicyRestricted extends Error {
	readonly domainPolicy: DomainPolicyOptions;
	readonly attemptedNavigationUrl: string;

	constructor(
		domainPolicy: DomainPolicyOptions,
		attemptedNavigationUrl: string,
	) {
		super(
			`${attemptedNavigationUrl} is blocked by this toolkit's domain policy`,
		);
		this.name = "DomainPolicyRestricted";
		this.domainPolicy = {
			allowedDomains: domainPolicy.allowedDomains
				? [...domainPolicy.allowedDomains]
				: undefined,
			blockedDomains: domainPolicy.blockedDomains
				? [...domainPolicy.blockedDomains]
				: undefined,
		};
		this.attemptedNavigationUrl = attemptedNavigationUrl;
	}
}

function matchesDomain(hostname: string, pattern: string): boolean {
	const normalizedPattern = pattern.trim().toLowerCase();
	if (normalizedPattern.startsWith("*.")) {
		const suffix = normalizedPattern.slice(2);
		return suffix.length > 0 && hostname.endsWith(`.${suffix}`);
	}
	return hostname === normalizedPattern;
}

export function isUrlAllowed(
	url: string,
	{ allowedDomains, blockedDomains = [] }: DomainPolicyOptions,
): boolean {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

	const hostname = parsed.hostname.toLowerCase();
	if (blockedDomains.some((domain) => matchesDomain(hostname, domain))) {
		return false;
	}
	if (allowedDomains === undefined) return true;
	return allowedDomains.some((domain) => matchesDomain(hostname, domain));
}
