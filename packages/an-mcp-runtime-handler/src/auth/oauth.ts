import { McpAuthDiscoveryError, McpAuthFlowError } from '../core/errors.js';
import type { McpAuthToken, OAuthConfig, TokenProvider } from '../types.js';
import type { AuthServerMetadata } from './discovery.js';
import { discoverAuth } from './discovery.js';

const base64url = (data: ArrayBuffer): string => {
	const bytes = new Uint8Array(data);
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const generateCodeVerifier = (): string => {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64url(bytes.buffer);
};

const generateCodeChallenge = async (verifier: string): Promise<string> => {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64url(digest);
};

const generateState = (): string => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return base64url(bytes.buffer);
};

const isTokenValid = (token: McpAuthToken): boolean => {
	if (!token.expiresAt) return true;
	return token.expiresAt > Date.now() + 30_000; // 30s buffer
};

type ClientIdentity = {
	clientId: string;
	clientSecret?: string;
};

const resolveClientIdentity = async (
	config: OAuthConfig,
	asMeta: AuthServerMetadata,
	fetchImpl: typeof fetch,
): Promise<ClientIdentity> => {
	if (config.clientId) {
		return { clientId: config.clientId };
	}

	if (config.clientMetadataUrl && asMeta.registration_endpoint) {
		// CIMD: fetch client metadata from stable URL, use for DCR
		let clientMetadata: Record<string, unknown>;
		try {
			const res = await fetchImpl(config.clientMetadataUrl, { headers: { Accept: 'application/json' } });
			if (!res.ok) throw new Error(`Status ${res.status}`);
			clientMetadata = (await res.json()) as Record<string, unknown>;
		} catch (err) {
			throw new McpAuthFlowError(
				`Failed to fetch client metadata from ${config.clientMetadataUrl}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		const dcrRes = await fetchImpl(asMeta.registration_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(clientMetadata),
		});
		if (!dcrRes.ok) {
			throw new McpAuthFlowError(`Dynamic client registration failed (${dcrRes.status})`);
		}
		const registered = (await dcrRes.json()) as { client_id: string; client_secret?: string };
		return { clientId: registered.client_id, clientSecret: registered.client_secret };
	}

	if (asMeta.registration_endpoint) {
		// DCR with minimal metadata
		const redirectUri = config.redirectUri ?? 'http://localhost';
		const dcrRes = await fetchImpl(asMeta.registration_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				redirect_uris: [redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
			}),
		});
		if (!dcrRes.ok) {
			throw new McpAuthFlowError(`Dynamic client registration failed (${dcrRes.status})`);
		}
		const registered = (await dcrRes.json()) as { client_id: string; client_secret?: string };
		return { clientId: registered.client_id, clientSecret: registered.client_secret };
	}

	throw new McpAuthFlowError('Cannot resolve client identity: no clientId, clientMetadataUrl, or DCR endpoint');
};

export const createOAuthTokenProvider = (config: OAuthConfig): TokenProvider => {
	const fetchImpl = config.fetchImpl ?? fetch;
	let cachedToken: McpAuthToken | null = null;
	let invalidated = false;

	const doRefresh = async (refreshToken: string): Promise<McpAuthToken> => {
		const asMeta = await discoverAuth(config.resourceUrl, fetchImpl);
		const { clientId } = await resolveClientIdentity(config, asMeta, fetchImpl);

		const params = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: clientId,
		});

		const res = await fetchImpl(asMeta.token_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		});

		if (!res.ok) throw new McpAuthFlowError(`Token refresh failed (${res.status})`);

		const data = (await res.json()) as {
			access_token: string;
			token_type: string;
			expires_in?: number;
			refresh_token?: string;
			scope?: string;
		};

		const token: McpAuthToken = {
			accessToken: data.access_token,
			tokenType: 'Bearer',
			scope: data.scope,
			...(data.expires_in ? { expiresAt: Date.now() + data.expires_in * 1000 } : {}),
			...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
		};

		await config.tokenStore?.save(token);
		return token;
	};

	const doFullFlow = async (): Promise<McpAuthToken> => {
		const asMeta = await discoverAuth(config.resourceUrl, fetchImpl);

		if (!asMeta.code_challenge_methods_supported?.includes('S256')) {
			throw new McpAuthDiscoveryError('Authorization server does not support PKCE S256 — required by MCP spec');
		}

		const { clientId, clientSecret } = await resolveClientIdentity(config, asMeta, fetchImpl);
		const redirectUri = config.redirectUri ?? 'http://localhost';
		const state = generateState();
		const verifier = generateCodeVerifier();
		const challenge = await generateCodeChallenge(verifier);

		const authParams = new URLSearchParams({
			response_type: 'code',
			client_id: clientId,
			redirect_uri: redirectUri,
			state,
			code_challenge: challenge,
			code_challenge_method: 'S256',
			resource: config.resourceUrl,
			...(config.scope ? { scope: config.scope } : {}),
		});

		const authUrl = `${asMeta.authorization_endpoint}?${authParams.toString()}`;
		await config.openAuthUrl(authUrl);

		const { code, state: returnedState } = await config.receiveAuthCode();
		if (returnedState !== state) {
			throw new McpAuthFlowError('OAuth state mismatch — possible CSRF attack');
		}

		const tokenParams = new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier,
			...(clientSecret ? { client_secret: clientSecret } : {}),
		});

		const res = await fetchImpl(asMeta.token_endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: tokenParams.toString(),
		});

		if (!res.ok) {
			throw new McpAuthFlowError(`Authorization code exchange failed (${res.status})`);
		}

		const data = (await res.json()) as {
			access_token: string;
			token_type: string;
			expires_in?: number;
			refresh_token?: string;
			scope?: string;
		};

		const token: McpAuthToken = {
			accessToken: data.access_token,
			tokenType: 'Bearer',
			scope: data.scope,
			...(data.expires_in ? { expiresAt: Date.now() + data.expires_in * 1000 } : {}),
			...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
		};

		await config.tokenStore?.save(token);
		return token;
	};

	return {
		async getToken(): Promise<McpAuthToken> {
			// Check in-memory cache first
			if (cachedToken && !invalidated && isTokenValid(cachedToken)) {
				return cachedToken;
			}

			// Check persistent store
			if (!invalidated && config.tokenStore) {
				const stored = await config.tokenStore.load();
				if (stored && isTokenValid(stored)) {
					cachedToken = stored;
					invalidated = false;
					return stored;
				}

				// Try refresh if we have a refresh token
				if (stored?.refreshToken) {
					try {
						cachedToken = await doRefresh(stored.refreshToken);
						invalidated = false;
						return cachedToken;
					} catch {
						// refresh failed — fall through to full flow
						await config.tokenStore.clear().catch(() => undefined);
					}
				}
			}

			// Full authorization flow
			cachedToken = await doFullFlow();
			invalidated = false;
			return cachedToken;
		},

		async refreshToken(): Promise<McpAuthToken> {
			const token = cachedToken ?? (await config.tokenStore?.load()) ?? null;
			if (!token?.refreshToken) {
				cachedToken = await doFullFlow();
				invalidated = false;
				return cachedToken;
			}
			cachedToken = await doRefresh(token.refreshToken);
			invalidated = false;
			return cachedToken;
		},

		invalidate(): void {
			invalidated = true;
			cachedToken = null;
		},
	};
};
