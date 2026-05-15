import { adapterFactory } from '../../core/factory.js';
import type { ChatProvider, JsonProvider, StreamingProvider, ToolProvider } from '../../types/providers.js';
import { makeOpenAICompatMethods } from '../util/openai-compat.js';

type GroqAdapter = ChatProvider & StreamingProvider & JsonProvider & ToolProvider;

export const groq = adapterFactory('groq', (config: { apiKey: string; model: string }): GroqAdapter => {
	let client: import('openai').default | undefined;

	async function getClient() {
		if (client) return client;
		const OpenAI = await import('openai').then((mod) => mod.default);
		client = new OpenAI({ apiKey: config.apiKey, baseURL: 'https://api.groq.com/openai/v1' });
		return client;
	}

	const { chat, stream, json, tool } = makeOpenAICompatMethods(getClient, 'groq', () => config.model);

	return { chat, stream, json, tool };
});
