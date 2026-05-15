import { adapterFactory } from '../../core/factory.js';
import { makeOpenAICompatMethods } from '../util/openai-compat.js';
import type {
	ChatProvider,
	EmbeddingBatchProvider,
	EmbeddingProvider,
	JsonProvider,
	StreamingProvider,
	ToolProvider,
} from '../../types/providers.js';

type MistralAdapter = ChatProvider &
	StreamingProvider &
	EmbeddingProvider &
	EmbeddingBatchProvider &
	JsonProvider &
	ToolProvider;

export const mistral = adapterFactory('mistral', (config: { apiKey: string; model: string }): MistralAdapter => {
	let client: import('openai').default | undefined;

	async function getClient() {
		if (client) return client;
		const OpenAI = await import('openai').then((mod) => mod.default);
		client = new OpenAI({ apiKey: config.apiKey, baseURL: 'https://api.mistral.ai/v1' });
		return client;
	}

	const { chat, stream, embed, embedMany, json, tool } = makeOpenAICompatMethods(
		getClient,
		'mistral',
		() => config.model,
	);

	return { chat, stream, embed, embedMany, json, tool };
});
