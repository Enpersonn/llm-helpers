import { McpAuthDiscoveryError } from '../core/errors.js';

export type ProtectedResourceMetadata = {
	resource: string;
	authorization_servers?: string[];
	bearer_methods_supported?: string[];
	[key: string]: unknown;
};

export type AuthServerMetadata = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint?: string;
	code_challenge_methods_supported?: string[];
	response_types_supported?: string[];
	grant_types_supported?: string[];
	[key: string]: unknown;
};

export const discoverProtectedResource = async (
	resourceUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ProtectedResourceMetadata> => {
	const base = new URL(resourceUrl);
	const wellKnown = new URL('/.well-known/oauth-protected-resource', base.origin);

	let res: Response;
	try {
		res = await fetchImpl(wellKnown.toString(), { headers: { Accept: 'application/json' } });
	} catch (err) {
		throw new McpAuthDiscoveryError(
			`Failed to reach protected resource metadata at ${wellKnown}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!res.ok) {
		throw new McpAuthDiscoveryError(
			`Protected resource metadata endpoint returned ${res.status} at ${wellKnown}`,
		);
	}

	try {
		return (await res.json()) as ProtectedResourceMetadata;
	} catch {
		throw new McpAuthDiscoveryError(`Malformed protected resource metadata at ${wellKnown}`);
	}
};

export const discoverAuthServer = async (
	issuerUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<AuthServerMetadata> => {
	const base = new URL(issuerUrl);

	// Try RFC 8414 first, fall back to OIDC discovery
	const candidates = [
		new URL('/.well-known/oauth-authorization-server', base.origin).toString(),
		new URL('/.well-known/openid-configuration', base.origin).toString(),
	];

	for (const endpoint of candidates) {
		try {
			const res = await fetchImpl(endpoint, { headers: { Accept: 'application/json' } });
			if (!res.ok) continue;
			const metadata = (await res.json()) as AuthServerMetadata;
			if (metadata.authorization_endpoint && metadata.token_endpoint) {
				return metadata;
			}
		} catch {
			// try next candidate
		}
	}

	throw new McpAuthDiscoveryError(
		`Could not discover authorization server metadata for issuer: ${issuerUrl}`,
	);
};

export const discoverAuth = async (
	resourceUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<AuthServerMetadata> => {
	const resourceMeta = await discoverProtectedResource(resourceUrl, fetchImpl);

	const servers = resourceMeta.authorization_servers;
	if (!servers?.length) {
		throw new McpAuthDiscoveryError(
			`Protected resource metadata at ${resourceUrl} has no authorization_servers`,
		);
	}

	return discoverAuthServer(servers[0]!, fetchImpl);
};
