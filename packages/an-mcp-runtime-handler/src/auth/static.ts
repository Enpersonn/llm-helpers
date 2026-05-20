import type { TokenProvider } from '../types.js';

export const createStaticTokenProvider = (token: string): TokenProvider => ({
	getToken: async () => ({ accessToken: token, tokenType: 'Bearer' }),
});
