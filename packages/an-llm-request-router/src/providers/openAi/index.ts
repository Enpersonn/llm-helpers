import { adapterFactory } from '../../core/factory.js';
import { makeOpenAICompatMethods, type OpenAICompatAdapter } from '../util/openai-compat.js';

export const openAi = adapterFactory('openai', (config: { apiKey: string; model: string }): OpenAICompatAdapter => {
	let client: import('openai').default | undefined;

	async function getClient() {
		if (client) return client;
		const OpenAI = await import('openai').then((mod) => mod.default);
		client = new OpenAI({ apiKey: config.apiKey });
		return client;
	}

	return makeOpenAICompatMethods(getClient, 'openai', () => config.model);
});
